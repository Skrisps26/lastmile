import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { loginSchema } from '@/lib/auth/schemas';
import { verifyPassword } from '@/lib/auth/password';
import { createSessionToken } from '@/lib/auth/jwt';
import { getAuthCookieOptions } from '@/lib/auth/cookies';

export async function POST(req: NextRequest | Request) {
  try {
    const body = await req.json();
    const validation = loginSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: validation.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { email, password } = validation.data;

    // Find user by email (case-insensitive in DB or lowercased via zod)
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        agentProfile: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Verify bcrypt hash
    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Generate JWT token
    const token = await createSessionToken({
      userId: user.id,
      email: user.email,
      role: user.role as any,
      name: user.name,
    });

    const cookieOptions = getAuthCookieOptions(token);

    // Sanitize user object (exclude passwordHash)
    const { passwordHash: _, ...safeUser } = user;

    const response = NextResponse.json(
      {
        message: 'Login successful',
        user: safeUser,
        token,
      },
      { status: 200 }
    );

    response.cookies.set(cookieOptions);
    return response;
  } catch (error: any) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred during login' },
      { status: 500 }
    );
  }
}
