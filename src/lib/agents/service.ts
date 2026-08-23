// /home/skrisps/lastmile/src/lib/agents/service.ts

import { prisma } from '@/lib/prisma';
import { AgentStatus, AgentProfileSummary, AGENT_STATUSES } from './types';

export class AgentNotFoundError extends Error {
  public readonly agentId: string;
  public readonly statusCode: number = 404;

  constructor(agentId: string) {
    super(`Delivery agent with ID '${agentId}' was not found.`);
    this.name = 'AgentNotFoundError';
    this.agentId = agentId;
    Object.setPrototypeOf(this, AgentNotFoundError.prototype);
  }
}

export class AgentCapacityExceededError extends Error {
  public readonly agentId: string;
  public readonly activeOrdersCount: number;
  public readonly maxCapacity: number;
  public readonly statusCode: number = 400;

  constructor(agentId: string, activeOrdersCount: number, maxCapacity: number) {
    super(
      `Delivery agent '${agentId}' has reached maximum delivery capacity (${activeOrdersCount}/${maxCapacity}).`
    );
    this.name = 'AgentCapacityExceededError';
    this.agentId = agentId;
    this.activeOrdersCount = activeOrdersCount;
    this.maxCapacity = maxCapacity;
    Object.setPrototypeOf(this, AgentCapacityExceededError.prototype);
  }
}

export class AgentNotAvailableError extends Error {
  public readonly agentId: string;
  public readonly currentStatus: string;
  public readonly statusCode: number = 400;

  constructor(agentId: string, currentStatus: string) {
    super(`Delivery agent '${agentId}' is not available (current status: '${currentStatus}').`);
    this.name = 'AgentNotAvailableError';
    this.agentId = agentId;
    this.currentStatus = currentStatus;
    Object.setPrototypeOf(this, AgentNotAvailableError.prototype);
  }
}

export class InvalidZoneError extends Error {
  public readonly zoneId: string;
  public readonly statusCode: number = 400;

  constructor(zoneId: string, message?: string) {
    super(message || `Zone with ID '${zoneId}' is invalid or inactive.`);
    this.name = 'InvalidZoneError';
    this.zoneId = zoneId;
    Object.setPrototypeOf(this, InvalidZoneError.prototype);
  }
}

/**
 * Format agent profile entity into AgentProfileSummary with computed availableCapacity.
 */
function formatAgentSummary(agent: any): AgentProfileSummary {
  return {
    id: agent.id,
    userId: agent.userId,
    status: agent.status as AgentStatus,
    vehicleType: agent.vehicleType,
    vehicleNumber: agent.vehicleNumber,
    maxCapacity: agent.maxCapacity,
    activeOrdersCount: agent.activeOrdersCount,
    availableCapacity: Math.max(0, agent.maxCapacity - agent.activeOrdersCount),
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    user: agent.user,
    operationalZones: agent.operationalZones || [],
  };
}

/**
 * Lists all delivery agent profiles with optional filtering by status and zone.
 */
export async function getAllAgents(filters?: {
  status?: AgentStatus | string;
  zoneId?: string;
  availableOnly?: boolean;
}): Promise<AgentProfileSummary[]> {
  const where: any = {};

  if (filters?.status && AGENT_STATUSES.includes(filters.status as AgentStatus)) {
    where.status = filters.status;
  }

  if (filters?.availableOnly) {
    where.status = 'AVAILABLE';
  }

  if (filters?.zoneId) {
    where.operationalZones = {
      some: {
        zoneId: filters.zoneId,
      },
    };
  }

  const agents = await prisma.deliveryAgentProfile.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
        },
      },
      operationalZones: {
        include: {
          zone: true,
        },
      },
    },
    orderBy: [{ activeOrdersCount: 'asc' }, { updatedAt: 'asc' }],
  });

  const formatted = agents.map(formatAgentSummary);

  if (filters?.availableOnly) {
    return formatted.filter((a) => a.activeOrdersCount < a.maxCapacity);
  }

  return formatted;
}

/**
 * Retrieves an agent profile by Agent ID (or User ID fallback).
 */
export async function getAgentById(agentId: string): Promise<AgentProfileSummary> {
  const agent = await prisma.deliveryAgentProfile.findFirst({
    where: {
      OR: [{ id: agentId }, { userId: agentId }],
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
        },
      },
      operationalZones: {
        include: {
          zone: true,
        },
      },
    },
  });

  if (!agent) {
    throw new AgentNotFoundError(agentId);
  }

  return formatAgentSummary(agent);
}

/**
 * Retrieves an agent profile by User ID.
 */
export async function getAgentByUserId(userId: string): Promise<AgentProfileSummary | null> {
  const agent = await prisma.deliveryAgentProfile.findUnique({
    where: { userId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
        },
      },
      operationalZones: {
        include: {
          zone: true,
        },
      },
    },
  });

  if (!agent) return null;
  return formatAgentSummary(agent);
}

/**
 * Updates agent availability status (AVAILABLE, OFFLINE, ON_DELIVERY).
 */
export async function updateAgentStatus(
  agentId: string,
  status: AgentStatus
): Promise<AgentProfileSummary> {
  if (!AGENT_STATUSES.includes(status)) {
    throw new Error(`Invalid agent status '${status}'. Must be one of: ${AGENT_STATUSES.join(', ')}`);
  }

  // Find agent
  const existing = await prisma.deliveryAgentProfile.findFirst({
    where: {
      OR: [{ id: agentId }, { userId: agentId }],
    },
  });

  if (!existing) {
    throw new AgentNotFoundError(agentId);
  }

  const updated = await prisma.deliveryAgentProfile.update({
    where: { id: existing.id },
    data: { status },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
        },
      },
      operationalZones: {
        include: {
          zone: true,
        },
      },
    },
  });

  return formatAgentSummary(updated);
}

/**
 * Updates agent operational zone mappings.
 */
export async function setAgentZones(
  agentId: string,
  zoneIds: string[]
): Promise<AgentProfileSummary> {
  // Find agent
  const agent = await prisma.deliveryAgentProfile.findFirst({
    where: {
      OR: [{ id: agentId }, { userId: agentId }],
    },
  });

  if (!agent) {
    throw new AgentNotFoundError(agentId);
  }

  // Validate all zones exist
  if (zoneIds.length > 0) {
    const existingZones = await prisma.zone.findMany({
      where: {
        id: { in: zoneIds },
        isActive: true,
      },
    });

    const foundZoneIds = new Set(existingZones.map((z) => z.id));
    for (const zId of zoneIds) {
      if (!foundZoneIds.has(zId)) {
        throw new InvalidZoneError(zId, `Zone '${zId}' is either invalid or inactive.`);
      }
    }
  }

  // Execute atomic zone update
  await prisma.$transaction(async (tx) => {
    await tx.agentZoneMapping.deleteMany({
      where: { agentId: agent.id },
    });

    if (zoneIds.length > 0) {
      for (const zoneId of zoneIds) {
        await tx.agentZoneMapping.create({
          data: {
            agentId: agent.id,
            zoneId,
          },
        });
      }
    }
  });

  const updated = await prisma.deliveryAgentProfile.findUnique({
    where: { id: agent.id },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
        },
      },
      operationalZones: {
        include: {
          zone: true,
        },
      },
    },
  });

  return formatAgentSummary(updated);
}

/**
 * Updates agent vehicle details and max capacity limit.
 */
export async function updateAgentProfile(
  agentId: string,
  data: {
    vehicleType?: string;
    vehicleNumber?: string;
    maxCapacity?: number;
  }
): Promise<AgentProfileSummary> {
  const agent = await prisma.deliveryAgentProfile.findFirst({
    where: {
      OR: [{ id: agentId }, { userId: agentId }],
    },
  });

  if (!agent) {
    throw new AgentNotFoundError(agentId);
  }

  const updated = await prisma.deliveryAgentProfile.update({
    where: { id: agent.id },
    data: {
      ...(data.vehicleType !== undefined ? { vehicleType: data.vehicleType } : {}),
      ...(data.vehicleNumber !== undefined ? { vehicleNumber: data.vehicleNumber } : {}),
      ...(data.maxCapacity !== undefined ? { maxCapacity: data.maxCapacity } : {}),
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
        },
      },
      operationalZones: {
        include: {
          zone: true,
        },
      },
    },
  });

  return formatAgentSummary(updated);
}

/**
 * Helper to get real-time agent capacity stats.
 */
export async function getAgentCapacity(agentId: string) {
  const agent = await getAgentById(agentId);
  return {
    maxCapacity: agent.maxCapacity,
    activeOrdersCount: agent.activeOrdersCount,
    availableCapacity: agent.availableCapacity,
    isAvailable: agent.status === 'AVAILABLE' && agent.activeOrdersCount < agent.maxCapacity,
  };
}
