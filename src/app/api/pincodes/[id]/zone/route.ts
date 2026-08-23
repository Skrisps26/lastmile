import { NextRequest, NextResponse } from 'next/server';
import { validateServiceability } from '@/lib/rate-engine/detector';

export async function GET(
  req: NextRequest | Request,
  { params }: { params: { id?: string; pincode?: string } }
) {
  try {
    const id = params.id ?? params.pincode ?? '';
    const result = await validateServiceability(id);

    if (!result.serviceable) {
      return NextResponse.json(
        {
          serviceable: false,
          pincode: result.pincode,
          error: result.error || `Pincode '${id}' is not serviceable`,
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
    console.error('GET /api/pincodes/:id/zone error:', error);
    return NextResponse.json(
      { error: 'Failed to resolve pincode zone serviceability' },
      { status: 500 }
    );
  }
}
