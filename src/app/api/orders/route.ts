// /home/skrisps/lastmile/src/app/api/orders/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/guard';
import { USER_ROLES } from '@/lib/auth/constants';
import { createOrderSchema, orderQuerySchema } from '@/lib/orders/schemas';
import { createOrder, queryOrders } from '@/lib/orders/service';
import { PincodeNotServiceableError } from '@/lib/rate-engine/detector';

/**
 * POST /api/orders
 * Creates a new order with dynamic rate calculation and initial CREATED ledger entry.
 * Accessible to authenticated CUSTOMER and ADMIN users.
 */
export async function POST(req: NextRequest | Request) {
  try {
    const authResult = await requireAuth(req);
    if (authResult.user === null) {
      return authResult.response;
    }

    const authUser = authResult.user;
    if (authUser.role !== USER_ROLES.CUSTOMER && authUser.role !== USER_ROLES.ADMIN) {
      return NextResponse.json(
        { error: 'Forbidden: Only customers and admins can create orders' },
        { status: 403 }
      );
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parseResult = createOrderSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parseResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    // Admins can specify a target customerId in payload if desired, otherwise defaults to authUser.userId
    const customerId =
      authUser.role === USER_ROLES.ADMIN && body.customerId
        ? body.customerId
        : authUser.userId;

    const createdOrder = await createOrder(parseResult.data, customerId);

    return NextResponse.json(createdOrder, { status: 201 });
  } catch (error: any) {
    if (error instanceof PincodeNotServiceableError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    console.error('POST /api/orders error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error creating order' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/orders
 * Queries orders with multi-parameter filtering and pagination.
 * Customers only see their own orders; Admins & Agents can view across system.
 */
export async function GET(req: NextRequest | Request) {
  try {
    const authResult = await requireAuth(req);
    if (authResult.user === null) {
      return authResult.response;
    }

    const authUser = authResult.user;
    const url = new URL(req.url);
    const searchParams = Object.fromEntries(url.searchParams.entries());

    const parseResult = orderQuerySchema.safeParse(searchParams);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Invalid query parameters',
          details: parseResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const result = await queryOrders(parseResult.data, authUser);

    return NextResponse.json(result, { status: 200 });
  } catch (error: any) {
    console.error('GET /api/orders error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error querying orders' },
      { status: 500 }
    );
  }
}
