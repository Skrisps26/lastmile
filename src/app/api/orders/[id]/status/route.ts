// /home/skrisps/lastmile/src/app/api/orders/[id]/status/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth/guard';
import { USER_ROLES } from '@/lib/auth/constants';
import { transitionStatusSchema } from '@/lib/orders/schemas';
import {
  transitionOrderStatus,
  OrderNotFoundError,
} from '@/lib/orders/service';
import {
  InvalidStatusTransitionError,
  MissingStatusReasonError,
} from '@/lib/orders/status-machine';

/**
 * POST /api/orders/:id/status
 * Executes an order status transition and appends an immutable event to the audit ledger.
 * Accessible to AGENT (for assigned orders) and ADMIN (system override).
 */
export async function POST(
  req: NextRequest | Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const authResult = await requireRole(req, [USER_ROLES.AGENT, USER_ROLES.ADMIN]);
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

    const parseResult = transitionStatusSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parseResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { status, reason, notes, metadata } = parseResult.data;

    // Check Agent authorization on the target order
    if (authUser.role === USER_ROLES.AGENT) {
      const order = await prisma.order.findUnique({
        where: { id },
        select: { id: true, assignedAgentId: true },
      });

      if (!order) {
        return NextResponse.json({ error: `Order with ID '${id}' was not found.` }, { status: 404 });
      }

      const agentProfile = await prisma.deliveryAgentProfile.findUnique({
        where: { userId: authUser.userId },
      });

      if (!agentProfile || !order.assignedAgentId || order.assignedAgentId !== agentProfile.id) {
        return NextResponse.json(
          { error: 'Forbidden: Delivery agents can only transition statuses for orders assigned to them.' },
          { status: 403 }
        );
      }
    }

    const updatedOrder = await transitionOrderStatus(
      id,
      status,
      authUser.userId,
      reason,
      notes,
      metadata
    );

    return NextResponse.json(updatedOrder, { status: 200 });
  } catch (error: any) {
    if (error instanceof OrderNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof InvalidStatusTransitionError || error instanceof MissingStatusReasonError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error('POST /api/orders/:id/status error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error updating order status' },
      { status: 500 }
    );
  }
}
