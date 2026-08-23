import { SignJWT, jwtVerify, type JWTPayload as JoseJWTPayload } from 'jose';
import { TOKEN_EXPIRATION_STR, type UserRole } from './constants';

export interface UserJWTPayload extends JoseJWTPayload {
  userId: string;
  email: string;
  role: UserRole;
  name: string;
}

export interface AuthSessionUser {
  userId: string;
  email: string;
  role: UserRole;
  name: string;
}

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET || 'lastmile-secure-jwt-secret-key-development-2026-minimum-32-chars';
  return new TextEncoder().encode(secret);
}

/**
 * Creates a signed JWT token containing user identity and role claims.
 */
export async function createSessionToken(
  payload: AuthSessionUser,
  expiresIn: string = TOKEN_EXPIRATION_STR
): Promise<string> {
  const secret = getJwtSecret();
  
  return new SignJWT({
    userId: payload.userId,
    email: payload.email,
    role: payload.role,
    name: payload.name,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);
}

/**
 * Alias for createSessionToken.
 */
export const signToken = createSessionToken;

/**
 * Verifies and decodes a JWT token. Returns null if invalid or expired.
 */
export async function verifySessionToken(token: string): Promise<UserJWTPayload | null> {
  if (!token || typeof token !== 'string') {
    return null;
  }

  try {
    const secret = getJwtSecret();
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
    });

    if (
      !payload.userId ||
      typeof payload.userId !== 'string' ||
      !payload.email ||
      !payload.role ||
      !payload.name
    ) {
      return null;
    }

    return payload as UserJWTPayload;
  } catch (error) {
    // Catches JWTExpired, JWTInvalid, JWSInvalid, SignatureVerificationFailed, etc.
    return null;
  }
}

/**
 * Alias for verifySessionToken.
 */
export const verifyToken = verifySessionToken;
