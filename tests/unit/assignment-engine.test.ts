// /home/skrisps/lastmile/tests/unit/assignment-engine.test.ts

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth/password';
import {
  autoAssignOrder,
  manualAssignOrder,
  releaseAgentOrder,
  batchAutoAssignOrders,
} from '@/lib/agents/assignment';
import {
  getAllAgents,
  getAgentById,
  updateAgentStatus,
  setAgentZones,
  getAgentCapacity,
  AgentNotFoundError,
  AgentCapacityExceededError,
  InvalidZoneError,
} from '@/lib/agents/service';
import { createOrder } from '@/lib/orders/service';

describe('Unit: Delivery Agent Management & Auto-Assignment Engine Suite (M4-R3)', () => {
  let customerUserId: string;
  let adminUserId: string;

  let zoneNorthId: string;
  let zoneSouthId: string;
  let zoneEastId: string;

  let agentNorthUser: any;
  let agentNorthProfile: any;

  let agentSouthUser: any;
  let agentSouthProfile: any;

  let agentMultiUser: any;
  let agentMultiProfile: any;

  beforeAll(async () => {
    const passwordHash = await hashPassword('TestPass123!');

    // Lookup Seeded Zones
    const zNorth = await prisma.zone.findUnique({ where: { code: 'ZONE_NORTH' } });
    const zSouth = await prisma.zone.findUnique({ where: { code: 'ZONE_SOUTH' } });
    const zEast = await prisma.zone.findUnique({ where: { code: 'ZONE_EAST' } });

    zoneNorthId = zNorth!.id;
    zoneSouthId = zSouth!.id;
    zoneEastId = zEast!.id;

    // Customer & Admin users
    const cust = await prisma.user.upsert({
      where: { email: 'customer.unit.m4@lastmile.local' },
      update: {},
      create: {
        email: 'customer.unit.m4@lastmile.local',
        name: 'Customer Unit M4',
        passwordHash,
        role: 'CUSTOMER',
      },
    });
    customerUserId = cust.id;

    const adm = await prisma.user.upsert({
      where: { email: 'admin.unit.m4@lastmile.local' },
      update: {},
      create: {
        email: 'admin.unit.m4@lastmile.local',
        name: 'Admin Unit M4',
        passwordHash,
        role: 'ADMIN',
      },
    });
    adminUserId = adm.id;

    // Agent North (Only Zone North, maxCapacity: 2)
    agentNorthUser = await prisma.user.upsert({
      where: { email: 'agent.north.unit@lastmile.local' },
      update: {},
      create: {
        email: 'agent.north.unit@lastmile.local',
        name: 'Agent North Unit',
        passwordHash,
        role: 'AGENT',
      },
    });

    agentNorthProfile = await prisma.deliveryAgentProfile.upsert({
      where: { userId: agentNorthUser.id },
      update: {
        status: 'AVAILABLE',
        maxCapacity: 2,
        activeOrdersCount: 0,
      },
      create: {
        userId: agentNorthUser.id,
        status: 'AVAILABLE',
        vehicleType: 'BIKE',
        vehicleNumber: 'KA-01-M4-001',
        maxCapacity: 2,
        activeOrdersCount: 0,
      },
    });

    await prisma.agentZoneMapping.deleteMany({ where: { agentId: agentNorthProfile.id } });
    await prisma.agentZoneMapping.create({
      data: { agentId: agentNorthProfile.id, zoneId: zoneNorthId },
    });

    // Agent South (Only Zone South, maxCapacity: 5)
    agentSouthUser = await prisma.user.upsert({
      where: { email: 'agent.south.unit@lastmile.local' },
      update: {},
      create: {
        email: 'agent.south.unit@lastmile.local',
        name: 'Agent South Unit',
        passwordHash,
        role: 'AGENT',
      },
    });

    agentSouthProfile = await prisma.deliveryAgentProfile.upsert({
      where: { userId: agentSouthUser.id },
      update: {
        status: 'AVAILABLE',
        maxCapacity: 5,
        activeOrdersCount: 0,
      },
      create: {
        userId: agentSouthUser.id,
        status: 'AVAILABLE',
        vehicleType: 'VAN',
        vehicleNumber: 'KA-01-M4-002',
        maxCapacity: 5,
        activeOrdersCount: 0,
      },
    });

    await prisma.agentZoneMapping.deleteMany({ where: { agentId: agentSouthProfile.id } });
    await prisma.agentZoneMapping.create({
      data: { agentId: agentSouthProfile.id, zoneId: zoneSouthId },
    });

    // Agent Multi (Zone North and South, maxCapacity: 3)
    agentMultiUser = await prisma.user.upsert({
      where: { email: 'agent.multi.unit@lastmile.local' },
      update: {},
      create: {
        email: 'agent.multi.unit@lastmile.local',
        name: 'Agent Multi Unit',
        passwordHash,
        role: 'AGENT',
      },
    });

    agentMultiProfile = await prisma.deliveryAgentProfile.upsert({
      where: { userId: agentMultiUser.id },
      update: {
        status: 'AVAILABLE',
        maxCapacity: 3,
        activeOrdersCount: 0,
      },
      create: {
        userId: agentMultiUser.id,
        status: 'AVAILABLE',
        vehicleType: 'BIKE',
        vehicleNumber: 'KA-01-M4-003',
        maxCapacity: 3,
        activeOrdersCount: 0,
      },
    });

    await prisma.agentZoneMapping.deleteMany({ where: { agentId: agentMultiProfile.id } });
    await prisma.agentZoneMapping.createMany({
      data: [
        { agentId: agentMultiProfile.id, zoneId: zoneNorthId },
        { agentId: agentMultiProfile.id, zoneId: zoneSouthId },
      ],
    });
  });

  beforeEach(async () => {
    // Ensure demo agents are OFFLINE so isolated unit tests only match unit test agents
    await prisma.deliveryAgentProfile.updateMany({
      where: {
        id: { notIn: [agentNorthProfile.id, agentSouthProfile.id, agentMultiProfile.id] },
      },
      data: { status: 'OFFLINE' },
    });

    // Reset agent active loads and availability before each test
    await prisma.deliveryAgentProfile.update({
      where: { id: agentNorthProfile.id },
      data: { status: 'AVAILABLE', activeOrdersCount: 0, maxCapacity: 2 },
    });
    await prisma.deliveryAgentProfile.update({
      where: { id: agentSouthProfile.id },
      data: { status: 'AVAILABLE', activeOrdersCount: 0, maxCapacity: 5 },
    });
    await prisma.deliveryAgentProfile.update({
      where: { id: agentMultiProfile.id },
      data: { status: 'AVAILABLE', activeOrdersCount: 0, maxCapacity: 3 },
    });
  });

  afterAll(async () => {
    // Restore seeded demo agents to AVAILABLE
    await prisma.deliveryAgentProfile.updateMany({
      where: {
        user: { email: { in: ['agent1@lastmile.local', 'agent2@lastmile.local'] } },
      },
      data: { status: 'AVAILABLE', activeOrdersCount: 0 },
    });
    await prisma.$disconnect();
  });

  // Helper to create order for testing
  async function createTestOrder(pickupPin = '560001', dropPin = '560076') {
    return createOrder(
      {
        pickupPincode: pickupPin,
        dropPincode: dropPin,
        senderName: 'Sender Test',
        senderPhone: '+91-9876543210',
        senderStreet: '123 Main St',
        senderCity: 'Bangalore',
        senderState: 'Karnataka',
        recipientName: 'Receiver Test',
        recipientPhone: '+91-9876543211',
        recipientStreet: '456 Cross Rd',
        recipientCity: 'Bangalore',
        recipientState: 'Karnataka',
        packageLengthCm: 20,
        packageBreadthCm: 15,
        packageHeightCm: 10,
        actualWeightKg: 1.5,
        customerType: 'B2C',
      },
      customerUserId
    );
  }

  describe('1. Geographic Zone Matching & Routing Verification', () => {
    it('should assign order destined for Zone South to an agent mapped to Zone South', async () => {
      // Order drop is 560076 (Zone South)
      const order = await createTestOrder('560001', '560076');

      // Make multi agent unavailable to isolate agentSouth
      await prisma.deliveryAgentProfile.update({
        where: { id: agentMultiProfile.id },
        data: { status: 'OFFLINE' },
      });

      const result = await autoAssignOrder(order.id);

      expect(result.success).toBe(true);
      expect(result.assignedAgent).toBeDefined();
      expect(result.assignedAgent?.id).toBe(agentSouthProfile.id);
      expect(result.assignedAgent?.matchedZoneId).toBe(zoneSouthId);
      expect(result.order?.assignedAgentId).toBe(agentSouthProfile.id);
    });

    it('should return failure when no active agents operate in the destination zone', async () => {
      // Order drop is 560038 (Zone East) - no agents currently mapped to Zone East
      const order = await createTestOrder('560001', '560038');

      // Ensure no pickup-zone fallback by setting pickup to Zone East too
      await prisma.order.update({
        where: { id: order.id },
        data: { pickupZoneId: zoneEastId },
      });

      const result = await autoAssignOrder(order.id);

      expect(result.success).toBe(false);
      expect(result.reason).toBe('No available agents in zone');
    });

    it('should match agent mapped to multiple operational zones across both zones', async () => {
      // Deactivate specialized agents
      await prisma.deliveryAgentProfile.update({
        where: { id: agentNorthProfile.id },
        data: { status: 'OFFLINE' },
      });
      await prisma.deliveryAgentProfile.update({
        where: { id: agentSouthProfile.id },
        data: { status: 'OFFLINE' },
      });

      // Test drop in North
      const orderNorth = await createTestOrder('560076', '560001');
      const resNorth = await autoAssignOrder(orderNorth.id);
      expect(resNorth.success).toBe(true);
      expect(resNorth.assignedAgent?.id).toBe(agentMultiProfile.id);

      // Test drop in South
      const orderSouth = await createTestOrder('560001', '560076');
      const resSouth = await autoAssignOrder(orderSouth.id);
      expect(resSouth.success).toBe(true);
      expect(resSouth.assignedAgent?.id).toBe(agentMultiProfile.id);
    });
  });

  describe('2. Agent Availability Filtering (AVAILABLE vs OFFLINE vs ON_DELIVERY)', () => {
    it('should strictly exclude OFFLINE agents from the auto-assignment pool', async () => {
      const order = await createTestOrder('560076', '560001'); // Drop North

      // Set North agents to OFFLINE
      await prisma.deliveryAgentProfile.update({
        where: { id: agentNorthProfile.id },
        data: { status: 'OFFLINE' },
      });
      await prisma.deliveryAgentProfile.update({
        where: { id: agentMultiProfile.id },
        data: { status: 'OFFLINE' },
      });

      const result = await autoAssignOrder(order.id);
      expect(result.success).toBe(false);
      expect(result.reason).toBe('No available agents in zone');
    });

    it('should strictly exclude ON_DELIVERY agents from the auto-assignment pool', async () => {
      const order = await createTestOrder('560076', '560001'); // Drop North

      // Set North agents to ON_DELIVERY
      await prisma.deliveryAgentProfile.update({
        where: { id: agentNorthProfile.id },
        data: { status: 'ON_DELIVERY' },
      });
      await prisma.deliveryAgentProfile.update({
        where: { id: agentMultiProfile.id },
        data: { status: 'ON_DELIVERY' },
      });

      const result = await autoAssignOrder(order.id);
      expect(result.success).toBe(false);
      expect(result.reason).toBe('No available agents in zone');
    });

    it('should assign immediately when an agent toggles status back to AVAILABLE', async () => {
      const order = await createTestOrder('560076', '560001');

      // Set OFFLINE first
      await updateAgentStatus(agentNorthProfile.id, 'OFFLINE');
      await updateAgentStatus(agentMultiProfile.id, 'OFFLINE');

      let res = await autoAssignOrder(order.id);
      expect(res.success).toBe(false);

      // Bring Agent North back to AVAILABLE
      await updateAgentStatus(agentNorthProfile.id, 'AVAILABLE');

      res = await autoAssignOrder(order.id);
      expect(res.success).toBe(true);
      expect(res.assignedAgent?.id).toBe(agentNorthProfile.id);
    });
  });

  describe('3. Capacity Limit Enforcement & Status Transition', () => {
    it('should reject agents that have reached maxCapacity', async () => {
      const order = await createTestOrder('560076', '560001'); // Drop North

      // Fill Agent North to capacity (maxCapacity = 2, activeOrdersCount = 2)
      await prisma.deliveryAgentProfile.update({
        where: { id: agentNorthProfile.id },
        data: { activeOrdersCount: 2, maxCapacity: 2 },
      });
      await prisma.deliveryAgentProfile.update({
        where: { id: agentMultiProfile.id },
        data: { status: 'OFFLINE' },
      });

      const result = await autoAssignOrder(order.id);
      expect(result.success).toBe(false);
      expect(result.reason).toBe('No available agents in zone');
    });

    it('should automatically transition agent status to ON_DELIVERY when maxCapacity is reached', async () => {
      // Set Agent North maxCapacity = 1
      await prisma.deliveryAgentProfile.update({
        where: { id: agentNorthProfile.id },
        data: { activeOrdersCount: 0, maxCapacity: 1, status: 'AVAILABLE' },
      });
      await prisma.deliveryAgentProfile.update({
        where: { id: agentMultiProfile.id },
        data: { status: 'OFFLINE' },
      });

      const order = await createTestOrder('560076', '560001');
      const result = await autoAssignOrder(order.id);

      expect(result.success).toBe(true);
      expect(result.assignedAgent?.activeOrdersCount).toBe(1);
      expect(result.assignedAgent?.status).toBe('ON_DELIVERY');

      const refreshedAgent = await getAgentById(agentNorthProfile.id);
      expect(refreshedAgent.status).toBe('ON_DELIVERY');
      expect(refreshedAgent.activeOrdersCount).toBe(1);
    });
  });

  describe('4. Load Balancing & Tie-Breaking Algorithm', () => {
    it('should prioritize the agent with the lowest activeOrdersCount (least loaded first)', async () => {
      // Both North and Multi are in Zone North
      // Set Agent North: active = 1
      // Set Agent Multi: active = 0
      await prisma.deliveryAgentProfile.update({
        where: { id: agentNorthProfile.id },
        data: { activeOrdersCount: 1, maxCapacity: 5, status: 'AVAILABLE' },
      });
      await prisma.deliveryAgentProfile.update({
        where: { id: agentMultiProfile.id },
        data: { activeOrdersCount: 0, maxCapacity: 5, status: 'AVAILABLE' },
      });

      const order = await createTestOrder('560076', '560001');
      const result = await autoAssignOrder(order.id);

      expect(result.success).toBe(true);
      expect(result.assignedAgent?.id).toBe(agentMultiProfile.id);
    });

    it('should use longest idle time (updatedAt ASC) as tie-breaker when load is identical', async () => {
      const olderTime = new Date('2026-08-23T08:00:00Z');
      const newerTime = new Date('2026-08-23T10:00:00Z');

      await prisma.deliveryAgentProfile.update({
        where: { id: agentNorthProfile.id },
        data: { activeOrdersCount: 0, maxCapacity: 5, status: 'AVAILABLE', updatedAt: olderTime },
      });
      await prisma.deliveryAgentProfile.update({
        where: { id: agentMultiProfile.id },
        data: { activeOrdersCount: 0, maxCapacity: 5, status: 'AVAILABLE', updatedAt: newerTime },
      });

      const order = await createTestOrder('560076', '560001');
      const result = await autoAssignOrder(order.id);

      expect(result.success).toBe(true);
      expect(result.assignedAgent?.id).toBe(agentNorthProfile.id);
    });
  });

  describe('5. Manual Assignment & Reassignment Mechanics', () => {
    it('should allow admin to manually assign an available agent to an unassigned order', async () => {
      const order = await createTestOrder('560001', '560076');

      const result = await manualAssignOrder(order.id, agentSouthProfile.id, adminUserId);

      expect(result.success).toBe(true);
      expect(result.assignedAgent.id).toBe(agentSouthProfile.id);
      expect(result.assignedAgent.activeOrdersCount).toBe(1);

      // Verify audit ledger record
      const history = await prisma.orderStatusHistory.findMany({
        where: { orderId: order.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(history[0].status).toBe('ASSIGNED');
      expect(history[0].changedById).toBe(adminUserId);
      expect(history[0].notes).toMatch(/manually assigned to agent/i);
    });

    it('should throw AgentCapacityExceededError when manually assigning an agent at full capacity', async () => {
      await prisma.deliveryAgentProfile.update({
        where: { id: agentNorthProfile.id },
        data: { activeOrdersCount: 2, maxCapacity: 2 },
      });

      const order = await createTestOrder('560076', '560001');

      await expect(manualAssignOrder(order.id, agentNorthProfile.id, adminUserId)).rejects.toThrow(
        AgentCapacityExceededError
      );
    });

    it('should throw AgentNotFoundError when assigning non-existent agentId', async () => {
      const order = await createTestOrder('560076', '560001');
      await expect(manualAssignOrder(order.id, 'non_existent_agent_id', adminUserId)).rejects.toThrow(
        AgentNotFoundError
      );
    });

    it('should accurately decrement previous agent active load when reassigning order to a new agent', async () => {
      const order = await createTestOrder('560001', '560076');

      // 1. Assign to Agent South
      await manualAssignOrder(order.id, agentSouthProfile.id, adminUserId);
      let south = await getAgentById(agentSouthProfile.id);
      expect(south.activeOrdersCount).toBe(1);

      // 2. Reassign to Agent Multi
      await manualAssignOrder(order.id, agentMultiProfile.id, adminUserId);

      south = await getAgentById(agentSouthProfile.id);
      const multi = await getAgentById(agentMultiProfile.id);

      expect(south.activeOrdersCount).toBe(0); // Decremented
      expect(multi.activeOrdersCount).toBe(1); // Incremented
    });
  });

  describe('6. Agent Load Release & Terminal State Handlers', () => {
    it('should decrement activeOrdersCount upon calling releaseAgentOrder', async () => {
      await prisma.deliveryAgentProfile.update({
        where: { id: agentSouthProfile.id },
        data: { activeOrdersCount: 3, status: 'AVAILABLE' },
      });

      const releaseResult = await releaseAgentOrder('any_dummy_id', agentSouthProfile.id);

      expect(releaseResult?.success).toBe(true);
      expect(releaseResult?.activeOrdersCount).toBe(2);

      const refreshed = await getAgentById(agentSouthProfile.id);
      expect(refreshed.activeOrdersCount).toBe(2);
    });

    it('should never decrement activeOrdersCount below zero (floor safeguard)', async () => {
      await prisma.deliveryAgentProfile.update({
        where: { id: agentSouthProfile.id },
        data: { activeOrdersCount: 0, status: 'AVAILABLE' },
      });

      const releaseResult = await releaseAgentOrder('any_dummy_id', agentSouthProfile.id);

      expect(releaseResult?.success).toBe(true);
      expect(releaseResult?.activeOrdersCount).toBe(0);
    });

    it('should restore agent status to AVAILABLE if they were ON_DELIVERY due to full capacity', async () => {
      await prisma.deliveryAgentProfile.update({
        where: { id: agentNorthProfile.id },
        data: { activeOrdersCount: 2, maxCapacity: 2, status: 'ON_DELIVERY' },
      });

      const releaseResult = await releaseAgentOrder('dummy_id', agentNorthProfile.id);

      expect(releaseResult?.activeOrdersCount).toBe(1);
      expect(releaseResult?.status).toBe('AVAILABLE');

      const refreshed = await getAgentById(agentNorthProfile.id);
      expect(refreshed.status).toBe('AVAILABLE');
    });
  });

  describe('7. Batch Auto-Assignment Functionality', () => {
    it('should process and auto-assign multiple unassigned orders in batch', async () => {
      // Create 3 orders: 2 in North, 1 in South
      const order1 = await createTestOrder('560076', '560001'); // North
      const order2 = await createTestOrder('560076', '560001'); // North
      const order3 = await createTestOrder('560001', '560076'); // South

      // Set capacity limits
      await prisma.deliveryAgentProfile.update({
        where: { id: agentNorthProfile.id },
        data: { maxCapacity: 10, activeOrdersCount: 0, status: 'AVAILABLE' },
      });
      await prisma.deliveryAgentProfile.update({
        where: { id: agentSouthProfile.id },
        data: { maxCapacity: 10, activeOrdersCount: 0, status: 'AVAILABLE' },
      });

      const batchResult = await batchAutoAssignOrders();

      expect(batchResult.totalChecked).toBeGreaterThanOrEqual(3);
      expect(batchResult.assignedCount).toBeGreaterThanOrEqual(3);

      const assigned1 = await prisma.order.findUnique({ where: { id: order1.id } });
      const assigned2 = await prisma.order.findUnique({ where: { id: order2.id } });
      const assigned3 = await prisma.order.findUnique({ where: { id: order3.id } });

      expect(assigned1?.assignedAgentId).toBeDefined();
      expect(assigned2?.assignedAgentId).toBeDefined();
      expect(assigned3?.assignedAgentId).toBeDefined();
    });
  });

  describe('8. Agent Profile & Zone Management Service', () => {
    it('should update agent operational zones with setAgentZones', async () => {
      // Re-map Agent South to East Zone as well
      const updated = await setAgentZones(agentSouthProfile.id, [zoneSouthId, zoneEastId]);

      expect(updated.operationalZones.length).toBe(2);
      const zoneIds = updated.operationalZones.map((z) => z.zoneId);
      expect(zoneIds).toContain(zoneSouthId);
      expect(zoneIds).toContain(zoneEastId);
    });

    it('should throw InvalidZoneError if invalid zoneId is supplied to setAgentZones', async () => {
      await expect(
        setAgentZones(agentSouthProfile.id, ['non_existent_zone_id'])
      ).rejects.toThrow(InvalidZoneError);
    });

    it('should calculate live capacity stats correctly with getAgentCapacity', async () => {
      await prisma.deliveryAgentProfile.update({
        where: { id: agentNorthProfile.id },
        data: { activeOrdersCount: 1, maxCapacity: 5, status: 'AVAILABLE' },
      });

      const capacity = await getAgentCapacity(agentNorthProfile.id);
      expect(capacity.maxCapacity).toBe(5);
      expect(capacity.activeOrdersCount).toBe(1);
      expect(capacity.availableCapacity).toBe(4);
      expect(capacity.isAvailable).toBe(true);
    });
  });
});
