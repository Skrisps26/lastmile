import { AUTH_COOKIE_NAME, TOKEN_EXPIRATION_SECONDS } from './constants';

export interface CookieOptions {
  name?: string;
  value: string;
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  path?: string;
}

/**
 * Generates Set-Cookie header options for session establishment.
 */
export function getAuthCookieOptions(token: string) {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    name: AUTH_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: TOKEN_EXPIRATION_SECONDS,
  };
}

/**
 * Generates Set-Cookie header options for session clearance (logout).
 */
export function getLogoutCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    name: AUTH_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 0,
    expires: new Date(0),
  };
}
