// /home/skrisps/lastmile/src/app/api/orders/[id]/reschedule/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth/guard';
import { USER_ROLES } from '@/lib/auth/constants';
import { rescheduleOrderSchema } from '@/lib/orders/schemas';
import {
  rescheduleOrder,
  OrderNotFoundError,
} from '@/lib/orders/service';

/**
 * POST /api/orders/:id/reschedule
 * Customer or Admin reschedules a failed order for a new delivery date.
 */
export async function POST(
  req: NextRequest | Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const authResult = await requireRole(req, [USER_ROLES.CUSTOMER, USER_ROLES.ADMIN]);
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

    const parseResult = rescheduleOrderSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parseResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { scheduledDate, reason } = parseResult.data;

    // Customer can only reschedule their own order
    if (authUser.role === USER_ROLES.CUSTOMER) {
      const order = await prisma.order.findUnique({
        where: { id },
        select: { customerId: true },
      });

      if (!order) {
        return NextResponse.json({ error: `Order with ID '${id}' was not found.` }, { status: 404 });
      }

      if (order.customerId !== authUser.userId) {
        return NextResponse.json(
          { error: 'Forbidden: You can only reschedule your own orders.' },
          { status: 403 }
        );
      }
    }

    const updatedOrder = await rescheduleOrder(id, scheduledDate, authUser.userId, reason);

    return NextResponse.json(updatedOrder, { status: 200 });
  } catch (error: any) {
    if (error instanceof OrderNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    console.error('POST /api/orders/:id/reschedule error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error rescheduling order' },
      { status: 400 }
    );
  }
}
