// /home/skrisps/lastmile/src/app/api/zones/[id]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole, getAuthenticatedUser } from '@/lib/auth/guard';
import { updateZoneSchema } from '@/lib/rate-engine/schemas';

export async function GET(
  req: NextRequest | Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const user = await getAuthenticatedUser(req);
    const isAdmin = user?.role === 'ADMIN';

    const zone = await prisma.zone.findFirst({
      where: {
        OR: [{ id }, { code: id }],
        ...(isAdmin ? {} : { isActive: true }),
      },
      include: {
        pincodes: true,
        _count: {
          select: {
            pickupOrders: true,
            dropOrders: true,
            agentZones: true,
          },
        },
      },
    });

    if (!zone) {
      return NextResponse.json({ error: `Zone '${id}' not found` }, { status: 404 });
    }

    return NextResponse.json({ zone }, { status: 200 });
  } catch (error: any) {
    console.error('GET /api/zones/:id error:', error);
    return NextResponse.json({ error: 'Failed to retrieve zone' }, { status: 500 });
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
    const existing = await prisma.zone.findFirst({
      where: { OR: [{ id }, { code: id }] },
    });

    if (!existing) {
      return NextResponse.json({ error: `Zone '${id}' not found` }, { status: 404 });
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const validation = updateZoneSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const updateData = validation.data;

    // If updating name or code, ensure no collision with another zone
    if (updateData.name || updateData.code) {
      const conflict = await prisma.zone.findFirst({
        where: {
          id: { not: existing.id },
          OR: [
            ...(updateData.name ? [{ name: updateData.name }] : []),
            ...(updateData.code ? [{ code: updateData.code }] : []),
          ],
        },
      });
      if (conflict) {
        return NextResponse.json(
          { error: 'Zone with specified name or code already exists' },
          { status: 409 }
        );
      }
    }

    const updated = await prisma.zone.update({
      where: { id: existing.id },
      data: updateData,
    });

    return NextResponse.json({ zone: updated }, { status: 200 });
  } catch (error: any) {
    console.error('PUT /api/zones/:id error:', error);
    return NextResponse.json({ error: 'Failed to update zone' }, { status: 500 });
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
    const existing = await prisma.zone.findFirst({
      where: { OR: [{ id }, { code: id }] },
      include: {
        _count: {
          select: {
            pickupOrders: true,
            dropOrders: true,
          },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: `Zone '${id}' not found` }, { status: 404 });
    }

    const hasOrders = existing._count.pickupOrders > 0 || existing._count.dropOrders > 0;

    if (hasOrders) {
      // Soft-delete to prevent foreign key cascade errors on historical order records
      const deactivated = await prisma.zone.update({
        where: { id: existing.id },
        data: { isActive: false },
      });
      return NextResponse.json(
        {
          message: 'Zone has existing orders; deactivated instead of permanent deletion',
          zone: deactivated,
          softDeleted: true,
        },
        { status: 200 }
      );
    }

    await prisma.zone.delete({
      where: { id: existing.id },
    });

    return NextResponse.json(
      { message: 'Zone deleted successfully', id: existing.id },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('DELETE /api/zones/:id error:', error);
    return NextResponse.json({ error: 'Failed to delete zone' }, { status: 500 });
  }
}
