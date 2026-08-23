// /home/skrisps/lastmile/src/app/api/agents/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/guard';
import { USER_ROLES } from '@/lib/auth/constants';
import { getAllAgents } from '@/lib/agents/service';
import { queryAgentsSchema } from '@/lib/agents/schemas';

/**
 * GET /api/agents
 * Lists all delivery agents with their operational status, assigned zones, and current load.
 * Accessible to ADMIN and AGENT roles.
 */
export async function GET(req: NextRequest | Request) {
  try {
    const authResult = await requireRole(req, [USER_ROLES.ADMIN, USER_ROLES.AGENT]);
    if (authResult.user === null) {
      return authResult.response;
    }

    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get('status') || undefined;
    const zoneIdParam = searchParams.get('zoneId') || undefined;
    const availableOnlyParam = searchParams.get('availableOnly') || undefined;

    const parseResult = queryAgentsSchema.safeParse({
      status: statusParam,
      zoneId: zoneIdParam,
      availableOnly: availableOnlyParam,
    });

    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Invalid query parameters',
          details: parseResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { status, zoneId, availableOnly } = parseResult.data;

    const agents = await getAllAgents({
      status,
      zoneId,
      availableOnly: availableOnly === 'true',
    });

    return NextResponse.json({ agents }, { status: 200 });
  } catch (error: any) {
    console.error('GET /api/agents error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error fetching agents' },
      { status: 500 }
    );
  }
}
