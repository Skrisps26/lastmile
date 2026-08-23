// /home/skrisps/lastmile/src/lib/agents/assignment.ts

import { prisma } from '@/lib/prisma';
import { deriveCurrentStatus } from '@/lib/orders/status-machine';
import { OrderNotFoundError } from '@/lib/orders/service';
import {
  AgentNotFoundError,
  AgentCapacityExceededError,
} from './service';
import {
  AutoAssignResult,
  BatchAutoAssignResult,
  ManualAssignResult,
  ReleaseAgentResult,
  AgentStatus,
} from './types';

/**
 * Automatically assigns an unassigned order to an available delivery agent
 * operating in the drop zone (or pickup zone) with load-balanced ranking.
 */
export async function autoAssignOrder(orderId: string): Promise<AutoAssignResult> {
  // 1. Fetch Order with Zones and Status History
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      pickupZone: true,
      dropZone: true,
      statusHistory: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!order) {
    throw new OrderNotFoundError(orderId);
  }

  // 2. Validate Current Order Status
  const currentStatus = deriveCurrentStatus(order.statusHistory);

  if (order.assignedAgentId && currentStatus !== 'RESCHEDULED') {
    return {
      success: false,
      reason: `Order is already assigned to an agent (status: '${currentStatus}').`,
    };
  }

  if (currentStatus !== 'CREATED' && currentStatus !== 'RESCHEDULED') {
    return {
      success: false,
      reason: `Order cannot be assigned in status '${currentStatus}'. Must be in 'CREATED' or 'RESCHEDULED'.`,
    };
  }

  // 3. Find Candidate Agents
  // Target: dropZoneId (last-mile delivery zone) or fallback to pickupZoneId
  const targetZoneId = order.dropZoneId || order.pickupZoneId;

  // Fetch all agents who:
  // - have status === 'AVAILABLE'
  // - have an active AgentZoneMapping for targetZoneId
  // - have activeOrdersCount < maxCapacity
  const candidateAgents = await prisma.deliveryAgentProfile.findMany({
    where: {
      status: 'AVAILABLE',
      operationalZones: {
        some: {
          zoneId: targetZoneId,
        },
      },
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
      operationalZones: true,
    },
    orderBy: [
      { activeOrdersCount: 'asc' }, // Load balancing: lowest load first
      { updatedAt: 'asc' },         // Tie-breaker: longest idle first
    ],
  });

  // Filter in memory for capacity enforcement
  const eligibleAgents = candidateAgents.filter(
    (agent) => agent.activeOrdersCount < agent.maxCapacity
  );

  if (eligibleAgents.length === 0) {
    return {
      success: false,
      reason: 'No available agents in zone',
    };
  }

  const selectedAgent = eligibleAgents[0];
  const matchedZoneId = targetZoneId;

  const newActiveCount = selectedAgent.activeOrdersCount + 1;
  const isNowFull = newActiveCount >= selectedAgent.maxCapacity;
  const newAgentStatus: AgentStatus = isNowFull ? 'ON_DELIVERY' : 'AVAILABLE';

  // 4. Atomic Transaction: Assign Order, Increment Agent Load, Append Event
  const result = await prisma.$transaction(async (tx) => {
    const updatedOrder = await tx.order.update({
      where: { id: order.id },
      data: {
        assignedAgentId: selectedAgent.id,
      },
    });

    await tx.deliveryAgentProfile.update({
      where: { id: selectedAgent.id },
      data: {
        activeOrdersCount: newActiveCount,
        status: newAgentStatus,
      },
    });

    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        status: 'ASSIGNED',
        changedById: selectedAgent.userId,
        reason: null,
        notes: `Order automatically assigned to agent ${selectedAgent.user.name}`,
        metadata: JSON.stringify({
          action: 'AUTO_ASSIGNED',
          agentId: selectedAgent.id,
          agentName: selectedAgent.user.name,
          agentEmail: selectedAgent.user.email,
          matchedZoneId,
          activeOrdersCount: newActiveCount,
          maxCapacity: selectedAgent.maxCapacity,
        }),
      },
    });

    return updatedOrder;
  });

  return {
    success: true,
    assignedAgent: {
      id: selectedAgent.id,
      userId: selectedAgent.userId,
      name: selectedAgent.user.name,
      email: selectedAgent.user.email,
      phone: selectedAgent.user.phone,
      status: newAgentStatus,
      activeOrdersCount: newActiveCount,
      maxCapacity: selectedAgent.maxCapacity,
      matchedZoneId,
    },
    order: {
      id: result.id,
      trackingNumber: result.trackingNumber,
      assignedAgentId: selectedAgent.id,
      currentStatus: 'ASSIGNED',
    },
  };
}

/**
 * Manually assigns an order to a specified delivery agent by an Admin.
 * Validates agent existence, checks capacity, updates state atomically,
 * and records an 'ASSIGNED' event on the ledger.
 */
export async function manualAssignOrder(
  orderId: string,
  agentId: string,
  changedById?: string | null
): Promise<ManualAssignResult> {
  // 1. Fetch Order and Status History
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      statusHistory: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!order) {
    throw new OrderNotFoundError(orderId);
  }

  // 2. Fetch Delivery Agent Profile
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
    },
  });

  if (!agent) {
    throw new AgentNotFoundError(agentId);
  }

  // 3. Enforce Capacity Limit
  if (agent.activeOrdersCount >= agent.maxCapacity) {
    throw new AgentCapacityExceededError(agent.id, agent.activeOrdersCount, agent.maxCapacity);
  }

  const previousAgentId = order.assignedAgentId;
  const isSameAgent = previousAgentId === agent.id;

  const newActiveCount = isSameAgent ? agent.activeOrdersCount : agent.activeOrdersCount + 1;
  const isNowFull = newActiveCount >= agent.maxCapacity;
  const newStatus: AgentStatus = isNowFull ? 'ON_DELIVERY' : agent.status as AgentStatus;

  // 4. Atomic Transaction: Reassign Order, Adjust Agent Counts, Append Ledger Event
  const updatedOrder = await prisma.$transaction(async (tx) => {
    // If order was assigned to another agent previously, release previous agent's active load
    if (previousAgentId && !isSameAgent) {
      const prevAgent = await tx.deliveryAgentProfile.findUnique({
        where: { id: previousAgentId },
      });

      if (prevAgent) {
        const prevCount = Math.max(0, prevAgent.activeOrdersCount - 1);
        const prevStatus = prevAgent.status === 'ON_DELIVERY' && prevCount < prevAgent.maxCapacity
          ? 'AVAILABLE'
          : prevAgent.status;

        await tx.deliveryAgentProfile.update({
          where: { id: previousAgentId },
          data: {
            activeOrdersCount: prevCount,
            status: prevStatus,
          },
        });
      }
    }

    // Update target agent load & status
    if (!isSameAgent) {
      await tx.deliveryAgentProfile.update({
        where: { id: agent.id },
        data: {
          activeOrdersCount: newActiveCount,
          status: newStatus,
        },
      });
    }

    // Update order assignedAgentId
    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        assignedAgentId: agent.id,
      },
      include: {
        pickupZone: true,
        dropZone: true,
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
        assignedAgent: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
              },
            },
          },
        },
      },
    });

    // Append ASSIGNED status event to ledger
    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        status: 'ASSIGNED',
        changedById: changedById || null,
        reason: null,
        notes: `Order manually assigned to agent ${agent.user.name}`,
        metadata: JSON.stringify({
          action: 'MANUAL_ASSIGNED',
          agentId: agent.id,
          agentName: agent.user.name,
          agentEmail: agent.user.email,
          changedById: changedById || null,
          previousAgentId: previousAgentId || null,
          activeOrdersCount: newActiveCount,
          maxCapacity: agent.maxCapacity,
        }),
      },
    });

    return updated;
  });

  return {
    success: true,
    order: {
      ...updatedOrder,
      currentStatus: 'ASSIGNED',
    },
    assignedAgent: {
      id: agent.id,
      userId: agent.userId,
      name: agent.user.name,
      email: agent.user.email,
      phone: agent.user.phone,
      activeOrdersCount: newActiveCount,
      maxCapacity: agent.maxCapacity,
    },
  };
}

/**
 * Releases an assigned order from an agent (decrements activeOrdersCount).
 * Called when an order reaches a terminal state (DELIVERED, FAILED, CANCELLED)
 * or when manually unassigned.
 */
export async function releaseAgentOrder(
  orderId: string,
  agentId?: string | null
): Promise<ReleaseAgentResult | null> {
  let targetAgentId = agentId;

  if (!targetAgentId) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { assignedAgentId: true },
    });

    if (!order || !order.assignedAgentId) {
      return null;
    }
    targetAgentId = order.assignedAgentId;
  }

  const agent = await prisma.deliveryAgentProfile.findUnique({
    where: { id: targetAgentId },
  });

  if (!agent) {
    return null;
  }

  const newCount = Math.max(0, agent.activeOrdersCount - 1);
  const newStatus: AgentStatus =
    agent.status === 'ON_DELIVERY' && newCount < agent.maxCapacity
      ? 'AVAILABLE'
      : (agent.status as AgentStatus);

  const updated = await prisma.deliveryAgentProfile.update({
    where: { id: agent.id },
    data: {
      activeOrdersCount: newCount,
      status: newStatus,
    },
  });

  return {
    success: true,
    agentId: updated.id,
    activeOrdersCount: updated.activeOrdersCount,
    status: updated.status as AgentStatus,
  };
}

/**
 * Runs batch auto-assignment for all currently unassigned orders
 * in 'CREATED' or 'RESCHEDULED' state.
 */
export async function batchAutoAssignOrders(): Promise<BatchAutoAssignResult> {
  // Query candidate orders without an assigned agent
  const unassignedOrders = await prisma.order.findMany({
    where: {
      assignedAgentId: null,
    },
    include: {
      statusHistory: {
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  // Filter orders whose current status is CREATED or RESCHEDULED
  const eligibleOrders = unassignedOrders.filter((order) => {
    try {
      const status = deriveCurrentStatus(order.statusHistory);
      return status === 'CREATED' || status === 'RESCHEDULED';
    } catch {
      return false;
    }
  });

  const results: BatchAutoAssignResult['results'] = [];
  let assignedCount = 0;
  let unassignedCount = 0;

  for (const order of eligibleOrders) {
    try {
      const assignResult = await autoAssignOrder(order.id);
      if (assignResult.success && assignResult.assignedAgent) {
        assignedCount++;
        results.push({
          orderId: order.id,
          trackingNumber: order.trackingNumber,
          success: true,
          agentId: assignResult.assignedAgent.id,
          agentName: assignResult.assignedAgent.name,
        });
      } else {
        unassignedCount++;
        results.push({
          orderId: order.id,
          trackingNumber: order.trackingNumber,
          success: false,
          reason: assignResult.reason || 'No candidate agents found',
        });
      }
    } catch (err: any) {
      unassignedCount++;
      results.push({
        orderId: order.id,
        trackingNumber: order.trackingNumber,
        success: false,
        reason: err.message || 'Auto-assignment failed with unexpected error',
      });
    }
  }

  return {
    totalChecked: eligibleOrders.length,
    assignedCount,
    unassignedCount,
    results,
  };
}
