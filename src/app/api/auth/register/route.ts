import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { registerSchema } from '@/lib/auth/schemas';
import { hashPassword } from '@/lib/auth/password';
import { createSessionToken } from '@/lib/auth/jwt';
import { getAuthCookieOptions } from '@/lib/auth/cookies';

export async function POST(req: NextRequest | Request) {
  try {
    const body = await req.json();
    const validation = registerSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: validation.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { name, email, password, phone, role, vehicleType, vehicleNumber } = validation.data;

    // Check for email collision
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'A user with this email address already exists' },
        { status: 409 }
      );
    }

    // Hash password with bcrypt (salt rounds = 10)
    const passwordHash = await hashPassword(password);

    // Create user and associated agent profile if role === 'AGENT'
    const newUser = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        phone: phone || null,
        role,
        ...(role === 'AGENT'
          ? {
              agentProfile: {
                create: {
                  status: 'AVAILABLE',
                  vehicleType: vehicleType || 'BIKE',
                  vehicleNumber: vehicleNumber || null,
                  maxCapacity: 10,
                  activeOrdersCount: 0,
                },
              },
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        createdAt: true,
        agentProfile: true,
      },
    });

    // Generate JWT token
    const token = await createSessionToken({
      userId: newUser.id,
      email: newUser.email,
      role: newUser.role as any,
      name: newUser.name,
    });

    const cookieOptions = getAuthCookieOptions(token);

    const response = NextResponse.json(
      {
        message: 'Registration successful',
        user: newUser,
        token,
      },
      { status: 201 }
    );

    response.cookies.set(cookieOptions);
    return response;
  } catch (error: any) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred during registration' },
      { status: 500 }
    );
  }
}
