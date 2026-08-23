import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { extractTokenFromRequest } from '@/lib/auth/extract';
import { verifySessionToken } from '@/lib/auth/jwt';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest | Request) {
  try {
    const token = extractTokenFromRequest(req);

    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized: No token provided' },
        { status: 401 }
      );
    }

    const payload = await verifySessionToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: 'Unauthorized: Invalid or expired token' },
        { status: 401 }
      );
    }

    // Query database for fresh user profile, agent metadata, and saved addresses
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        phone: true,
        createdAt: true,
        agentProfile: {
          include: {
            operationalZones: {
              include: {
                zone: true,
              },
            },
          },
        },
        addresses: {
          orderBy: {
            isDefault: 'desc',
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized: User no longer exists' },
        { status: 401 }
      );
    }

    return NextResponse.json({ user }, { status: 200 });
  } catch (error: any) {
    console.error('Auth /me error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred retrieving profile' },
      { status: 500 }
    );
  }
}
