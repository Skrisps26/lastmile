// /home/skrisps/lastmile/tests/integration/agent-assignment-challenger-stress.test.ts

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth/password';
import { createSessionToken } from '@/lib/auth/jwt';
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
} from '@/lib/agents/service';
import { createOrder, updateOrderStatus, rescheduleOrder } from '@/lib/orders/service';
import { POST as autoAssignSingleOrderHandler } from '@/app/api/orders/[id]/auto-assign/route';
import { POST as autoAssignBatchHandler } from '@/app/api/orders/auto-assign/route';
import { POST as manualAssignOrderHandler } from '@/app/api/orders/[id]/assign/route';
import { POST as createOrderHandler } from '@/app/api/orders/route';

describe('Challenger Empirical Stress Suite: Delivery Agent & Auto-Assignment Engine (M4-R3)', () => {
  let adminToken: string;
  let adminUserId: string;
  let customerToken: string;
  let customerUserId: string;

  let zoneNorthId: string;
  let zoneSouthId: string;
  let zoneEastId: string;

  // Dedicated test agents for challenger suite
  let agentAlphaUser: any;
  let agentAlphaProfile: any;

  let agentBetaUser: any;
  let agentBetaProfile: any;

  let agentGammaUser: any;
  let agentGammaProfile: any;

  let agentSoloUser: any;
  let agentSoloProfile: any;

  beforeAll(async () => {
    const passwordHash = await hashPassword('StressSecurePass123!');

    // Fetch Zones
    const zNorth = await prisma.zone.findUnique({ where: { code: 'ZONE_NORTH' } });
    const zSouth = await prisma.zone.findUnique({ where: { code: 'ZONE_SOUTH' } });
    const zEast = await prisma.zone.findUnique({ where: { code: 'ZONE_EAST' } });

    zoneNorthId = zNorth!.id;
    zoneSouthId = zSouth!.id;
    zoneEastId = zEast!.id;

    // Admin & Customer
    const adminUser = await prisma.user.upsert({
      where: { email: 'admin.challenger.m4@lastmile.local' },
      update: {},
      create: {
        name: 'Challenger Admin',
        email: 'admin.challenger.m4@lastmile.local',
        passwordHash,
        role: 'ADMIN',
      },
    });
    adminUserId = adminUser.id;
    adminToken = await createSessionToken({
      userId: adminUser.id,
      email: adminUser.email,
      name: adminUser.name,
      role: 'ADMIN',
    });

    const customerUser = await prisma.user.upsert({
      where: { email: 'customer.challenger.m4@lastmile.local' },
      update: {},
      create: {
        name: 'Challenger Customer',
        email: 'customer.challenger.m4@lastmile.local',
        passwordHash,
        role: 'CUSTOMER',
      },
    });
    customerUserId = customerUser.id;
    customerToken = await createSessionToken({
      userId: customerUser.id,
      email: customerUser.email,
      name: customerUser.name,
      role: 'CUSTOMER',
    });

    // Agent Alpha (Zone North, Capacity 10)
    agentAlphaUser = await prisma.user.upsert({
      where: { email: 'agent.alpha.challenger@lastmile.local' },
      update: {},
      create: {
        name: 'Agent Alpha Challenger',
        email: 'agent.alpha.challenger@lastmile.local',
        passwordHash,
        role: 'AGENT',
      },
    });
    agentAlphaProfile = await prisma.deliveryAgentProfile.upsert({
      where: { userId: agentAlphaUser.id },
      update: { status: 'AVAILABLE', maxCapacity: 10, activeOrdersCount: 0 },
      create: {
        userId: agentAlphaUser.id,
        status: 'AVAILABLE',
        vehicleType: 'BIKE',
        vehicleNumber: 'KA-CH-01',
        maxCapacity: 10,
        activeOrdersCount: 0,
      },
    });
    await prisma.agentZoneMapping.deleteMany({ where: { agentId: agentAlphaProfile.id } });
    await prisma.agentZoneMapping.create({
      data: { agentId: agentAlphaProfile.id, zoneId: zoneNorthId },
    });

    // Agent Beta (Zone North, Capacity 10)
    agentBetaUser = await prisma.user.upsert({
      where: { email: 'agent.beta.challenger@lastmile.local' },
      update: {},
      create: {
        name: 'Agent Beta Challenger',
        email: 'agent.beta.challenger@lastmile.local',
        passwordHash,
        role: 'AGENT',
      },
    });
    agentBetaProfile = await prisma.deliveryAgentProfile.upsert({
      where: { userId: agentBetaUser.id },
      update: { status: 'AVAILABLE', maxCapacity: 10, activeOrdersCount: 0 },
      create: {
        userId: agentBetaUser.id,
        status: 'AVAILABLE',
        vehicleType: 'VAN',
        vehicleNumber: 'KA-CH-02',
        maxCapacity: 10,
        activeOrdersCount: 0,
      },
    });
    await prisma.agentZoneMapping.deleteMany({ where: { agentId: agentBetaProfile.id } });
    await prisma.agentZoneMapping.create({
      data: { agentId: agentBetaProfile.id, zoneId: zoneNorthId },
    });

    // Agent Gamma (Zone North, Capacity 10)
    agentGammaUser = await prisma.user.upsert({
      where: { email: 'agent.gamma.challenger@lastmile.local' },
      update: {},
      create: {
        name: 'Agent Gamma Challenger',
        email: 'agent.gamma.challenger@lastmile.local',
        passwordHash,
        role: 'AGENT',
      },
    });
    agentGammaProfile = await prisma.deliveryAgentProfile.upsert({
      where: { userId: agentGammaUser.id },
      update: { status: 'AVAILABLE', maxCapacity: 10, activeOrdersCount: 0 },
      create: {
        userId: agentGammaUser.id,
        status: 'AVAILABLE',
        vehicleType: 'BIKE',
        vehicleNumber: 'KA-CH-03',
        maxCapacity: 10,
        activeOrdersCount: 0,
      },
    });
    await prisma.agentZoneMapping.deleteMany({ where: { agentId: agentGammaProfile.id } });
    await prisma.agentZoneMapping.create({
      data: { agentId: agentGammaProfile.id, zoneId: zoneNorthId },
    });

    // Agent Solo (Zone South, Tight Capacity 3)
    agentSoloUser = await prisma.user.upsert({
      where: { email: 'agent.solo.challenger@lastmile.local' },
      update: {},
      create: {
        name: 'Agent Solo Challenger',
        email: 'agent.solo.challenger@lastmile.local',
        passwordHash,
        role: 'AGENT',
      },
    });
    agentSoloProfile = await prisma.deliveryAgentProfile.upsert({
      where: { userId: agentSoloUser.id },
      update: { status: 'AVAILABLE', maxCapacity: 3, activeOrdersCount: 0 },
      create: {
        userId: agentSoloUser.id,
        status: 'AVAILABLE',
        vehicleType: 'TRUCK',
        vehicleNumber: 'KA-CH-04',
        maxCapacity: 3,
        activeOrdersCount: 0,
      },
    });
    await prisma.agentZoneMapping.deleteMany({ where: { agentId: agentSoloProfile.id } });
    await prisma.agentZoneMapping.create({
      data: { agentId: agentSoloProfile.id, zoneId: zoneSouthId },
    });
  });

  beforeEach(async () => {
    // Keep each stress case isolated and avoid concurrent SQLite write locks
    // during fixture creation.
    await prisma.order.deleteMany();

    // Set all other non-challenger agents to OFFLINE to isolate challenger test runs
    await prisma.deliveryAgentProfile.updateMany({
      where: {
        id: {
          notIn: [
            agentAlphaProfile.id,
            agentBetaProfile.id,
            agentGammaProfile.id,
            agentSoloProfile.id,
          ],
        },
      },
      data: { status: 'OFFLINE' },
    });

    // Reset challenger agents
    await prisma.deliveryAgentProfile.update({
      where: { id: agentAlphaProfile.id },
      data: { status: 'AVAILABLE', activeOrdersCount: 0, maxCapacity: 10 },
    });
    await prisma.deliveryAgentProfile.update({
      where: { id: agentBetaProfile.id },
      data: { status: 'AVAILABLE', activeOrdersCount: 0, maxCapacity: 10 },
    });
    await prisma.deliveryAgentProfile.update({
      where: { id: agentGammaProfile.id },
      data: { status: 'AVAILABLE', activeOrdersCount: 0, maxCapacity: 10 },
    });
    await prisma.deliveryAgentProfile.update({
      where: { id: agentSoloProfile.id },
      data: { status: 'AVAILABLE', activeOrdersCount: 0, maxCapacity: 3 },
    });
  });

  afterAll(async () => {
    // Restore demo agents
    await prisma.deliveryAgentProfile.updateMany({
      where: {
        user: { email: { in: ['agent1@lastmile.local', 'agent2@lastmile.local'] } },
      },
      data: { status: 'AVAILABLE', activeOrdersCount: 0 },
    });
    await prisma.$disconnect();
  });

  function createReq(url: string, method = 'GET', token?: string, body?: any) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['cookie'] = `auth-token=${token}`;
      headers['authorization'] = `Bearer ${token}`;
    }
    return new NextRequest(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async function createTestOrder(dropPincode = '560001', pickupPincode = '560076') {
    return createOrder(
      {
        pickupPincode,
        dropPincode,
        senderName: 'Sender Challenger',
        senderPhone: '+91-9876543210',
        senderStreet: '100 Sender Road',
        senderCity: 'Bangalore',
        senderState: 'Karnataka',
        recipientName: 'Recipient Challenger',
        recipientPhone: '+91-9876543211',
        recipientStreet: '200 Receiver Road',
        recipientCity: 'Bangalore',
        recipientState: 'Karnataka',
        packageLengthCm: 15,
        packageBreadthCm: 10,
        packageHeightCm: 8,
        actualWeightKg: 1.2,
        customerType: 'B2C',
      },
      customerUserId
    );
  }

  // =========================================================================
  // 1. MAX CAPACITY SATURATION TESTS
  // =========================================================================
  describe('1. Max Capacity Saturation & Full Utilization Tests', () => {
    it('1.1 should assign up to maxCapacity and strictly reject further auto-assignment', async () => {
      // Set Agent Solo capacity to 2 in Zone South (560076)
      await prisma.deliveryAgentProfile.update({
        where: { id: agentSoloProfile.id },
        data: { maxCapacity: 2, activeOrdersCount: 0, status: 'AVAILABLE' },
      });

      const order1 = await createTestOrder('560076');
      const order2 = await createTestOrder('560076');
      const order3 = await createTestOrder('560076');

      // Order 1 Assignment
      const res1 = await autoAssignOrder(order1.id);
      expect(res1.success).toBe(true);
      expect(res1.assignedAgent?.id).toBe(agentSoloProfile.id);
      expect(res1.assignedAgent?.activeOrdersCount).toBe(1);
      expect(res1.assignedAgent?.status).toBe('AVAILABLE');

      // Order 2 Assignment (Reaches max capacity 2/2)
      const res2 = await autoAssignOrder(order2.id);
      expect(res2.success).toBe(true);
      expect(res2.assignedAgent?.id).toBe(agentSoloProfile.id);
      expect(res2.assignedAgent?.activeOrdersCount).toBe(2);
      expect(res2.assignedAgent?.status).toBe('ON_DELIVERY');

      // Check DB Profile
      const agentProfile = await getAgentById(agentSoloProfile.id);
      expect(agentProfile.activeOrdersCount).toBe(2);
      expect(agentProfile.status).toBe('ON_DELIVERY');
      expect(agentProfile.availableCapacity).toBe(0);

      // Order 3 Assignment (Must FAIL)
      const res3 = await autoAssignOrder(order3.id);
      expect(res3.success).toBe(false);
      expect(res3.reason).toBe('No available agents in zone');

      // Verify Order 3 remains unassigned in CREATED status
      const checkOrder3 = await prisma.order.findUnique({ where: { id: order3.id } });
      expect(checkOrder3?.assignedAgentId).toBeNull();
    });

    it('1.2 should restore availability when an order is completed/delivered, allowing queued assignment', async () => {
      // Agent Solo with capacity 1
      await prisma.deliveryAgentProfile.update({
        where: { id: agentSoloProfile.id },
        data: { maxCapacity: 1, activeOrdersCount: 0, status: 'AVAILABLE' },
      });

      const orderA = await createTestOrder('560076');
      const orderB = await createTestOrder('560076');

      // Assign Order A
      const resA = await autoAssignOrder(orderA.id);
      expect(resA.success).toBe(true);

      // Order B fails
      const resB1 = await autoAssignOrder(orderB.id);
      expect(resB1.success).toBe(false);

      // Transition Order A: ASSIGNED -> PICKED_UP -> IN_TRANSIT -> OUT_FOR_DELIVERY -> DELIVERED
      await updateOrderStatus(orderA.id, 'PICKED_UP', agentSoloUser.id, 'Picked up package');
      await updateOrderStatus(orderA.id, 'IN_TRANSIT', agentSoloUser.id, 'In transit');
      await updateOrderStatus(orderA.id, 'OUT_FOR_DELIVERY', agentSoloUser.id, 'Out for delivery');
      await updateOrderStatus(orderA.id, 'DELIVERED', agentSoloUser.id, 'Delivered package');

      // Verify agent capacity restored
      const refreshedAgent = await getAgentById(agentSoloProfile.id);
      expect(refreshedAgent.activeOrdersCount).toBe(0);
      expect(refreshedAgent.status).toBe('AVAILABLE');
      expect(refreshedAgent.availableCapacity).toBe(1);

      // Order B now successfully auto-assigns!
      const resB2 = await autoAssignOrder(orderB.id);
      expect(resB2.success).toBe(true);
      expect(resB2.assignedAgent?.id).toBe(agentSoloProfile.id);
      expect(resB2.assignedAgent?.activeOrdersCount).toBe(1);
    });

    it('1.3 should reject manual assignment if agent is at capacity with AgentCapacityExceededError', async () => {
      await prisma.deliveryAgentProfile.update({
        where: { id: agentSoloProfile.id },
        data: { maxCapacity: 1, activeOrdersCount: 1, status: 'ON_DELIVERY' },
      });

      const order = await createTestOrder('560076');

      await expect(
        manualAssignOrder(order.id, agentSoloProfile.id, adminUserId)
      ).rejects.toThrow(AgentCapacityExceededError);
    });
  });

  // =========================================================================
  // 2. LOAD BALANCING PRECISION TESTS
  // =========================================================================
  describe('2. Load Balancing & Multi-Agent Distribution Tests', () => {
    it('2.1 should distribute incoming orders evenly across 3 available agents in the same zone', async () => {
      // In Zone North (560001), Alpha, Beta, Gamma are all AVAILABLE with capacity 10, active 0
      const orderIds: string[] = [];
      for (let i = 0; i < 6; i++) {
        const ord = await createTestOrder('560001'); // Zone North
        orderIds.push(ord.id);
      }

      const assignedAgentIds: string[] = [];
      for (const ordId of orderIds) {
        const res = await autoAssignOrder(ordId);
        expect(res.success).toBe(true);
        assignedAgentIds.push(res.assignedAgent!.id);
      }

      // Count assignments per agent
      const alphaCount = assignedAgentIds.filter((id) => id === agentAlphaProfile.id).length;
      const betaCount = assignedAgentIds.filter((id) => id === agentBetaProfile.id).length;
      const gammaCount = assignedAgentIds.filter((id) => id === agentGammaProfile.id).length;

      // With 6 orders and 3 agents, each agent must receive EXACTLY 2 orders (round-robin / least load)
      expect(alphaCount).toBe(2);
      expect(betaCount).toBe(2);
      expect(gammaCount).toBe(2);
    });

    it('2.2 should strictly select the agent with lowest activeOrdersCount when loads are unequal', async () => {
      // Set unequal initial loads: Alpha=4, Beta=1, Gamma=0
      await prisma.deliveryAgentProfile.update({
        where: { id: agentAlphaProfile.id },
        data: { activeOrdersCount: 4, status: 'AVAILABLE' },
      });
      await prisma.deliveryAgentProfile.update({
        where: { id: agentBetaProfile.id },
        data: { activeOrdersCount: 1, status: 'AVAILABLE' },
      });
      await prisma.deliveryAgentProfile.update({
        where: { id: agentGammaProfile.id },
        data: { activeOrdersCount: 0, status: 'AVAILABLE' },
      });

      // 1st order -> must go to Gamma (0 -> 1)
      const order1 = await createTestOrder('560001');
      const res1 = await autoAssignOrder(order1.id);
      expect(res1.assignedAgent?.id).toBe(agentGammaProfile.id);

      // 2nd order -> Beta and Gamma both at 1. One of them is selected.
      const order2 = await createTestOrder('560001');
      const res2 = await autoAssignOrder(order2.id);
      expect([agentBetaProfile.id, agentGammaProfile.id]).toContain(res2.assignedAgent?.id);

      // 3rd order -> the remaining agent between Beta and Gamma is selected (both now at 2)
      const order3 = await createTestOrder('560001');
      const res3 = await autoAssignOrder(order3.id);
      expect([agentBetaProfile.id, agentGammaProfile.id]).toContain(res3.assignedAgent?.id);

      // Alpha (load 4) should NOT have received any of the 3 orders
      const checkAlpha = await getAgentById(agentAlphaProfile.id);
      expect(checkAlpha.activeOrdersCount).toBe(4);
    });
  });

  // =========================================================================
  // 3. OFFLINE & ON_DELIVERY EXCLUSION TESTS
  // =========================================================================
  describe('3. Agent Availability State Filtering (OFFLINE & ON_DELIVERY Exclusion)', () => {
    it('3.1 should strictly exclude OFFLINE agents from auto-assignment', async () => {
      // Set all Zone North agents to OFFLINE
      await prisma.deliveryAgentProfile.update({
        where: { id: agentAlphaProfile.id },
        data: { status: 'OFFLINE', activeOrdersCount: 0 },
      });
      await prisma.deliveryAgentProfile.update({
        where: { id: agentBetaProfile.id },
        data: { status: 'OFFLINE', activeOrdersCount: 0 },
      });
      await prisma.deliveryAgentProfile.update({
        where: { id: agentGammaProfile.id },
        data: { status: 'OFFLINE', activeOrdersCount: 0 },
      });

      const order = await createTestOrder('560001');
      const res = await autoAssignOrder(order.id);

      expect(res.success).toBe(false);
      expect(res.reason).toBe('No available agents in zone');
    });

    it('3.2 should strictly exclude ON_DELIVERY agents from auto-assignment', async () => {
      // Set all Zone North agents to ON_DELIVERY
      await prisma.deliveryAgentProfile.update({
        where: { id: agentAlphaProfile.id },
        data: { status: 'ON_DELIVERY', activeOrdersCount: 1 },
      });
      await prisma.deliveryAgentProfile.update({
        where: { id: agentBetaProfile.id },
        data: { status: 'ON_DELIVERY', activeOrdersCount: 1 },
      });
      await prisma.deliveryAgentProfile.update({
        where: { id: agentGammaProfile.id },
        data: { status: 'ON_DELIVERY', activeOrdersCount: 1 },
      });

      const order = await createTestOrder('560001');
      const res = await autoAssignOrder(order.id);

      expect(res.success).toBe(false);
      expect(res.reason).toBe('No available agents in zone');
    });

    it('3.3 should dynamically include agent immediately after status toggles from OFFLINE to AVAILABLE', async () => {
      await updateAgentStatus(agentAlphaProfile.id, 'OFFLINE');
      await updateAgentStatus(agentBetaProfile.id, 'OFFLINE');
      await updateAgentStatus(agentGammaProfile.id, 'OFFLINE');

      const order = await createTestOrder('560001');
      let res = await autoAssignOrder(order.id);
      expect(res.success).toBe(false);

      // Turn Beta back ON
      await updateAgentStatus(agentBetaProfile.id, 'AVAILABLE');

      res = await autoAssignOrder(order.id);
      expect(res.success).toBe(true);
      expect(res.assignedAgent?.id).toBe(agentBetaProfile.id);
    });
  });

  // =========================================================================
  // 4. HIGH-CONCURRENCY STRESS & RACE CONDITION TESTS
  // =========================================================================
  describe('4. High-Concurrency Stress & Race Condition Verification', () => {
    it('4.1 should safely handle 15 concurrent auto-assign requests for the SAME order without double-assignment', async () => {
      const order = await createTestOrder('560001');

      // Fire 15 concurrent autoAssignOrder calls for the exact same orderId
      const promises = Array.from({ length: 15 }, () => autoAssignOrder(order.id));
      const results = await Promise.allSettled(promises);

      // Verify that all calls resolved without crashing
      const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
      expect(fulfilled.length).toBe(15);

      // At least 1 returned success=true, while subsequent calls either returned success=false
      // ("Order is already assigned...") or idempotent result
      const successfulAssignments = fulfilled.filter((r) => r.value.success === true);
      expect(successfulAssignments.length).toBeGreaterThanOrEqual(1);

      // Inspect DB state of the order
      const finalOrder = await prisma.order.findUnique({
        where: { id: order.id },
        include: { statusHistory: true },
      });

      expect(finalOrder?.assignedAgentId).toBeDefined();
      expect(finalOrder?.assignedAgentId).not.toBeNull();

      // Ensure that exactly one assigned agent ID is recorded
      const assignedId = finalOrder!.assignedAgentId;

      // Check total activeOrdersCount on all agents: sum must equal 1 (not 15!)
      const agents = await prisma.deliveryAgentProfile.findMany({
        where: { id: { in: [agentAlphaProfile.id, agentBetaProfile.id, agentGammaProfile.id] } },
      });
      const totalActiveLoad = agents.reduce((acc, a) => acc + a.activeOrdersCount, 0);
      expect(totalActiveLoad).toBe(1);
    });

    it('4.2 should enforce strict capacity under a stampede of 15 concurrent orders on a single agent (capacity=3)', async () => {
      // Isolate Agent Solo in Zone South (capacity=3, active=0)
      await prisma.deliveryAgentProfile.update({
        where: { id: agentSoloProfile.id },
        data: { maxCapacity: 3, activeOrdersCount: 0, status: 'AVAILABLE' },
      });

      // Create 15 unassigned orders in Zone South (560076)
      const orders = [];
      for (let i = 0; i < 15; i++) {
        orders.push(await createTestOrder('560076'));
      }

      // Concurrently fire autoAssignOrder for all 15 orders
      const results = await Promise.allSettled(
        orders.map((ord) => autoAssignOrder(ord.id))
      );

      // Count successes
      const successful = results
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
        .filter((r) => r.value.success === true);

      // Total assigned orders must NOT exceed maxCapacity (3)
      expect(successful.length).toBeLessThanOrEqual(3);

      // Check Agent Solo in DB
      const agentSolo = await getAgentById(agentSoloProfile.id);
      expect(agentSolo.activeOrdersCount).toBeLessThanOrEqual(3);

      if (agentSolo.activeOrdersCount >= 3) {
        expect(agentSolo.status).toBe('ON_DELIVERY');
        expect(agentSolo.availableCapacity).toBe(0);
      }
    });

    it('4.3 should handle concurrent batch auto-assignment without duplicate allocations or state corruption', async () => {
      // Reset agents in Zone North with capacities 5 each
      await prisma.deliveryAgentProfile.update({
        where: { id: agentAlphaProfile.id },
        data: { maxCapacity: 5, activeOrdersCount: 0, status: 'AVAILABLE' },
      });
      await prisma.deliveryAgentProfile.update({
        where: { id: agentBetaProfile.id },
        data: { maxCapacity: 5, activeOrdersCount: 0, status: 'AVAILABLE' },
      });
      await prisma.deliveryAgentProfile.update({
        where: { id: agentGammaProfile.id },
        data: { maxCapacity: 5, activeOrdersCount: 0, status: 'AVAILABLE' },
      });

      // Create 9 unassigned orders in Zone North
      await Promise.all(Array.from({ length: 9 }, () => createTestOrder('560001')));

      // Launch 3 concurrent batchAutoAssignOrders executions
      const batchRuns = await Promise.all([
        batchAutoAssignOrders(),
        batchAutoAssignOrders(),
        batchAutoAssignOrders(),
      ]);

      expect(batchRuns.length).toBe(3);

      // Verify that all 9 orders are assigned
      const unassignedNorthOrders = await prisma.order.findMany({
        where: {
          dropZoneId: zoneNorthId,
          assignedAgentId: null,
        },
      });
      expect(unassignedNorthOrders.length).toBe(0);

      // Check that sum of activeOrdersCount matches total assigned orders
      const agents = await prisma.deliveryAgentProfile.findMany({
        where: { id: { in: [agentAlphaProfile.id, agentBetaProfile.id, agentGammaProfile.id] } },
      });
      const totalLoad = agents.reduce((sum, a) => sum + a.activeOrdersCount, 0);
      expect(totalLoad).toBe(9);
    });

    it('4.4 should handle rapid parallel API requests to POST /api/orders/:id/auto-assign', async () => {
      // Create 6 orders
      const orders: any[] = [];
      for (let i = 0; i < 6; i++) {
        const createReqObj = createReq('http://localhost:3000/api/orders', 'POST', customerToken, {
          pickupPincode: '560076',
          dropPincode: '560001',
          senderName: `API Parallel ${i}`,
          senderPhone: '+91-9876543210',
          senderStreet: '100 Street',
          senderCity: 'Bangalore',
          senderState: 'Karnataka',
          recipientName: `API Receiver ${i}`,
          recipientPhone: '+91-9876543211',
          recipientStreet: '200 Street',
          recipientCity: 'Bangalore',
          recipientState: 'Karnataka',
          packageLengthCm: 10,
          packageBreadthCm: 10,
          packageHeightCm: 10,
          actualWeightKg: 1.0,
        });
        const res = await createOrderHandler(createReqObj);
        expect(res.status).toBe(201);
        orders.push(await res.json());
      }

      // Auto-assign all 6 in parallel via API handler
      const assignResponses = await Promise.all(
        orders.map((ord) =>
          autoAssignSingleOrderHandler(
            createReq(`http://localhost:3000/api/orders/${ord.id}/auto-assign`, 'POST', adminToken),
            { params: { id: ord.id } }
          )
        )
      );

      for (const res of assignResponses) {
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.assignedAgent).toBeDefined();
      }
    });
  });

  // =========================================================================
  // 5. RESCHEDULE & TERMINAL STATE LIFECYCLE INVARIANTS
  // =========================================================================
  describe('5. Reschedule & Lifecycle Invariant Tests', () => {
    it('5.1 should allow auto-assignment of a RESCHEDULED order after a failed delivery attempt', async () => {
      const order = await createTestOrder('560076'); // Zone South

      // Initial auto-assignment to Solo
      const res1 = await autoAssignOrder(order.id);
      expect(res1.success).toBe(true);
      expect(res1.assignedAgent?.id).toBe(agentSoloProfile.id);

      // Agent Solo marks FAILED
      await updateOrderStatus(
        order.id,
        'PICKED_UP',
        agentSoloUser.id,
        'Collected package'
      );
      await updateOrderStatus(
        order.id,
        'IN_TRANSIT',
        agentSoloUser.id,
        'Package in transit'
      );
      await updateOrderStatus(
        order.id,
        'OUT_FOR_DELIVERY',
        agentSoloUser.id,
        'Out for delivery'
      );
      await updateOrderStatus(
        order.id,
        'FAILED',
        agentSoloUser.id,
        'Customer unavailable at address'
      );

      // Verify Solo's load was released
      let solo = await getAgentById(agentSoloProfile.id);
      expect(solo.activeOrdersCount).toBe(0);

      // Customer reschedules
      const tomorrow = new Date(Date.now() + 86400000);
      const rescheduled = await rescheduleOrder(
        order.id,
        tomorrow,
        customerUserId,
        'Please deliver tomorrow afternoon'
      );
      expect(rescheduled.currentStatus).toBe('RESCHEDULED');

      // Auto-assign again -> should succeed
      const res2 = await autoAssignOrder(order.id);
      expect(res2.success).toBe(true);
      expect(res2.assignedAgent?.id).toBe(agentSoloProfile.id);

      solo = await getAgentById(agentSoloProfile.id);
      expect(solo.activeOrdersCount).toBe(1);
    });

    it('5.2 should disallow auto-assignment for orders in terminal states (DELIVERED, CANCELLED)', async () => {
      const order = await createTestOrder('560001');

      // Assign and deliver
      await autoAssignOrder(order.id);
      await updateOrderStatus(order.id, 'PICKED_UP', agentAlphaUser.id);
      await updateOrderStatus(order.id, 'IN_TRANSIT', agentAlphaUser.id);
      await updateOrderStatus(order.id, 'OUT_FOR_DELIVERY', agentAlphaUser.id);
      await updateOrderStatus(order.id, 'DELIVERED', agentAlphaUser.id);

      // Try auto-assigning again
      const res = await autoAssignOrder(order.id);
      expect(res.success).toBe(false);
      expect(res.reason).toMatch(/cannot be assigned in status 'DELIVERED'/i);
    });
  });
});
