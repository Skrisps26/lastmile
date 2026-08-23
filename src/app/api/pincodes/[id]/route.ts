// /home/skrisps/lastmile/src/app/api/pincodes/[id]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth/guard';
import { updatePincodeSchema } from '@/lib/rate-engine/schemas';

export async function GET(
  req: NextRequest | Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    const pincodeMapping = await prisma.pincodeMapping.findFirst({
      where: {
        OR: [{ id }, { pincode: id }],
      },
      include: {
        zone: true,
      },
    });

    if (!pincodeMapping) {
      return NextResponse.json(
        { error: `Pincode mapping '${id}' not found` },
        { status: 404 }
      );
    }

    return NextResponse.json({ pincodeMapping }, { status: 200 });
  } catch (error: any) {
    console.error('GET /api/pincodes/:id error:', error);
    return NextResponse.json({ error: 'Failed to retrieve pincode mapping' }, { status: 500 });
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
    const existing = await prisma.pincodeMapping.findFirst({
      where: { OR: [{ id }, { pincode: id }] },
    });

    if (!existing) {
      return NextResponse.json(
        { error: `Pincode mapping '${id}' not found` },
        { status: 404 }
      );
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const validation = updatePincodeSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const updateData: any = {};
    if (validation.data.areaName !== undefined) {
      updateData.areaName = validation.data.areaName?.trim() ?? null;
    }
    if (validation.data.zoneId !== undefined) {
      const zone = await prisma.zone.findUnique({
        where: { id: validation.data.zoneId },
      });
      if (!zone) {
        return NextResponse.json(
          { error: `Referenced zoneId '${validation.data.zoneId}' does not exist` },
          { status: 400 }
        );
      }
      updateData.zoneId = validation.data.zoneId;
    }

    const updated = await prisma.pincodeMapping.update({
      where: { id: existing.id },
      data: updateData,
      include: {
        zone: true,
      },
    });

    return NextResponse.json({ pincodeMapping: updated }, { status: 200 });
  } catch (error: any) {
    console.error('PUT /api/pincodes/:id error:', error);
    return NextResponse.json({ error: 'Failed to update pincode mapping' }, { status: 500 });
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
    const existing = await prisma.pincodeMapping.findFirst({
      where: { OR: [{ id }, { pincode: id }] },
    });

    if (!existing) {
      return NextResponse.json(
        { error: `Pincode mapping '${id}' not found` },
        { status: 404 }
      );
    }

    await prisma.pincodeMapping.delete({
      where: { id: existing.id },
    });

    return NextResponse.json(
      { message: 'Pincode mapping deleted successfully', id: existing.id, pincode: existing.pincode },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('DELETE /api/pincodes/:id error:', error);
    return NextResponse.json({ error: 'Failed to delete pincode mapping' }, { status: 500 });
  }
}
