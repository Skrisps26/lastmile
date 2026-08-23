// /home/skrisps/lastmile/src/app/api/orders/[id]/assign/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/guard';
import { USER_ROLES } from '@/lib/auth/constants';
import { manualAssignSchema } from '@/lib/agents/schemas';
import { manualAssignOrder } from '@/lib/agents/assignment';
import { OrderNotFoundError } from '@/lib/orders/service';
import {
  AgentNotFoundError,
  AgentCapacityExceededError,
} from '@/lib/agents/service';

/**
 * POST /api/orders/:id/assign
 * Manually assigns a delivery agent to an order.
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

    const authUser = authResult.user;
    const { id } = await Promise.resolve(params);

    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parseResult = manualAssignSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parseResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { agentId } = parseResult.data;

    const result = await manualAssignOrder(id, agentId, authUser.userId);

    return NextResponse.json(result, { status: 200 });
  } catch (error: any) {
    if (error instanceof OrderNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof AgentNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof AgentCapacityExceededError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error('POST /api/orders/:id/assign error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error assigning order' },
      { status: 500 }
    );
  }
}
