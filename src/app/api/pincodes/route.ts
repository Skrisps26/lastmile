// /home/skrisps/lastmile/src/app/api/pincodes/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole, getAuthenticatedUser } from '@/lib/auth/guard';
import { createPincodeSchema } from '@/lib/rate-engine/schemas';

export async function GET(req: NextRequest | Request) {
  try {
    const { searchParams } = new URL(req.url);
    const zoneId = searchParams.get('zoneId')?.trim();
    const search = searchParams.get('search')?.trim();
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const skip = (page - 1) * limit;

    const user = await getAuthenticatedUser(req);
    const isAdmin = user?.role === 'ADMIN';

    const whereClause: any = {};
    if (zoneId) {
      whereClause.zoneId = zoneId;
    }
    if (search) {
      whereClause.OR = [
        { pincode: { contains: search } },
        { areaName: { contains: search } },
      ];
    }
    if (!isAdmin) {
      whereClause.zone = { isActive: true };
    }

    const [total, pincodes] = await Promise.all([
      prisma.pincodeMapping.count({ where: whereClause }),
      prisma.pincodeMapping.findMany({
        where: whereClause,
        include: {
          zone: true,
        },
        skip,
        take: limit,
        orderBy: { pincode: 'asc' },
      }),
    ]);

    return NextResponse.json(
      {
        pincodes,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('GET /api/pincodes error:', error);
    return NextResponse.json({ error: 'Failed to retrieve pincode mappings' }, { status: 500 });
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

    const validation = createPincodeSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { pincode, areaName, zoneId } = validation.data;

    // Check if zone exists
    const zone = await prisma.zone.findUnique({
      where: { id: zoneId },
    });

    if (!zone) {
      return NextResponse.json(
        { error: `Referenced zoneId '${zoneId}' does not exist` },
        { status: 400 }
      );
    }

    // Check if pincode already exists
    const existing = await prisma.pincodeMapping.findUnique({
      where: { pincode: pincode.trim() },
    });

    if (existing) {
      return NextResponse.json(
        { error: `Pincode '${pincode}' is already mapped to a zone` },
        { status: 409 }
      );
    }

    const created = await prisma.pincodeMapping.create({
      data: {
        pincode: pincode.trim(),
        areaName: areaName?.trim() ?? null,
        zoneId,
      },
      include: {
        zone: true,
      },
    });

    return NextResponse.json({ pincodeMapping: created }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/pincodes error:', error);
    return NextResponse.json({ error: 'Failed to create pincode mapping' }, { status: 500 });
  }
}
