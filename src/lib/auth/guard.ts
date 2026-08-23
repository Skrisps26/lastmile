import { NextRequest, NextResponse } from 'next/server';
import { extractTokenFromRequest } from './extract';
import { verifySessionToken, type AuthSessionUser } from './jwt';
import { type UserRole } from './constants';

export interface GuardSuccess {
  user: AuthSessionUser;
  error: null;
}

export interface GuardFailure {
  user: null;
  error: string;
  statusCode: 401 | 403;
  response: NextResponse;
}

export type GuardResult = GuardSuccess | GuardFailure;

/**
 * Authenticates the request by verifying the session token.
 * Returns the decoded AuthSessionUser or null.
 */
export async function getAuthenticatedUser(req: Request | NextRequest): Promise<AuthSessionUser | null> {
  const token = extractTokenFromRequest(req);
  if (!token) return null;

  const payload = await verifySessionToken(token);
  if (!payload) return null;

  return {
    userId: payload.userId,
    email: payload.email,
    role: payload.role,
    name: payload.name,
  };
}

/**
 * Guard that enforces valid authentication on an API route.
 */
export async function requireAuth(req: Request | NextRequest): Promise<GuardResult> {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return {
      user: null,
      error: 'Unauthorized: Authentication required',
      statusCode: 401,
      response: NextResponse.json(
        { error: 'Unauthorized: Authentication required' },
        { status: 401 }
      ),
    };
  }

  return { user, error: null };
}

/**
 * Guard that enforces both valid authentication AND role membership.
 */
export async function requireRole(
  req: Request | NextRequest,
  allowedRoles: UserRole | UserRole[]
): Promise<GuardResult> {
  const authResult = await requireAuth(req);
  if (authResult.user === null) {
    return authResult;
  }

  const user = authResult.user;
  const rolesArray = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  if (!rolesArray.includes(user.role)) {
    return {
      user: null,
      error: `Forbidden: Access restricted to roles [${rolesArray.join(', ')}]`,
      statusCode: 403,
      response: NextResponse.json(
        { error: `Forbidden: Insufficient role permissions` },
        { status: 403 }
      ),
    };
  }

  return { user, error: null };
}
