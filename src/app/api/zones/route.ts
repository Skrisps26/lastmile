// /home/skrisps/lastmile/src/app/api/zones/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole, getAuthenticatedUser } from '@/lib/auth/guard';
import { createZoneSchema } from '@/lib/rate-engine/schemas';

export async function GET(req: NextRequest | Request) {
  try {
    const user = await getAuthenticatedUser(req);
    const { searchParams } = new URL(req.url);
    const includeInactive = searchParams.get('includeInactive') === 'true';
    const search = searchParams.get('search')?.trim();

    // If user is not admin, only active zones are visible
    const isAdmin = user?.role === 'ADMIN';
    const whereClause: any = {};

    if (!isAdmin || !includeInactive) {
      whereClause.isActive = true;
    }

    if (search) {
      whereClause.OR = [
        { name: { contains: search } },
        { code: { contains: search } },
      ];
    }

    const zones = await prisma.zone.findMany({
      where: whereClause,
      include: {
        _count: {
          select: {
            pincodes: true,
            agentZones: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({ zones }, { status: 200 });
  } catch (error: any) {
    console.error('GET /api/zones error:', error);
    return NextResponse.json({ error: 'Failed to retrieve zones' }, { status: 500 });
  }
}

export async function POST(req: NextRequest | Request) {
  try {
    const guard = await requireRole(req, 'ADMIN');
    if (guard.user === null) return guard.response;

    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const validation = createZoneSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { name, code, description, isActive } = validation.data;

    // Check code/name collision
    const existing = await prisma.zone.findFirst({
      where: {
        OR: [{ code }, { name }],
      },
    });

    if (existing) {
      const field = existing.code.toUpperCase() === code.toUpperCase() ? 'code' : 'name';
      return NextResponse.json(
        { error: `Zone with this ${field} already exists` },
        { status: 409 }
      );
    }

    const createdZone = await prisma.zone.create({
      data: {
        name,
        code,
        description: description ?? null,
        isActive: isActive ?? true,
      },
      include: {
        _count: {
          select: { pincodes: true, agentZones: true },
        },
      },
    });

    return NextResponse.json({ zone: createdZone }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/zones error:', error);
    return NextResponse.json({ error: 'Failed to create zone' }, { status: 500 });
  }
}
