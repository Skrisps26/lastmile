// /home/skrisps/lastmile/src/app/api/pincodes/[pincode]/zone/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { validateServiceability } from '@/lib/rate-engine/detector';

export async function GET(
  req: NextRequest | Request,
  { params }: { params: { pincode: string } }
) {
  try {
    const { pincode } = params;
    const result = await validateServiceability(pincode);

    if (!result.serviceable) {
      return NextResponse.json(
        {
          serviceable: false,
          pincode: result.pincode,
          error: result.error || `Pincode '${pincode}' is not serviceable`,
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        serviceable: true,
        pincode: result.pincode,
        areaName: result.areaName,
        zone: result.zone,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('GET /api/pincodes/:pincode/zone error:', error);
    return NextResponse.json(
      { error: 'Failed to resolve pincode zone serviceability' },
      { status: 500 }
    );
  }
}
