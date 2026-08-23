import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

import { requireRole } from '@/lib/auth/guard';
import { USER_ROLES } from '@/lib/auth/constants';
import { setAgentZonesSchema } from '@/lib/agents/schemas';
import {
  setAgentZones,
  AgentNotFoundError,
  InvalidZoneError,
} from '@/lib/agents/service';

/**
 * PUT /api/agents/:id/zones
 * Updates agent operational zone mappings.
 * Accessible strictly to ADMIN role.
 */
export async function PUT(
  req: NextRequest | Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const authResult = await requireRole(req, [USER_ROLES.ADMIN]);
    if (authResult.user === null) {
      return authResult.response;
    }

    const { id } = await Promise.resolve(params);

    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parseResult = setAgentZonesSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parseResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { zoneIds } = parseResult.data;
    const updatedAgent = await setAgentZones(id, zoneIds);

    return NextResponse.json(updatedAgent, { status: 200 });
  } catch (error: any) {
    if (error instanceof AgentNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof InvalidZoneError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error('PUT /api/agents/:id/zones error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error updating agent zones' },
      { status: 500 }
    );
  }
}
