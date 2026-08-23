import { NextRequest } from 'next/server';
import { AUTH_COOKIE_NAME } from './constants';

/**
 * Extracts JWT token from either:
 * 1. Authorization header ('Bearer <token>')
 * 2. HTTP-only Cookie ('auth-token')
 * 
 * Supports both NextRequest and standard Request instances.
 */
export function extractTokenFromRequest(req: Request | NextRequest): string | null {
  // 1. Check Authorization Bearer header
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    if (token) return token;
  }

  // 2. Check NextRequest cookies map if available
  if ('cookies' in req && typeof (req as NextRequest).cookies?.get === 'function') {
    const cookie = (req as NextRequest).cookies.get(AUTH_COOKIE_NAME);
    if (cookie?.value) return cookie.value;
  }

  // 3. Fallback: Parse raw Cookie header string
  const cookieHeader = req.headers.get('cookie') || req.headers.get('Cookie');
  if (cookieHeader) {
    const cookies = parseCookieHeader(cookieHeader);
    if (cookies[AUTH_COOKIE_NAME]) {
      return cookies[AUTH_COOKIE_NAME];
    }
  }

  return null;
}

function parseCookieHeader(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pairs = header.split(';');
  for (const pair of pairs) {
    const [key, ...values] = pair.trim().split('=');
    if (key) {
      result[key] = decodeURIComponent(values.join('='));
    }
  }
  return result;
}
