// /home/skrisps/lastmile/src/app/api/pincodes/bulk/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth/guard';
import { bulkCreatePincodeSchema } from '@/lib/rate-engine/schemas';

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

    const validation = bulkCreatePincodeSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { items } = validation.data;

    // Validate that all referenced zoneIds exist
    const uniqueZoneIds = Array.from(new Set(items.map((i) => i.zoneId)));
    const existingZones = await prisma.zone.findMany({
      where: { id: { in: uniqueZoneIds } },
      select: { id: true },
    });
    const foundZoneIdSet = new Set(existingZones.map((z) => z.id));

    const missingZoneIds = uniqueZoneIds.filter((zId) => !foundZoneIdSet.has(zId));
    if (missingZoneIds.length > 0) {
      return NextResponse.json(
        { error: `Referenced zoneId(s) do not exist: ${missingZoneIds.join(', ')}` },
        { status: 400 }
      );
    }

    // Execute atomic transactional upsert
    const results = await prisma.$transaction(
      items.map((item) =>
        prisma.pincodeMapping.upsert({
          where: { pincode: item.pincode.trim() },
          update: {
            areaName: item.areaName?.trim() ?? null,
            zoneId: item.zoneId,
          },
          create: {
            pincode: item.pincode.trim(),
            areaName: item.areaName?.trim() ?? null,
            zoneId: item.zoneId,
          },
        })
      )
    );

    return NextResponse.json(
      {
        success: true,
        count: results.length,
        message: `Successfully imported and mapped ${results.length} pincodes`,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('POST /api/pincodes/bulk error:', error);
    return NextResponse.json({ error: 'Failed to process bulk pincode import' }, { status: 500 });
  }
}
