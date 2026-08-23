// /home/skrisps/lastmile/src/app/api/orders/[id]/auto-assign/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/guard';
import { USER_ROLES } from '@/lib/auth/constants';
import { autoAssignOrder } from '@/lib/agents/assignment';
import { OrderNotFoundError } from '@/lib/orders/service';

/**
 * POST /api/orders/:id/auto-assign
 * Executes zone-based auto-assignment for a single order.
 * Accessible strictly to ADMIN role.
 */
export async function POST(
  req: NextRequest | Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const authResult = await requireRole(req, [USER_ROLES.ADMIN]);
    if (authResult.user === null) {
      return authResult.response;
    }

    const { id } = await Promise.resolve(params);

    const result = await autoAssignOrder(id);

    return NextResponse.json(result, { status: 200 });
  } catch (error: any) {
    if (error instanceof OrderNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    console.error('POST /api/orders/:id/auto-assign error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error during order auto-assignment' },
      { status: 500 }
    );
  }
}
