// /home/skrisps/lastmile/src/app/api/rates/cards/[id]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth/guard';
import { updateRateCardSchema } from '@/lib/rate-engine/schemas';

export async function GET(
  req: NextRequest | Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    const rateCard = await prisma.rateCard.findUnique({
      where: { id },
    });

    if (!rateCard) {
      return NextResponse.json({ error: `Rate card '${id}' not found` }, { status: 404 });
    }

    return NextResponse.json({ rateCard }, { status: 200 });
  } catch (error: any) {
    console.error('GET /api/rates/cards/:id error:', error);
    return NextResponse.json({ error: 'Failed to retrieve rate card' }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest | Request,
  { params }: { params: { id: string } }
) {
  try {
    const guard = await requireRole(req, 'ADMIN');
    if (guard.user === null) return guard.response;

    const { id } = params;
    const existing = await prisma.rateCard.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ error: `Rate card '${id}' not found` }, { status: 404 });
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const validation = updateRateCardSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const updateData = validation.data;
    const targetZoneType = updateData.zoneType || existing.zoneType;
    const targetCustomerType = updateData.customerType || existing.customerType;

    // If activating or updating to active, deactivate existing active cards for this target combination
    if (updateData.isActive === true) {
      await prisma.rateCard.updateMany({
        where: {
          id: { not: existing.id },
          zoneType: targetZoneType,
          customerType: targetCustomerType,
          isActive: true,
        },
        data: { isActive: false },
      });
    }

    const updated = await prisma.rateCard.update({
      where: { id: existing.id },
      data: updateData,
    });

    return NextResponse.json({ rateCard: updated }, { status: 200 });
  } catch (error: any) {
    console.error('PUT /api/rates/cards/:id error:', error);
    return NextResponse.json({ error: 'Failed to update rate card' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest | Request,
  { params }: { params: { id: string } }
) {
  try {
    const guard = await requireRole(req, 'ADMIN');
    if (guard.user === null) return guard.response;

    const { id } = params;
    const existing = await prisma.rateCard.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json({ error: `Rate card '${id}' not found` }, { status: 404 });
    }

    await prisma.rateCard.delete({
      where: { id: existing.id },
    });

    return NextResponse.json(
      { message: 'Rate card deleted successfully', id: existing.id },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('DELETE /api/rates/cards/:id error:', error);
    return NextResponse.json({ error: 'Failed to delete rate card' }, { status: 500 });
  }
}
