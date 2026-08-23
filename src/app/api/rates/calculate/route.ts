// /home/skrisps/lastmile/src/app/api/rates/calculate/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { calculateRateRequestSchema } from '@/lib/rate-engine/schemas';
import { computeRateQuote } from '@/lib/rate-engine/calculator';
import { lookupPincode } from '@/lib/rate-engine/detector';

export async function POST(req: NextRequest | Request) {
  try {
    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parseResult = calculateRateRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parseResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const data = parseResult.data;

    // 1. Resolve Pickup Zone
    const pickupInfo = await lookupPincode(data.pickupPincode);
    if (!pickupInfo) {
      return NextResponse.json(
        { error: `Pickup pincode ${data.pickupPincode} is not serviceable` },
        { status: 404 }
      );
    }

    // 2. Resolve Drop Zone
    const dropInfo = await lookupPincode(data.dropPincode);
    if (!dropInfo) {
      return NextResponse.json(
        { error: `Drop pincode ${data.dropPincode} is not serviceable` },
        { status: 404 }
      );
    }

    // 3. Determine Zone Type
    const zoneType = pickupInfo.zone.id === dropInfo.zone.id ? 'INTRA_ZONE' : 'INTER_ZONE';

    // 4. Load Active Rate Card from DB
    const rateCard = await prisma.rateCard.findFirst({
      where: {
        zoneType,
        customerType: data.customerType,
        isActive: true,
      },
    });

    if (!rateCard) {
      return NextResponse.json(
        { error: `No active rate card configured for ${zoneType} and ${data.customerType}` },
        { status: 422 }
      );
    }

    // 5. Execute Pure Math Engine
    const calculation = computeRateQuote(data, rateCard);

    // 6. Build and Return Itemized Breakdown Response
    const responsePayload = {
      pickupZone: {
        id: pickupInfo.zone.id,
        name: pickupInfo.zone.name,
        code: pickupInfo.zone.code,
      },
      dropZone: {
        id: dropInfo.zone.id,
        name: dropInfo.zone.name,
        code: dropInfo.zone.code,
      },
      zoneType,
      customerType: data.customerType,
      actualWeightKg: calculation.actualWeightKg,
      volumetricWeightKg: calculation.volumetricWeightKg,
      billableWeightKg: calculation.billableWeightKg,
      volumetricDivisor: calculation.volumetricDivisor,
      baseWeightKg: rateCard.baseWeightKg,
      baseRate: rateCard.baseRate,
      perKgRate: rateCard.perKgRate,
      excessWeightKg: calculation.excessWeightKg,
      basePrice: calculation.basePrice,
      weightPrice: calculation.weightPrice,
      codSurcharge: calculation.codSurcharge,
      totalAmount: calculation.totalAmount,
      rateCardId: rateCard.id,
      breakdown: {
        basePrice: calculation.basePrice,
        weightPrice: calculation.weightPrice,
        codSurcharge: calculation.codSurcharge,
        totalAmount: calculation.totalAmount,
      },
    };

    return NextResponse.json(responsePayload, { status: 200 });
  } catch (error: any) {
    console.error('POST /api/rates/calculate error:', error);
    return NextResponse.json(
      { error: 'Internal server error calculating rate' },
      { status: 500 }
    );
  }
}
