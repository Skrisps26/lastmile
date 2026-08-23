// /home/skrisps/lastmile/src/app/api/orders/[id]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/guard';
import {
  getOrderById,
  OrderNotFoundError,
  OrderAccessForbiddenError,
} from '@/lib/orders/service';

/**
 * GET /api/orders/:id
 * Retrieves full order details, projected current status, and full statusHistory ledger.
 */
export async function GET(
  req: NextRequest | Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth(req);
    if (authResult.user === null) {
      return authResult.response;
    }

    const { id } = await Promise.resolve(params);
    const order = await getOrderById(id, authResult.user);

    return NextResponse.json(order, { status: 200 });
  } catch (error: any) {
    if (error instanceof OrderNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof OrderAccessForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    console.error('GET /api/orders/:id error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error retrieving order' },
      { status: 500 }
    );
  }
}
