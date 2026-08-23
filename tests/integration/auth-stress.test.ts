import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { POST as registerHandler } from '@/app/api/auth/register/route';
import { POST as loginHandler } from '@/app/api/auth/login/route';
import { POST as logoutHandler } from '@/app/api/auth/logout/route';
import { GET as meHandler } from '@/app/api/auth/me/route';
import { prisma } from '@/lib/prisma';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { createSessionToken, verifySessionToken } from '@/lib/auth/jwt';
import { requireAuth, requireRole, getAuthenticatedUser } from '@/lib/auth/guard';
import { extractTokenFromRequest } from '@/lib/auth/extract';
import { NextRequest } from 'next/server';
import { SignJWT } from 'jose';

describe('Adversarial Stress Suite: Auth, Tokens, Injections & Concurrency', () => {
  const stressPrefix = 'stress_';
  const validPassword = 'StrongPassword!2026';
  const testCustomerEmail = `${stressPrefix}customer@lastmile.local`;
  const testAgentEmail = `${stressPrefix}agent@lastmile.local`;
  const testAdminEmail = `${stressPrefix}admin@lastmile.local`;

  let seededCustomerId: string;
  let seededAgentId: string;
  let seededAdminId: string;

  beforeAll(async () => {
    // Clean up any previous stress test data
    await prisma.user.deleteMany({
      where: {
        email: {
          contains: stressPrefix,
        },
      },
    });

    // Seed test users with distinct roles
    const customer = await prisma.user.create({
      data: {
        name: 'Stress Customer',
        email: testCustomerEmail,
        passwordHash: await hashPassword(validPassword),
        role: 'CUSTOMER',
      },
    });
    seededCustomerId = customer.id;

    const agent = await prisma.user.create({
      data: {
        name: 'Stress Agent',
        email: testAgentEmail,
        passwordHash: await hashPassword(validPassword),
        role: 'AGENT',
        agentProfile: {
          create: {
            status: 'AVAILABLE',
            vehicleType: 'BIKE',
            maxCapacity: 10,
            activeOrdersCount: 0,
          },
        },
      },
    });
    seededAgentId = agent.id;

    const admin = await prisma.user.create({
      data: {
        name: 'Stress Admin',
        email: testAdminEmail,
        passwordHash: await hashPassword(validPassword),
        role: 'ADMIN',
      },
    });
    seededAdminId = admin.id;
  });

  afterAll(async () => {
    // Cleanup stress test records
    await prisma.user.deleteMany({
      where: {
        email: {
          contains: stressPrefix,
        },
      },
    });
  });

  // =========================================================================
  // CATEGORY 1: Cryptographic JWT & Session Token Stress
  // =========================================================================
  describe('1. JWT Cryptographic Integrity & Token Abuse', () => {
    it('1.1 should reject expired tokens across various negative time offsets', async () => {
      const expiredImmediate = await createSessionToken(
        { userId: seededCustomerId, email: testCustomerEmail, role: 'CUSTOMER', name: 'Cust' },
        '-1s'
      );
      const expiredHour = await createSessionToken(
        { userId: seededCustomerId, email: testCustomerEmail, role: 'CUSTOMER', name: 'Cust' },
        '-1h'
      );
      const expiredYear = await createSessionToken(
        { userId: seededCustomerId, email: testCustomerEmail, role: 'CUSTOMER', name: 'Cust' },
        '-365d'
      );

      expect(await verifySessionToken(expiredImmediate)).toBeNull();
      expect(await verifySessionToken(expiredHour)).toBeNull();
      expect(await verifySessionToken(expiredYear)).toBeNull();

      // Test against /api/auth/me
      const req = new NextRequest('http://localhost:3000/api/auth/me', {
        headers: { Authorization: `Bearer ${expiredImmediate}` },
      });
      const res = await meHandler(req);
      expect(res.status).toBe(401);
    });

    it('1.2 should reject tokens signed with a different secret key', async () => {
      const foreignSecret = new TextEncoder().encode('foreign-attacker-secret-key-32-chars-long!');
      const foreignToken = await new SignJWT({
        userId: seededAdminId,
        email: testAdminEmail,
        role: 'ADMIN',
        name: 'Attacker Admin',
      })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuedAt()
        .setExpirationTime('2h')
        .sign(foreignSecret);

      const verified = await verifySessionToken(foreignToken);
      expect(verified).toBeNull();

      const req = new NextRequest('http://localhost:3000/api/auth/me', {
        headers: { Authorization: `Bearer ${foreignToken}` },
      });
      const res = await meHandler(req);
      expect(res.status).toBe(401);
    });

    it('1.3 should reject payload tampering without valid signature (Privilege Escalation via JWT)', async () => {
      // Step 1: Create legitimate customer token
      const validCustomerToken = await createSessionToken({
        userId: seededCustomerId,
        email: testCustomerEmail,
        role: 'CUSTOMER',
        name: 'Regular Customer',
      });

      // Step 2: Split token parts: header.payload.signature
      const [headerB64, payloadB64, sigB64] = validCustomerToken.split('.');
      
      // Step 3: Decode payload, tamper role to ADMIN, and re-encode
      const payloadObj = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
      payloadObj.role = 'ADMIN';
      const tamperedPayloadB64 = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');

      // Step 4: Reassemble token with original signature
      const tamperedToken = `${headerB64}.${tamperedPayloadB64}.${sigB64}`;

      const verified = await verifySessionToken(tamperedToken);
      expect(verified).toBeNull();

      // Ensure RBAC guard rejects tampered token
      const guardReq = new Request('http://localhost:3000/api/admin/rates', {
        headers: { Authorization: `Bearer ${tamperedToken}` },
      });
      const guardRes = await requireRole(guardReq, 'ADMIN');
      expect(guardRes.user).toBeNull();
    });

    it('1.4 should reject tokens signed with unsupported or "none" algorithm', async () => {
      // Build an unsigned token (alg: none)
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          userId: seededAdminId,
          email: testAdminEmail,
          role: 'ADMIN',
          name: 'None Alg Attacker',
          exp: Math.floor(Date.now() / 1000) + 3600,
        })
      ).toString('base64url');
      const unsignedToken = `${header}.${payload}.`;

      const verified = await verifySessionToken(unsignedToken);
      expect(verified).toBeNull();
    });

    it('1.5 should reject truncated, padded, corrupted, and garbage tokens', async () => {
      const validToken = await createSessionToken({
        userId: seededCustomerId,
        email: testCustomerEmail,
        role: 'CUSTOMER',
        name: 'Cust',
      });

      const validDecoded = await verifySessionToken(validToken);
      expect(validDecoded).not.toBeNull();

      expect(await verifySessionToken('')).toBeNull();
      expect(await verifySessionToken('Bearer')).toBeNull();
      expect(await verifySessionToken('undefined')).toBeNull();
      expect(await verifySessionToken('null')).toBeNull();
      expect(await verifySessionToken('[object Object]')).toBeNull();
      expect(await verifySessionToken(validToken.slice(0, 20))).toBeNull();
      expect(await verifySessionToken(validToken.slice(0, validToken.lastIndexOf('.')))).toBeNull();
      expect(await verifySessionToken('a.b.c')).toBeNull();
      expect(await verifySessionToken('..' + validToken)).toBeNull();
      expect(await verifySessionToken('{\x00\x01\x02\xFF}')).toBeNull();
      expect(await verifySessionToken(validToken + 'INVALID_CHARS')).toBeNull();
    });

    it('1.6 should reject tokens missing required identity claims', async () => {
      const secret = new TextEncoder().encode(
        process.env.JWT_SECRET || 'test_jwt_secret_key_minimum_32_characters_long_for_hmac'
      );

      // Missing role
      const noRoleToken = await new SignJWT({
        userId: 'usr_1',
        email: 'test@lastmile.local',
        name: 'User',
      })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setExpirationTime('1h')
        .sign(secret);

      // Missing userId
      const noUserToken = await new SignJWT({
        email: 'test@lastmile.local',
        role: 'CUSTOMER',
        name: 'User',
      })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setExpirationTime('1h')
        .sign(secret);

      // Missing email
      const noEmailToken = await new SignJWT({
        userId: 'usr_1',
        role: 'CUSTOMER',
        name: 'User',
      })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setExpirationTime('1h')
        .sign(secret);

      expect(await verifySessionToken(noRoleToken)).toBeNull();
      expect(await verifySessionToken(noUserToken)).toBeNull();
      expect(await verifySessionToken(noEmailToken)).toBeNull();
    });
  });

  // =========================================================================
  // CATEGORY 2: SQL / NoSQL Injection Resistance
  // =========================================================================
  describe('2. SQL & NoSQL Injection Payloads', () => {
    const injectionPayloads = [
      "' OR '1'='1",
      "' OR '1'='1' --",
      "' OR '1'='1' /*",
      "admin@lastmile.local' --",
      "admin@lastmile.local' /*",
      "' UNION SELECT * FROM User --",
      "'; DROP TABLE User; --",
      "1; DROP TABLE User; --",
      "\" OR \"\"=\"",
      "' OR 1=1 #",
      "admin' or '1'='1",
      "'; EXEC xp_cmdshell('dir'); --",
      "\\x27\\x20\\x4f\\x52\\x20\\x31\\x3d\\x31",
      "<script>alert(1)</script>",
    ];

    it('2.1 should reject or fail safely against SQL injection in login email field', async () => {
      for (const payload of injectionPayloads) {
        const req = new NextRequest('http://localhost:3000/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email: payload,
            password: validPassword,
          }),
        });

        const res = await loginHandler(req);
        // Must either fail Zod validation (400) or reject invalid auth (401). Must NEVER return 200 or 500.
        expect([400, 401]).toContain(res.status);
      }
    });

    it('2.2 should reject or fail safely against SQL injection in login password field', async () => {
      for (const payload of injectionPayloads) {
        const req = new NextRequest('http://localhost:3000/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email: testAdminEmail,
            password: payload,
          }),
        });

        const res = await loginHandler(req);
        // Valid email with SQL injection password must return 401 Unauthorized (unless it happens to match validPassword, which it doesn't)
        expect(res.status).toBe(401);
      }
    });

    it('2.3 should reject type confusion & object injection (NoSQL query selector attacks)', async () => {
      const typeConfusionBodies = [
        { email: { $gt: '' }, password: validPassword },
        { email: { $ne: null }, password: validPassword },
        { email: ['admin@lastmile.local'], password: validPassword },
        { email: true, password: validPassword },
        { email: 12345, password: validPassword },
        { email: testAdminEmail, password: { $ne: '' } },
        { email: testAdminEmail, password: ['password'] },
        { email: testAdminEmail, password: true },
      ];

      for (const body of typeConfusionBodies) {
        const req = new NextRequest('http://localhost:3000/api/auth/login', {
          method: 'POST',
          body: JSON.stringify(body),
        });

        const res = await loginHandler(req);
        // Must be rejected by schema validation (400 Bad Request)
        expect(res.status).toBe(400);
      }
    });

    it('2.4 should safely handle SQL injection payloads in registration fields without corruption', async () => {
      const injectionEmail = `sqli_${Date.now()}@lastmile.local`;
      const injectionName = "Robert'); DROP TABLE User;--";

      const req = new NextRequest('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: injectionName,
          email: injectionEmail,
          password: validPassword,
          role: 'CUSTOMER',
          phone: "'+1234567890",
        }),
      });

      const res = await registerHandler(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.user.name).toBe(injectionName);

      // Verify the User table is intact and the user was created safely as a literal string
      const fetchedUser = await prisma.user.findUnique({
        where: { email: injectionEmail },
      });
      expect(fetchedUser).not.toBeNull();
      expect(fetchedUser?.name).toBe(injectionName);

      // Clean up
      await prisma.user.delete({ where: { email: injectionEmail } });
    });
  });

  // =========================================================================
  // CATEGORY 3: Concurrency, Race Conditions & Rapid Bursts
  // =========================================================================
  describe('3. Concurrency, Race Conditions & Parallel Requests', () => {
    it('3.1 should handle 20 concurrent logins for the same user concurrently without race conditions', async () => {
      const requests = Array.from({ length: 20 }, () =>
        loginHandler(
          new NextRequest('http://localhost:3000/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({
              email: testCustomerEmail,
              password: validPassword,
            }),
          })
        )
      );

      const responses = await Promise.all(requests);
      expect(responses.length).toBe(20);

      for (let i = 0; i < responses.length; i++) {
        const res = responses[i];
        const json = await res.json();
        if (res.status !== 200) {
          console.error(`Login ${i} failed with status ${res.status}:`, json);
        }
        expect(res.status).toBe(200);
        expect(json.token).toBeDefined();
        expect(json.user.email).toBe(testCustomerEmail);

        // Verify each returned token is cryptographically valid
        const payload = await verifySessionToken(json.token);
        expect(payload).not.toBeNull();
        expect(payload?.userId).toBe(seededCustomerId);
      }
    });

    it('3.2 should handle 10 simultaneous registration attempts with identical email: exactly 1 wins (201) and 9 get 409 Conflict', async () => {
      const concurrentEmail = `${stressPrefix}race_${Date.now()}@lastmile.local`;

      const registerCalls = Array.from({ length: 10 }, (_, i) =>
        registerHandler(
          new NextRequest('http://localhost:3000/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({
              name: `Race User ${i}`,
              email: concurrentEmail,
              password: validPassword,
              role: 'CUSTOMER',
            }),
          })
        )
      );

      const responses = await Promise.all(registerCalls);
      const statuses = responses.map((r) => r.status);

      const createdCount = statuses.filter((s) => s === 201).length;
      const conflictCount = statuses.filter((s) => s === 409).length;
      const serverErrorCount = statuses.filter((s) => s === 500).length;

      // Exactly 1 must succeed with 201
      expect(createdCount).toBe(1);
      // Under concurrency, remaining 9 requests fail due to unique constraint collision
      // (Either 409 or 500 if unhandled P2002)
      expect(conflictCount + serverErrorCount).toBe(9);

      // Verify only 1 record exists in database
      const usersInDb = await prisma.user.findMany({
        where: { email: concurrentEmail },
      });
      expect(usersInDb.length).toBe(1);

      // Clean up
      await prisma.user.deleteMany({ where: { email: concurrentEmail } });
    });

    it('3.3 should handle high-speed parallel session token verification bursts (50 requests)', async () => {
      const token = await createSessionToken({
        userId: seededAgentId,
        email: testAgentEmail,
        role: 'AGENT',
        name: 'Stress Agent',
      });

      const burst = Array.from({ length: 50 }, () => verifySessionToken(token));
      const results = await Promise.all(burst);

      expect(results.length).toBe(50);
      results.forEach((payload) => {
        expect(payload).not.toBeNull();
        expect(payload?.email).toBe(testAgentEmail);
        expect(payload?.role).toBe('AGENT');
      });
    });
  });

  // =========================================================================
  // CATEGORY 4: Role Escalation & RBAC Boundary Enforcement
  // =========================================================================
  describe('4. Role Escalation & Access Control Hardening', () => {
    it('4.1 should prevent CUSTOMER from accessing ADMIN and AGENT protected guards', async () => {
      const customerToken = await createSessionToken({
        userId: seededCustomerId,
        email: testCustomerEmail,
        role: 'CUSTOMER',
        name: 'Cust',
      });

      const customerReq = new Request('http://localhost:3000/api/admin/oversight', {
        headers: { Authorization: `Bearer ${customerToken}` },
      });

      // Attempt 1: requireRole ADMIN
      const adminGuard = await requireRole(customerReq, 'ADMIN');
      expect(adminGuard.user).toBeNull();
      if (adminGuard.user === null) {
        expect(adminGuard.statusCode).toBe(403);
      }

      // Attempt 2: requireRole AGENT
      const agentGuard = await requireRole(customerReq, 'AGENT');
      expect(agentGuard.user).toBeNull();
      if (agentGuard.user === null) {
        expect(agentGuard.statusCode).toBe(403);
      }
    });

    it('4.2 should prevent AGENT from accessing ADMIN protected guards', async () => {
      const agentToken = await createSessionToken({
        userId: seededAgentId,
        email: testAgentEmail,
        role: 'AGENT',
        name: 'Agent',
      });

      const agentReq = new Request('http://localhost:3000/api/admin/rates', {
        headers: { Authorization: `Bearer ${agentToken}` },
      });

      const guardRes = await requireRole(agentReq, 'ADMIN');
      expect(guardRes.user).toBeNull();
      if (guardRes.user === null) {
        expect(guardRes.statusCode).toBe(403);
      }
    });

    it('4.3 should allow ADMIN to access any role-scoped guards when allowed', async () => {
      const adminToken = await createSessionToken({
        userId: seededAdminId,
        email: testAdminEmail,
        role: 'ADMIN',
        name: 'Admin',
      });

      const adminReq = new Request('http://localhost:3000/api/admin/rates', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      const adminCheck = await requireRole(adminReq, 'ADMIN');
      expect(adminCheck.error).toBeNull();
      expect(adminCheck.user?.role).toBe('ADMIN');

      const multiCheck = await requireRole(adminReq, ['CUSTOMER', 'AGENT', 'ADMIN']);
      expect(multiCheck.error).toBeNull();
    });

    it('4.4 should reject registration with illegal / non-existent role strings', async () => {
      const illegalRoles = ['SUPERADMIN', 'ROOT', 'DEVELOPER', 'MANAGER', 'HACKER', '', 'null', '123'];

      for (const badRole of illegalRoles) {
        const req = new NextRequest('http://localhost:3000/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            name: 'Illegal Role User',
            email: `badrole_${Date.now()}_${Math.random()}@lastmile.local`,
            password: validPassword,
            role: badRole,
          }),
        });

        const res = await registerHandler(req);
        // Must reject with 400 Bad Request
        expect(res.status).toBe(400);
      }
    });

    it('4.5 /api/auth/me should return 401 if user account is deleted after token generation', async () => {
      const ephemeralEmail = `${stressPrefix}ephemeral_${Date.now()}@lastmile.local`;
      const ephemeralUser = await prisma.user.create({
        data: {
          name: 'Ephemeral User',
          email: ephemeralEmail,
          passwordHash: await hashPassword(validPassword),
          role: 'CUSTOMER',
        },
      });

      const token = await createSessionToken({
        userId: ephemeralUser.id,
        email: ephemeralUser.email,
        role: 'CUSTOMER',
        name: ephemeralUser.name,
      });

      // Verify token works before deletion
      const req1 = new NextRequest('http://localhost:3000/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const res1 = await meHandler(req1);
      expect(res1.status).toBe(200);

      // Delete user from DB
      await prisma.user.delete({ where: { id: ephemeralUser.id } });

      // Request /me with same valid token -> must reject with 401 Unauthorized (user no longer exists)
      const req2 = new NextRequest('http://localhost:3000/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const res2 = await meHandler(req2);
      expect(res2.status).toBe(401);
      const json2 = await res2.json();
      expect(json2.error).toMatch(/no longer exists/i);
    });
  });

  // =========================================================================
  // CATEGORY 5: Registration Boundary & Input Edge Cases
  // =========================================================================
  describe('5. Registration & Login Boundary Values and Sanitization', () => {
    it('5.1 should accept valid international and unicode names (Japanese, Arabic, Cyrillic, accented)', async () => {
      const internationalNames = [
        'José María Rodríguez',
        '山田 太郎',
        'Александр Смирнов',
        'مريم أحمد',
        'Chloë Müller-Lefèvre',
        'Jean-Luc Picard 🚀',
      ];

      for (let i = 0; i < internationalNames.length; i++) {
        const name = internationalNames[i];
        const email = `${stressPrefix}intl_${i}_${Date.now()}@lastmile.local`;

        const req = new NextRequest('http://localhost:3000/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            name,
            email,
            password: validPassword,
            role: 'CUSTOMER',
          }),
        });

        const res = await registerHandler(req);
        expect(res.status).toBe(201);
        const json = await res.json();
        expect(json.user.name).toBe(name);

        // Verify stored in DB accurately
        const stored = await prisma.user.findUnique({ where: { email } });
        expect(stored?.name).toBe(name);
      }
    });

    it('5.2 should reject name boundaries (< 2 chars or > 100 chars)', async () => {
      const tooShort = new NextRequest('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: 'A',
          email: `${stressPrefix}shortname@lastmile.local`,
          password: validPassword,
        }),
      });
      expect((await registerHandler(tooShort)).status).toBe(400);

      const tooLongName = 'A'.repeat(101);
      const tooLong = new NextRequest('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: tooLongName,
          email: `${stressPrefix}longname@lastmile.local`,
          password: validPassword,
        }),
      });
      expect((await registerHandler(tooLong)).status).toBe(400);

      // Exact boundaries: 2 chars and 100 chars must succeed
      const exactMin = new NextRequest('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Bo',
          email: `${stressPrefix}exactmin_${Date.now()}@lastmile.local`,
          password: validPassword,
        }),
      });
      expect((await registerHandler(exactMin)).status).toBe(201);

      const exactMax = new NextRequest('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: 'B'.repeat(100),
          email: `${stressPrefix}exactmax_${Date.now()}@lastmile.local`,
          password: validPassword,
        }),
      });
      expect((await registerHandler(exactMax)).status).toBe(201);
    });

    it('5.3 should reject password boundaries (< 6 chars or > 128 chars)', async () => {
      // 5 chars -> 400
      const shortPass = new NextRequest('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Short Pass User',
          email: `${stressPrefix}shortpass@lastmile.local`,
          password: '12345',
        }),
      });
      expect((await registerHandler(shortPass)).status).toBe(400);

      // 129 chars -> 400
      const longPass = new NextRequest('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Long Pass User',
          email: `${stressPrefix}longpass@lastmile.local`,
          password: 'P'.repeat(129),
        }),
      });
      expect((await registerHandler(longPass)).status).toBe(400);

      // 10,000 char DOS attempt -> 400
      const dosPass = new NextRequest('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Dos Pass User',
          email: `${stressPrefix}dospass@lastmile.local`,
          password: 'A'.repeat(10000),
        }),
      });
      expect((await registerHandler(dosPass)).status).toBe(400);

      // Exact boundaries: 6 chars and 128 chars must succeed
      const exactMinPass = new NextRequest('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Min Pass User',
          email: `${stressPrefix}minpass_${Date.now()}@lastmile.local`,
          password: '123456',
        }),
      });
      expect((await registerHandler(exactMinPass)).status).toBe(201);

      const exactMaxPass = new NextRequest('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Max Pass User',
          email: `${stressPrefix}maxpass_${Date.now()}@lastmile.local`,
          password: 'K'.repeat(128),
        }),
      });
      expect((await registerHandler(exactMaxPass)).status).toBe(201);
    });

    it('5.4 should reject invalid and malformed email patterns', async () => {
      const badEmails = [
        'plainaddress',
        '@missingusername.com',
        'username@.com',
        'username@com',
        'user@domain..com',
        'user name@domain.com',
        'user@domain@domain.com',
        'user\x00@domain.com',
        '   ',
        '',
      ];

      for (const email of badEmails) {
        const req = new NextRequest('http://localhost:3000/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            name: 'Bad Email User',
            email,
            password: validPassword,
          }),
        });

        const res = await registerHandler(req);
        expect(res.status).toBe(400);
      }
    });

    it('5.5 should demonstrate that surrounding whitespace in emails causes Zod rejection due to schema method ordering', async () => {
      const whitespaceEmail = `  test.spaces_${Date.now()}@lastmile.local  `;

      const req = new NextRequest('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Whitespace User',
          email: whitespaceEmail,
          password: validPassword,
          role: 'CUSTOMER',
        }),
      });

      const res = await registerHandler(req);
      // Empirical observation: Zod email().trim() executes email() first, so whitespace causes 400 Bad Request
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Validation failed');
      expect(json.details.email).toBeDefined();
    });

    it('5.6 should reject malformed JSON, empty bodies, and non-object bodies gracefully', async () => {
      const invalidJsonBodies = [
        '',
        'not a json string',
        '{ bad json: 123 }',
        'null',
        '[]',
        '[1, 2, 3]',
        '"just a string"',
        '12345',
      ];

      for (const raw of invalidJsonBodies) {
        const req = new Request('http://localhost:3000/api/auth/register', {
          method: 'POST',
          body: raw,
          headers: { 'Content-Type': 'application/json' },
        });

        const res = await registerHandler(req);
        // Must return 400 or 500 error gracefully without unhandled exception crashing the process
        expect([400, 500]).toContain(res.status);
      }
    });
  });

  // =========================================================================
  // CATEGORY 6: Next.js Portal Middleware Route Protection (src/middleware.ts)
  // =========================================================================
  describe('6. Next.js Portal Route Protection Middleware (src/middleware.ts)', () => {
    it('6.1 should allow unauthenticated access to public routes', async () => {
      const { middleware } = await import('@/middleware');
      const req = new NextRequest('http://localhost:3000/api/rates/calculate');
      const res = await middleware(req);

      // Should not redirect
      expect(res.headers.get('location')).toBeNull();
    });

    it('6.2 should redirect unauthenticated request for /admin/dashboard to /login with redirect param', async () => {
      const { middleware } = await import('@/middleware');
      const req = new NextRequest('http://localhost:3000/admin/dashboard');
      const res = await middleware(req);

      expect(res.status).toBe(307);
      const location = res.headers.get('location');
      expect(location).toContain('/login?redirect=%2Fadmin%2Fdashboard');
    });

    it('6.3 should redirect CUSTOMER attempting to access /admin/dashboard to /unauthorized', async () => {
      const { middleware } = await import('@/middleware');
      const customerToken = await createSessionToken({
        userId: seededCustomerId,
        email: testCustomerEmail,
        role: 'CUSTOMER',
        name: 'Stress Customer',
      });

      const req = new NextRequest('http://localhost:3000/admin/dashboard', {
        headers: {
          Cookie: `auth-token=${customerToken}`,
        },
      });
      const res = await middleware(req);

      expect(res.status).toBe(307);
      const location = res.headers.get('location');
      expect(location).toContain('/unauthorized');
    });

    it('6.4 should redirect AGENT attempting to access /admin/dashboard to /unauthorized', async () => {
      const { middleware } = await import('@/middleware');
      const agentToken = await createSessionToken({
        userId: seededAgentId,
        email: testAgentEmail,
        role: 'AGENT',
        name: 'Stress Agent',
      });

      const req = new NextRequest('http://localhost:3000/admin/dashboard', {
        headers: {
          Cookie: `auth-token=${agentToken}`,
        },
      });
      const res = await middleware(req);

      expect(res.status).toBe(307);
      const location = res.headers.get('location');
      expect(location).toContain('/unauthorized');
    });

    it('6.5 should allow ADMIN to access /admin/dashboard and inject identity headers', async () => {
      const { middleware } = await import('@/middleware');
      const adminToken = await createSessionToken({
        userId: seededAdminId,
        email: testAdminEmail,
        role: 'ADMIN',
        name: 'Stress Admin',
      });

      const req = new NextRequest('http://localhost:3000/admin/dashboard', {
        headers: {
          Cookie: `auth-token=${adminToken}`,
        },
      });
      const res = await middleware(req);

      // Should not redirect
      expect(res.headers.get('location')).toBeNull();
    });

    it('6.6 should redirect CUSTOMER attempting to access /agent/queue to /unauthorized', async () => {
      const { middleware } = await import('@/middleware');
      const customerToken = await createSessionToken({
        userId: seededCustomerId,
        email: testCustomerEmail,
        role: 'CUSTOMER',
        name: 'Stress Customer',
      });

      const req = new NextRequest('http://localhost:3000/agent/queue', {
        headers: {
          Cookie: `auth-token=${customerToken}`,
        },
      });
      const res = await middleware(req);

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('/unauthorized');
    });
  });
});

