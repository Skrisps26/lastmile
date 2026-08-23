// /home/skrisps/lastmile/src/app/api/agents/[id]/status/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/guard';
import { USER_ROLES } from '@/lib/auth/constants';
import { updateAgentStatusSchema } from '@/lib/agents/schemas';
import {
  getAgentById,
  updateAgentStatus,
  AgentNotFoundError,
} from '@/lib/agents/service';
import { AgentStatus } from '@/lib/agents/types';

/**
 * PUT /api/agents/:id/status
 * Updates delivery agent availability status (AVAILABLE, OFFLINE, ON_DELIVERY).
 * Agents can update their own status; Admins can update any agent's status.
 */
export async function PUT(
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

    // Verify agent exists
    let targetAgent;
    try {
      targetAgent = await getAgentById(id);
    } catch (err: any) {
      if (err instanceof AgentNotFoundError) {
        return NextResponse.json({ error: err.message }, { status: 404 });
      }
      throw err;
    }

    // Role-based ownership check: AGENT can only change their own profile
    if (authUser.role === USER_ROLES.AGENT) {
      if (targetAgent.userId !== authUser.userId) {
        return NextResponse.json(
          { error: 'Forbidden: Delivery agents can only update their own status.' },
          { status: 403 }
        );
      }
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parseResult = updateAgentStatusSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parseResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { status } = parseResult.data;
    const updatedAgent = await updateAgentStatus(targetAgent.id, status as AgentStatus);

    return NextResponse.json(updatedAgent, { status: 200 });
  } catch (error: any) {
    if (error instanceof AgentNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    console.error('PUT /api/agents/:id/status error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error updating agent status' },
      { status: 500 }
    );
  }
}
