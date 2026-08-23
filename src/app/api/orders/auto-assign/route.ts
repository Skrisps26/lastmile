// /home/skrisps/lastmile/src/app/api/orders/auto-assign/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/guard';
import { USER_ROLES } from '@/lib/auth/constants';
import { batchAutoAssignOrders } from '@/lib/agents/assignment';

/**
 * POST /api/orders/auto-assign
 * Executes batch auto-dispatching for all unassigned orders in CREATED or RESCHEDULED state.
 * Accessible to ADMIN role.
 */
export async function POST(req: NextRequest | Request) {
  try {
    const authResult = await requireRole(req, [USER_ROLES.ADMIN]);
    if (authResult.user === null) {
      return authResult.response;
    }

    const summary = await batchAutoAssignOrders();

    return NextResponse.json(summary, { status: 200 });
  } catch (error: any) {
    console.error('POST /api/orders/auto-assign error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error during batch auto-assignment' },
      { status: 500 }
    );
  }
}
