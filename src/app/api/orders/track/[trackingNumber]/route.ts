// /home/skrisps/lastmile/src/app/api/orders/track/[trackingNumber]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import {
  getOrderByTrackingNumber,
  OrderNotFoundError,
} from '@/lib/orders/service';

/**
 * GET /api/orders/track/:trackingNumber
 * Public endpoint returning sanitized tracking details, progress, and timeline events.
 */
export async function GET(
  _req: NextRequest | Request,
  { params }: { params: { trackingNumber: string } | Promise<{ trackingNumber: string }> }
) {
  try {
    const { trackingNumber } = await Promise.resolve(params);

    if (!trackingNumber || trackingNumber.trim().length === 0) {
      return NextResponse.json(
        { error: 'Tracking number parameter is required.' },
        { status: 400 }
      );
    }

    const trackingDetails = await getOrderByTrackingNumber(trackingNumber);

    return NextResponse.json(trackingDetails, { status: 200 });
  } catch (error: any) {
    if (error instanceof OrderNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    console.error('GET /api/orders/track/:trackingNumber error:', error);
    return NextResponse.json(
      { error: 'Internal server error retrieving tracking information.' },
      { status: 500 }
    );
  }
}
