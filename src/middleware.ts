import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken } from '@/lib/auth/jwt';
import { AUTH_COOKIE_NAME } from '@/lib/auth/constants';

// Protected portal route rules
const ROUTE_PERMISSIONS = [
  { prefix: '/customer', allowedRoles: ['CUSTOMER', 'ADMIN'] },
  { prefix: '/agent', allowedRoles: ['AGENT', 'ADMIN'] },
  { prefix: '/admin', allowedRoles: ['ADMIN'] },
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Find if current path is a protected portal route
  const matchedRule = ROUTE_PERMISSIONS.find((rule) => pathname.startsWith(rule.prefix));
  if (!matchedRule) {
    return NextResponse.next();
  }

  // Extract session token from cookie
  const token = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  if (!token) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  const payload = await verifySessionToken(token);
  if (!payload) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('redirect', pathname);
    // Clear invalid cookie
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete(AUTH_COOKIE_NAME);
    return response;
  }

  // Check role authorization
  if (!matchedRule.allowedRoles.includes(payload.role)) {
    // Redirect to default home or unauthorized view
    return NextResponse.redirect(new URL('/unauthorized', req.url));
  }

  // Attach verified user identity in request headers for downstream server components
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-user-id', payload.userId);
  requestHeaders.set('x-user-email', payload.email);
  requestHeaders.set('x-user-role', payload.role);

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: [
    '/customer/:path*',
    '/agent/:path*',
    '/admin/:path*',
  ],
};
