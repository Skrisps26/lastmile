// /home/skrisps/lastmile/src/app/api/rates/cards/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole, getAuthenticatedUser } from '@/lib/auth/guard';
import { createRateCardSchema } from '@/lib/rate-engine/schemas';

export async function GET(req: NextRequest | Request) {
  try {
    const { searchParams } = new URL(req.url);
    const zoneType = searchParams.get('zoneType')?.trim();
    const customerType = searchParams.get('customerType')?.trim();
    const isActiveParam = searchParams.get('isActive');

    const user = await getAuthenticatedUser(req);
    const isAdmin = user?.role === 'ADMIN';

    const where: any = {};
    if (zoneType) where.zoneType = zoneType;
    if (customerType) where.customerType = customerType;

    if (isActiveParam !== null && isActiveParam !== undefined) {
      where.isActive = isActiveParam === 'true';
    } else if (!isAdmin) {
      where.isActive = true;
    }

    const rateCards = await prisma.rateCard.findMany({
      where,
      orderBy: [
        { zoneType: 'asc' },
        { customerType: 'asc' },
        { createdAt: 'desc' },
      ],
    });

    return NextResponse.json({ rateCards }, { status: 200 });
  } catch (error: any) {
    console.error('GET /api/rates/cards error:', error);
    return NextResponse.json({ error: 'Failed to retrieve rate cards' }, { status: 500 });
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

    const validation = createRateCardSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const data = validation.data;

    // If new rate card is active, deactivate existing active cards for this combination
    // to maintain active uniqueness while preserving version history
    if (data.isActive) {
      await prisma.rateCard.updateMany({
        where: {
          zoneType: data.zoneType,
          customerType: data.customerType,
          isActive: true,
        },
        data: { isActive: false },
      });
    }

    const rateCard = await prisma.rateCard.create({
      data: {
        zoneType: data.zoneType,
        customerType: data.customerType,
        baseWeightKg: data.baseWeightKg,
        baseRate: data.baseRate,
        perKgRate: data.perKgRate,
        volumetricDivisor: data.volumetricDivisor,
        codFixedSurcharge: data.codFixedSurcharge,
        codPercentSurcharge: data.codPercentSurcharge,
        minCodSurcharge: data.minCodSurcharge,
        isActive: data.isActive,
      },
    });

    return NextResponse.json({ rateCard }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/rates/cards error:', error);
    return NextResponse.json({ error: 'Failed to create rate card' }, { status: 500 });
  }
}
