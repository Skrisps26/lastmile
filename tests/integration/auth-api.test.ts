import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { POST as registerHandler } from '@/app/api/auth/register/route';
import { POST as loginHandler } from '@/app/api/auth/login/route';
import { POST as logoutHandler } from '@/app/api/auth/logout/route';
import { GET as meHandler } from '@/app/api/auth/me/route';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth/password';
import { createSessionToken } from '@/lib/auth/jwt';
import { NextRequest } from 'next/server';

describe('Integration: Authentication API Suite', () => {
  const registerEmail = 'new.integration.customer@lastmile.local';
  const loginEmail = 'login.integration.tester@lastmile.local';
  const agentEmail = 'agent.integration.tester@lastmile.local';
  const meEmail = 'me.integration.tester@lastmile.local';
  const rawPassword = 'Password123!';

  beforeAll(async () => {
    // Clean up any test users
    await prisma.user.deleteMany({
      where: {
        email: {
          in: [registerEmail, loginEmail, agentEmail, meEmail, 'duplicate.test@lastmile.local'],
        },
      },
    });

    // Create user for login tests
    await prisma.user.create({
      data: {
        name: 'Login Test User',
        email: loginEmail,
        passwordHash: await hashPassword(rawPassword),
        role: 'CUSTOMER',
      },
    });
  });

  describe('POST /api/auth/register', () => {
    beforeEach(async () => {
      await prisma.user.deleteMany({
        where: { email: { in: [registerEmail, agentEmail] } },
      });
    });

    it('should register a new customer, return sanitized user, and set cookie', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: 'New Integration Customer',
          email: registerEmail,
          password: rawPassword,
          role: 'CUSTOMER',
          phone: '+91-9876543299',
        }),
      });

      const res = await registerHandler(req);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.user).toBeDefined();
      expect(json.user.email).toBe(registerEmail);
      expect(json.user.role).toBe('CUSTOMER');
      expect(json.user.passwordHash).toBeUndefined(); // Crucial security invariant
      expect(json.token).toBeDefined();

      const cookieHeader = res.headers.get('set-cookie');
      expect(cookieHeader).toContain('auth-token=');
      expect(cookieHeader).toContain('HttpOnly');
    });

    it('should register an agent and automatically create DeliveryAgentProfile', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Agent Integration',
          email: agentEmail,
          password: rawPassword,
          role: 'AGENT',
          vehicleType: 'VAN',
          vehicleNumber: 'KA-01-XX-9999',
        }),
      });

      const res = await registerHandler(req);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.user.role).toBe('AGENT');
      expect(json.user.agentProfile).toBeDefined();
      expect(json.user.agentProfile.vehicleType).toBe('VAN');
      expect(json.user.agentProfile.status).toBe('AVAILABLE');
    });

    it('should reject registration with duplicate email (409 Conflict)', async () => {
      const dupEmail = 'duplicate.test@lastmile.local';
      await prisma.user.deleteMany({ where: { email: dupEmail } });

      const req1 = new NextRequest('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: 'First User',
          email: dupEmail,
          password: rawPassword,
        }),
      });
      const res1 = await registerHandler(req1);
      expect(res1.status).toBe(201);

      const req2 = new NextRequest('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Second User',
          email: dupEmail,
          password: 'AnotherPassword123',
        }),
      });
      const res2 = await registerHandler(req2);
      const json2 = await res2.json();

      expect(res2.status).toBe(409);
      expect(json2.error).toMatch(/already exists/i);
    });

    it('should reject invalid registration payloads with 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: 'A', // too short (< 2)
          email: 'invalid-email-format',
          password: '123', // too short (< 6)
        }),
      });

      const res = await registerHandler(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe('Validation failed');
      expect(json.details).toBeDefined();
    });
  });

  describe('POST /api/auth/login', () => {
    it('should authenticate with valid credentials, set cookie, and return token', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: loginEmail,
          password: rawPassword,
        }),
      });

      const res = await loginHandler(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.message).toBe('Login successful');
      expect(json.user.email).toBe(loginEmail);
      expect(json.user.passwordHash).toBeUndefined();
      expect(json.token).toBeDefined();

      const cookie = res.headers.get('set-cookie');
      expect(cookie).toContain('auth-token=');
    });

    it('should support case-insensitive email login', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: loginEmail.toUpperCase(),
          password: rawPassword,
        }),
      });

      const res = await loginHandler(req);
      expect(res.status).toBe(200);
    });

    it('should reject invalid password with 401 Unauthorized', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: loginEmail,
          password: 'IncorrectPassword999!',
        }),
      });

      const res = await loginHandler(req);
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.error).toBe('Invalid email or password');
    });

    it('should reject non-existent user with 401 Unauthorized', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'nonexistent.user.2026@lastmile.local',
          password: 'AnyPassword123!',
        }),
      });

      const res = await loginHandler(req);
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.error).toBe('Invalid email or password');
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should return 200 and expire auth-token cookie', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/logout', {
        method: 'POST',
      });

      const res = await logoutHandler(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);

      const cookie = res.headers.get('set-cookie');
      expect(cookie).toContain('auth-token=');
      expect(cookie).toMatch(/Max-Age=0|expires=/i);
    });
  });

  describe('GET /api/auth/me', () => {
    let meUser: any;
    let validToken: string;

    beforeAll(async () => {
      await prisma.user.deleteMany({ where: { email: meEmail } });

      meUser = await prisma.user.create({
        data: {
          name: 'Me Endpoint User',
          email: meEmail,
          passwordHash: await hashPassword(rawPassword),
          role: 'ADMIN',
        },
      });

      validToken = await createSessionToken({
        userId: meUser.id,
        email: meUser.email,
        role: 'ADMIN',
        name: meUser.name,
      });
    });

    it('should return user profile when authenticated via Bearer token', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/me', {
        headers: {
          Authorization: `Bearer ${validToken}`,
        },
      });

      const res = await meHandler(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.user.id).toBe(meUser.id);
      expect(json.user.email).toBe(meUser.email);
      expect(json.user.role).toBe('ADMIN');
    });

    it('should return user profile when authenticated via auth-token cookie', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/me', {
        headers: {
          Cookie: `auth-token=${validToken}`,
        },
      });

      const res = await meHandler(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.user.id).toBe(meUser.id);
    });

    it('should reject request without token (401 Unauthorized)', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/me');
      const res = await meHandler(req);
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.error).toMatch(/no token provided/i);
    });

    it('should reject request with expired or malformed token (401 Unauthorized)', async () => {
      const req = new NextRequest('http://localhost:3000/api/auth/me', {
        headers: {
          Authorization: 'Bearer invalid.tampered.token',
        },
      });

      const res = await meHandler(req);
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.error).toMatch(/invalid or expired token/i);
    });
  });
});
