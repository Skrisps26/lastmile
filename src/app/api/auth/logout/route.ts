import { NextRequest, NextResponse } from 'next/server';
import { getLogoutCookieOptions } from '@/lib/auth/cookies';

export async function POST(req: NextRequest | Request) {
  try {
    const logoutOptions = getLogoutCookieOptions();

    const response = NextResponse.json(
      {
        message: 'Logged out successfully',
        success: true,
      },
      { status: 200 }
    );

    response.cookies.set(logoutOptions);
    return response;
  } catch (error: any) {
    console.error('Logout error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred during logout' },
      { status: 500 }
    );
  }
}
