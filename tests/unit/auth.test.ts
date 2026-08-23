import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, comparePassword } from '@/lib/auth/password';
import { createSessionToken, verifySessionToken, signToken, verifyToken } from '@/lib/auth/jwt';
import { extractTokenFromRequest } from '@/lib/auth/extract';
import { requireAuth, requireRole, getAuthenticatedUser } from '@/lib/auth/guard';

describe('Unit: Password Hashing & Verification Subsystem', () => {
  it('should hash password with bcrypt salt rounds = 10', async () => {
    const plain = 'SuperSecret123!';
    const hash = await hashPassword(plain);

    expect(hash).toBeDefined();
    expect(typeof hash).toBe('string');
    // Bcrypt hashes start with $2a$10$ or $2b$10$
    expect(hash).toMatch(/^\$2[ab]\$10\$/);
  });

  it('should generate unique salts for identical passwords', async () => {
    const plain = 'IdenticalPassword2026';
    const hash1 = await hashPassword(plain);
    const hash2 = await hashPassword(plain);

    expect(hash1).not.toBe(hash2);
  });

  it('should verify matching plaintext password against hash using verifyPassword and comparePassword', async () => {
    const plain = 'ValidPasswordPass123';
    const hash = await hashPassword(plain);

    const isMatch = await verifyPassword(plain, hash);
    expect(isMatch).toBe(true);

    const isCompareMatch = await comparePassword(plain, hash);
    expect(isCompareMatch).toBe(true);
  });

  it('should reject incorrect plaintext password against hash', async () => {
    const plain = 'OriginalPassword';
    const hash = await hashPassword(plain);

    const isMatch = await verifyPassword('WrongPassword', hash);
    expect(isMatch).toBe(false);
  });

  it('should return false when verifying with empty or invalid hash', async () => {
    expect(await verifyPassword('Password', '')).toBe(false);
    expect(await verifyPassword('', '$2b$10$invalidhashlength')).toBe(false);
  });

  it('should throw error on invalid password input to hashPassword', async () => {
    await expect(hashPassword('')).rejects.toThrow();
    // @ts-expect-error testing runtime validation
    await expect(hashPassword(null)).rejects.toThrow();
  });
});

describe('Unit: JWT Session Management Subsystem (jose)', () => {
  const mockUser = {
    userId: 'usr_cuid_test_123',
    email: 'test.customer@lastmile.local',
    role: 'CUSTOMER' as const,
    name: 'Jane Customer',
  };

  it('should create a valid 3-part JWT token using createSessionToken and signToken', async () => {
    const token1 = await createSessionToken(mockUser);
    expect(token1).toBeDefined();
    expect(token1.split('.').length).toBe(3);

    const token2 = await signToken(mockUser);
    expect(token2).toBeDefined();
    expect(token2.split('.').length).toBe(3);
  });

  it('should verify and decode valid token claims using verifySessionToken and verifyToken', async () => {
    const token = await createSessionToken(mockUser);
    const decoded = await verifySessionToken(token);

    expect(decoded).not.toBeNull();
    expect(decoded?.userId).toBe(mockUser.userId);
    expect(decoded?.email).toBe(mockUser.email);
    expect(decoded?.role).toBe('CUSTOMER');
    expect(decoded?.name).toBe(mockUser.name);
    expect(decoded?.exp).toBeDefined();
    expect(decoded?.iat).toBeDefined();

    const decoded2 = await verifyToken(token);
    expect(decoded2?.userId).toBe(mockUser.userId);
  });

  it('should reject malformed or tampered token strings', async () => {
    const token = await createSessionToken(mockUser);
    const tampered = token.slice(0, -5) + 'abcde';

    const result = await verifySessionToken(tampered);
    expect(result).toBeNull();

    expect(await verifySessionToken('random-garbage-string')).toBeNull();
    expect(await verifySessionToken('')).toBeNull();
  });

  it('should reject expired tokens', async () => {
    const expiredToken = await createSessionToken(mockUser, '-1s');
    const result = await verifySessionToken(expiredToken);
    expect(result).toBeNull();
  });
});

describe('Unit: RBAC & Route Protection Guards', () => {
  it('should extract token from Authorization Bearer header', () => {
    const req = new Request('http://localhost:3000/api/orders', {
      headers: {
        Authorization: 'Bearer test-jwt-token-value',
      },
    });

    const token = extractTokenFromRequest(req);
    expect(token).toBe('test-jwt-token-value');
  });

  it('should extract token from auth-token Cookie header', () => {
    const req = new Request('http://localhost:3000/api/orders', {
      headers: {
        Cookie: 'other=123; auth-token=cookie-jwt-token-value; theme=dark',
      },
    });

    const token = extractTokenFromRequest(req);
    expect(token).toBe('cookie-jwt-token-value');
  });

  it('should prioritize Authorization Bearer header over Cookie', () => {
    const req = new Request('http://localhost:3000/api/orders', {
      headers: {
        Authorization: 'Bearer bearer-token-wins',
        Cookie: 'auth-token=cookie-token',
      },
    });

    const token = extractTokenFromRequest(req);
    expect(token).toBe('bearer-token-wins');
  });

  it('requireAuth should allow authenticated requests', async () => {
    const token = await createSessionToken({
      userId: 'usr_1',
      email: 'admin@lastmile.local',
      role: 'ADMIN',
      name: 'System Admin',
    });

    const req = new Request('http://localhost:3000/api/rates', {
      headers: { Authorization: `Bearer ${token}` },
    });

    const result = await requireAuth(req);
    expect(result.error).toBeNull();
    expect(result.user?.userId).toBe('usr_1');
    expect(result.user?.role).toBe('ADMIN');
  });

  it('requireAuth should reject unauthenticated requests with 401', async () => {
    const req = new Request('http://localhost:3000/api/rates');
    const result = await requireAuth(req);

    expect(result.user).toBeNull();
    if (result.user === null) {
      expect(result.statusCode).toBe(401);
    }
  });

  it('requireRole should enforce authorized roles and reject forbidden roles with 403', async () => {
    const customerToken = await createSessionToken({
      userId: 'cust_1',
      email: 'cust@lastmile.local',
      role: 'CUSTOMER',
      name: 'Customer 1',
    });

    const customerReq = new Request('http://localhost:3000/api/zones', {
      headers: { Authorization: `Bearer ${customerToken}` },
    });

    // Admin-only endpoint check
    const adminCheck = await requireRole(customerReq, 'ADMIN');
    expect(adminCheck.user).toBeNull();
    if (adminCheck.user === null) {
      expect(adminCheck.statusCode).toBe(403);
    }

    // Multi-role guard [CUSTOMER, AGENT] check
    const multiCheck = await requireRole(customerReq, ['CUSTOMER', 'AGENT']);
    expect(multiCheck.error).toBeNull();
    expect(multiCheck.user?.role).toBe('CUSTOMER');
  });

  it('getAuthenticatedUser should return user on valid token and null on invalid token', async () => {
    const token = await createSessionToken({
      userId: 'usr_2',
      email: 'agent@lastmile.local',
      role: 'AGENT',
      name: 'Agent Two',
    });

    const validReq = new Request('http://localhost:3000/api/orders', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const user = await getAuthenticatedUser(validReq);
    expect(user).not.toBeNull();
    expect(user?.email).toBe('agent@lastmile.local');

    const invalidReq = new Request('http://localhost:3000/api/orders');
    expect(await getAuthenticatedUser(invalidReq)).toBeNull();
  });
});
