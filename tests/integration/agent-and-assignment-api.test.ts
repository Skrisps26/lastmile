// /home/skrisps/lastmile/tests/integration/agent-and-assignment-api.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { GET as listAgentsHandler } from '@/app/api/agents/route';
import { PUT as updateAgentStatusHandler } from '@/app/api/agents/[id]/status/route';
import { PUT as updateAgentZonesHandler } from '@/app/api/agents/[id]/zones/route';
import { POST as manualAssignOrderHandler } from '@/app/api/orders/[id]/assign/route';
import { POST as autoAssignSingleOrderHandler } from '@/app/api/orders/[id]/auto-assign/route';
import { POST as autoAssignBatchHandler } from '@/app/api/orders/auto-assign/route';
import { POST as createOrderHandler } from '@/app/api/orders/route';
import { POST as transitionStatusHandler } from '@/app/api/orders/[id]/status/route';
import { POST as rescheduleOrderHandler } from '@/app/api/orders/[id]/reschedule/route';
import { createSessionToken } from '@/lib/auth/jwt';
import { hashPassword } from '@/lib/auth/password';

describe('Integration: Delivery Agent Management & Auto-Assignment API Suite (M4-R3)', () => {
  let adminToken: string;
  let adminUserId: string;

  let customerToken: string;
  let customerUserId: string;

  let agent1Token: string;
  let agent1UserId: string;
  let agent1ProfileId: string;

  let agent2Token: string;
  let agent2UserId: string;
  let agent2ProfileId: string;

  let zoneNorthId: string;
  let zoneSouthId: string;

  beforeAll(async () => {
    const passwordHash = await hashPassword('SecurePass123!');

    // 1. Lookup Seeded Zones
    const zNorth = await prisma.zone.findUnique({ where: { code: 'ZONE_NORTH' } });
    const zSouth = await prisma.zone.findUnique({ where: { code: 'ZONE_SOUTH' } });
    zoneNorthId = zNorth!.id;
    zoneSouthId = zSouth!.id;

    // 4. Setup Test Users & Tokens
    // Admin
    const adminUser = await prisma.user.upsert({
      where: { email: 'admin.m4@lastmile.local' },
      update: {},
      create: {
        name: 'M4 Admin Controller',
        email: 'admin.m4@lastmile.local',
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

    // Customer
    const customerUser = await prisma.user.upsert({
      where: { email: 'customer.m4@lastmile.local' },
      update: {},
      create: {
        name: 'M4 Customer Consumer',
        email: 'customer.m4@lastmile.local',
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

    // Agent 1 (North, capacity: 5)
    const agent1User = await prisma.user.upsert({
      where: { email: 'agent1.m4@lastmile.local' },
      update: {},
      create: {
        name: 'M4 Agent North',
        email: 'agent1.m4@lastmile.local',
        passwordHash,
        role: 'AGENT',
      },
    });
    agent1UserId = agent1User.id;
    agent1Token = await createSessionToken({
      userId: agent1User.id,
      email: agent1User.email,
      name: agent1User.name,
      role: 'AGENT',
    });

    const a1Profile = await prisma.deliveryAgentProfile.upsert({
      where: { userId: agent1User.id },
      update: {
        status: 'AVAILABLE',
        maxCapacity: 5,
        activeOrdersCount: 0,
      },
      create: {
        userId: agent1User.id,
        status: 'AVAILABLE',
        vehicleType: 'BIKE',
        vehicleNumber: 'KA-01-INT-001',
        maxCapacity: 5,
        activeOrdersCount: 0,
      },
    });
    agent1ProfileId = a1Profile.id;

    await prisma.agentZoneMapping.deleteMany({ where: { agentId: agent1ProfileId } });
    await prisma.agentZoneMapping.create({
      data: { agentId: agent1ProfileId, zoneId: zoneNorthId },
    });

    // Agent 2 (South, capacity: 5)
    const agent2User = await prisma.user.upsert({
      where: { email: 'agent2.m4@lastmile.local' },
      update: {},
      create: {
        name: 'M4 Agent South',
        email: 'agent2.m4@lastmile.local',
        passwordHash,
        role: 'AGENT',
      },
    });
    agent2UserId = agent2User.id;
    agent2Token = await createSessionToken({
      userId: agent2User.id,
      email: agent2User.email,
      name: agent2User.name,
      role: 'AGENT',
    });

    const a2Profile = await prisma.deliveryAgentProfile.upsert({
      where: { userId: agent2User.id },
      update: {
        status: 'AVAILABLE',
        maxCapacity: 5,
        activeOrdersCount: 0,
      },
      create: {
        userId: agent2User.id,
        status: 'AVAILABLE',
        vehicleType: 'VAN',
        vehicleNumber: 'KA-01-INT-002',
        maxCapacity: 5,
        activeOrdersCount: 0,
      },
    });
    agent2ProfileId = a2Profile.id;

    await prisma.agentZoneMapping.deleteMany({ where: { agentId: agent2ProfileId } });
    await prisma.agentZoneMapping.create({
      data: { agentId: agent2ProfileId, zoneId: zoneSouthId },
    });

    // Deactivate seeded demo agents so integration tests isolate agent1 and agent2
    await prisma.deliveryAgentProfile.updateMany({
      where: {
        id: { notIn: [agent1ProfileId, agent2ProfileId] },
      },
      data: { status: 'OFFLINE' },
    });
  });

  afterAll(async () => {
    // Restore seeded demo agents
    await prisma.deliveryAgentProfile.updateMany({
      where: {
        user: { email: { in: ['agent1@lastmile.local', 'agent2@lastmile.local'] } },
      },
      data: { status: 'AVAILABLE', activeOrdersCount: 0 },
    });
    await prisma.$disconnect();
  });

  // Request Helpers
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

  describe('1. Agent Roster & Zone Management Endpoints', () => {
    it('GET /api/agents — should return list of all agents for Admin', async () => {
      const req = createReq('http://localhost:3000/api/agents', 'GET', adminToken);
      const res = await listAgentsHandler(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.agents)).toBe(true);
      expect(data.agents.length).toBeGreaterThanOrEqual(2);

      const agent1 = data.agents.find((a: any) => a.id === agent1ProfileId);
      expect(agent1).toBeDefined();
      expect(agent1.status).toBe('AVAILABLE');
      expect(agent1.operationalZones.length).toBeGreaterThanOrEqual(1);
    });

    it('GET /api/agents — should filter agents by status and zone', async () => {
      const req = createReq(
        `http://localhost:3000/api/agents?status=AVAILABLE&zoneId=${zoneNorthId}`,
        'GET',
        adminToken
      );
      const res = await listAgentsHandler(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.agents)).toBe(true);
      for (const a of data.agents) {
        expect(a.status).toBe('AVAILABLE');
        const hasZone = a.operationalZones.some((z: any) => z.zoneId === zoneNorthId);
        expect(hasZone).toBe(true);
      }
    });

    it('PUT /api/agents/:id/status — Agent should be able to toggle own status to OFFLINE and back', async () => {
      // Toggle to OFFLINE
      const req1 = createReq(
        `http://localhost:3000/api/agents/${agent1ProfileId}/status`,
        'PUT',
        agent1Token,
        { status: 'OFFLINE' }
      );
      const res1 = await updateAgentStatusHandler(req1, { params: { id: agent1ProfileId } });

      expect(res1.status).toBe(200);
      const data1 = await res1.json();
      expect(data1.status).toBe('OFFLINE');

      // Toggle back to AVAILABLE
      const req2 = createReq(
        `http://localhost:3000/api/agents/${agent1ProfileId}/status`,
        'PUT',
        agent1Token,
        { status: 'AVAILABLE' }
      );
      const res2 = await updateAgentStatusHandler(req2, { params: { id: agent1ProfileId } });

      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      expect(data2.status).toBe('AVAILABLE');
    });

    it('PUT /api/agents/:id/zones — Admin should update agent operational zone mappings', async () => {
      const req = createReq(
        `http://localhost:3000/api/agents/${agent1ProfileId}/zones`,
        'PUT',
        adminToken,
        { zoneIds: [zoneNorthId, zoneSouthId] }
      );
      const res = await updateAgentZonesHandler(req, { params: { id: agent1ProfileId } });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.operationalZones.length).toBe(2);
      const zoneIds = data.operationalZones.map((z: any) => z.zoneId);
      expect(zoneIds).toContain(zoneNorthId);
      expect(zoneIds).toContain(zoneSouthId);

      // Restore Agent 1 back to zoneNorthId only
      await updateAgentZonesHandler(
        createReq(
          `http://localhost:3000/api/agents/${agent1ProfileId}/zones`,
          'PUT',
          adminToken,
          { zoneIds: [zoneNorthId] }
        ),
        { params: { id: agent1ProfileId } }
      );
    });
  });

  describe('2. Manual Admin Agent Assignment (POST /api/orders/:id/assign)', () => {
    it('should allow Admin to manually assign an agent to an order', async () => {
      // 1. Create Order as Customer
      const createReqObj = createReq('http://localhost:3000/api/orders', 'POST', customerToken, {
        pickupPincode: '560001',
        dropPincode: '560076',
        senderName: 'Manual Assign Sender',
        senderPhone: '+91-9876543210',
        senderStreet: '101 First Ave',
        senderCity: 'Bangalore',
        senderState: 'Karnataka',
        recipientName: 'Manual Assign Recipient',
        recipientPhone: '+91-9876543211',
        recipientStreet: '202 Second Ave',
        recipientCity: 'Bangalore',
        recipientState: 'Karnataka',
        packageLengthCm: 25,
        packageBreadthCm: 20,
        packageHeightCm: 15,
        actualWeightKg: 2.0,
      });
      const createRes = await createOrderHandler(createReqObj);
      expect(createRes.status).toBe(201);
      const order = await createRes.json();

      // 2. Admin assigns Agent 2
      const assignReq = createReq(
        `http://localhost:3000/api/orders/${order.id}/assign`,
        'POST',
        adminToken,
        { agentId: agent2ProfileId }
      );
      const assignRes = await manualAssignOrderHandler(assignReq, { params: { id: order.id } });

      expect(assignRes.status).toBe(200);
      const assignData = await assignRes.json();
      expect(assignData.success).toBe(true);
      expect(assignData.assignedAgent.id).toBe(agent2ProfileId);
      expect(assignData.order.assignedAgentId).toBe(agent2ProfileId);
      expect(assignData.order.currentStatus).toBe('ASSIGNED');
    });

    it('should reject manual assignment with 400 when agent capacity is exceeded', async () => {
      // Set Agent 1 capacity = 1, active = 1
      await prisma.deliveryAgentProfile.update({
        where: { id: agent1ProfileId },
        data: { maxCapacity: 1, activeOrdersCount: 1 },
      });

      const createReqObj = createReq('http://localhost:3000/api/orders', 'POST', customerToken, {
        pickupPincode: '560001',
        dropPincode: '560001',
        senderName: 'Cap Test Sender',
        senderPhone: '+91-9876543210',
        senderStreet: '101 Street',
        senderCity: 'Bangalore',
        senderState: 'Karnataka',
        recipientName: 'Cap Test Recipient',
        recipientPhone: '+91-9876543211',
        recipientStreet: '202 Street',
        recipientCity: 'Bangalore',
        recipientState: 'Karnataka',
        packageLengthCm: 10,
        packageBreadthCm: 10,
        packageHeightCm: 10,
        actualWeightKg: 1.0,
      });
      const createRes = await createOrderHandler(createReqObj);
      const order = await createRes.json();

      const assignReq = createReq(
        `http://localhost:3000/api/orders/${order.id}/assign`,
        'POST',
        adminToken,
        { agentId: agent1ProfileId }
      );
      const assignRes = await manualAssignOrderHandler(assignReq, { params: { id: order.id } });

      expect(assignRes.status).toBe(400);
      const err = await assignRes.json();
      expect(err.error).toContain('reached maximum delivery capacity');

      // Reset Agent 1 capacity
      await prisma.deliveryAgentProfile.update({
        where: { id: agent1ProfileId },
        data: { maxCapacity: 5, activeOrdersCount: 0 },
      });
    });
  });

  describe('3. Auto-Assignment Endpoints (Single and Batch)', () => {
    it('POST /api/orders/:id/auto-assign — should auto-assign order to matching zone agent', async () => {
      // Create order in Zone North
      const createReqObj = createReq('http://localhost:3000/api/orders', 'POST', customerToken, {
        pickupPincode: '560076',
        dropPincode: '560001', // Drop North
        senderName: 'Auto Sender',
        senderPhone: '+91-9876543210',
        senderStreet: '101 Street',
        senderCity: 'Bangalore',
        senderState: 'Karnataka',
        recipientName: 'Auto Recipient',
        recipientPhone: '+91-9876543211',
        recipientStreet: '202 Street',
        recipientCity: 'Bangalore',
        recipientState: 'Karnataka',
        packageLengthCm: 10,
        packageBreadthCm: 10,
        packageHeightCm: 10,
        actualWeightKg: 1.0,
      });
      const createRes = await createOrderHandler(createReqObj);
      const order = await createRes.json();

      const autoReq = createReq(
        `http://localhost:3000/api/orders/${order.id}/auto-assign`,
        'POST',
        adminToken
      );
      const autoRes = await autoAssignSingleOrderHandler(autoReq, { params: { id: order.id } });

      expect(autoRes.status).toBe(200);
      const result = await autoRes.json();
      expect(result.success).toBe(true);
      expect(result.assignedAgent.id).toBe(agent1ProfileId); // Agent 1 is in Zone North
    });

    it('POST /api/orders/auto-assign — should batch auto-assign unassigned orders', async () => {
      // Create 2 unassigned orders
      await createOrderHandler(
        createReq('http://localhost:3000/api/orders', 'POST', customerToken, {
          pickupPincode: '560001',
          dropPincode: '560076', // Drop South -> Agent 2
          senderName: 'Batch Sender 1',
          senderPhone: '+91-9876543210',
          senderStreet: 'Street 1',
          senderCity: 'Bangalore',
          senderState: 'Karnataka',
          recipientName: 'Batch Recipient 1',
          recipientPhone: '+91-9876543211',
          recipientStreet: 'Street 2',
          recipientCity: 'Bangalore',
          recipientState: 'Karnataka',
          packageLengthCm: 10,
          packageBreadthCm: 10,
          packageHeightCm: 10,
          actualWeightKg: 1.0,
        })
      );

      const batchReq = createReq('http://localhost:3000/api/orders/auto-assign', 'POST', adminToken);
      const batchRes = await autoAssignBatchHandler(batchReq);

      expect(batchRes.status).toBe(200);
      const batchData = await batchRes.json();
      expect(batchData.totalChecked).toBeGreaterThanOrEqual(1);
      expect(batchData.assignedCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('4. Complete End-to-End Failed Delivery Reschedule & Reassignment Flow', () => {
    it('should complete full cycle: Booking -> Auto-Assign -> Picked Up -> In Transit -> Out For Delivery -> Failed -> Reschedule -> Reassign -> Delivered', async () => {
      // 1. Customer Books Order
      const createRes = await createOrderHandler(
        createReq('http://localhost:3000/api/orders', 'POST', customerToken, {
          pickupPincode: '560076',
          dropPincode: '560001', // Drop North
          senderName: 'E2E Sender',
          senderPhone: '+91-9876543210',
          senderStreet: 'Origin St',
          senderCity: 'Bangalore',
          senderState: 'Karnataka',
          recipientName: 'E2E Receiver',
          recipientPhone: '+91-9876543211',
          recipientStreet: 'Dest St',
          recipientCity: 'Bangalore',
          recipientState: 'Karnataka',
          packageLengthCm: 15,
          packageBreadthCm: 15,
          packageHeightCm: 15,
          actualWeightKg: 2.0,
        })
      );
      expect(createRes.status).toBe(201);
      const order = await createRes.json();
      expect(order.currentStatus).toBe('CREATED');

      // 2. Auto-Assign Order to Agent 1
      const assignRes = await autoAssignSingleOrderHandler(
        createReq(`http://localhost:3000/api/orders/${order.id}/auto-assign`, 'POST', adminToken),
        { params: { id: order.id } }
      );
      expect(assignRes.status).toBe(200);
      const assignData = await assignRes.json();
      expect(assignData.success).toBe(true);
      expect(assignData.assignedAgent.id).toBe(agent1ProfileId);

      // Verify Agent 1 active count incremented
      let agent1 = await prisma.deliveryAgentProfile.findUnique({ where: { id: agent1ProfileId } });
      const initialActiveCount = agent1!.activeOrdersCount;
      expect(initialActiveCount).toBeGreaterThanOrEqual(1);

      // 3. Agent 1 progresses delivery: PICKED_UP
      const pickedUpRes = await transitionStatusHandler(
        createReq(`http://localhost:3000/api/orders/${order.id}/status`, 'POST', agent1Token, {
          status: 'PICKED_UP',
          notes: 'Package collected from sender hub',
        }),
        { params: { id: order.id } }
      );
      expect(pickedUpRes.status).toBe(200);

      // 4. Agent 1: IN_TRANSIT
      const inTransitRes = await transitionStatusHandler(
        createReq(`http://localhost:3000/api/orders/${order.id}/status`, 'POST', agent1Token, {
          status: 'IN_TRANSIT',
          notes: 'Moving through North sorting facility',
        }),
        { params: { id: order.id } }
      );
      expect(inTransitRes.status).toBe(200);

      // 5. Agent 1: OUT_FOR_DELIVERY
      const outForDelRes = await transitionStatusHandler(
        createReq(`http://localhost:3000/api/orders/${order.id}/status`, 'POST', agent1Token, {
          status: 'OUT_FOR_DELIVERY',
          notes: 'Driver on route to recipient',
        }),
        { params: { id: order.id } }
      );
      expect(outForDelRes.status).toBe(200);

      // 6. Delivery Attempt FAILS
      const failedRes = await transitionStatusHandler(
        createReq(`http://localhost:3000/api/orders/${order.id}/status`, 'POST', agent1Token, {
          status: 'FAILED',
          reason: 'Customer residence locked / phone unreachable',
          notes: 'Attempted delivery at 14:30 PM',
        }),
        { params: { id: order.id } }
      );
      expect(failedRes.status).toBe(200);

      // 7. Verify Agent 1 activeOrdersCount was automatically decremented upon failure!
      agent1 = await prisma.deliveryAgentProfile.findUnique({ where: { id: agent1ProfileId } });
      expect(agent1!.activeOrdersCount).toBe(initialActiveCount - 1);

      // 8. Customer Reschedules Delivery for Tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const rescheduleRes = await rescheduleOrderHandler(
        createReq(`http://localhost:3000/api/orders/${order.id}/reschedule`, 'POST', customerToken, {
          scheduledDate: tomorrow.toISOString(),
          reason: 'I will be home tomorrow afternoon',
        }),
        { params: { id: order.id } }
      );
      expect(rescheduleRes.status).toBe(200);
      const rescheduledOrder = await rescheduleRes.json();
      expect(rescheduledOrder.currentStatus).toBe('RESCHEDULED');

      // 9. Re-assign Order to Agent (Auto-Assign)
      const reassignRes = await autoAssignSingleOrderHandler(
        createReq(`http://localhost:3000/api/orders/${order.id}/auto-assign`, 'POST', adminToken),
        { params: { id: order.id } }
      );
      expect(reassignRes.status).toBe(200);
      const reassignData = await reassignRes.json();
      expect(reassignData.success).toBe(true);

      // 10. Agent progresses second delivery attempt: PICKED_UP -> IN_TRANSIT -> OUT_FOR_DELIVERY -> DELIVERED
      const pickedUp2Res = await transitionStatusHandler(
        createReq(`http://localhost:3000/api/orders/${order.id}/status`, 'POST', agent1Token, {
          status: 'PICKED_UP',
          notes: 'Second attempt - collected package',
        }),
        { params: { id: order.id } }
      );
      expect(pickedUp2Res.status).toBe(200);

      const inTransit2Res = await transitionStatusHandler(
        createReq(`http://localhost:3000/api/orders/${order.id}/status`, 'POST', agent1Token, {
          status: 'IN_TRANSIT',
          notes: 'Second attempt - in transit',
        }),
        { params: { id: order.id } }
      );
      expect(inTransit2Res.status).toBe(200);

      const out2Res = await transitionStatusHandler(
        createReq(`http://localhost:3000/api/orders/${order.id}/status`, 'POST', agent1Token, {
          status: 'OUT_FOR_DELIVERY',
          notes: 'Second attempt - out for delivery',
        }),
        { params: { id: order.id } }
      );
      expect(out2Res.status).toBe(200);

      const deliveredRes = await transitionStatusHandler(
        createReq(`http://localhost:3000/api/orders/${order.id}/status`, 'POST', agent1Token, {
          status: 'DELIVERED',
          notes: 'Handed over directly to customer',
        }),
        { params: { id: order.id } }
      );
      expect(deliveredRes.status).toBe(200);
      const finalOrder = await deliveredRes.json();
      expect(finalOrder.currentStatus).toBe('DELIVERED');
    });
  });

  describe('5. RBAC & Security Hardening Verification', () => {
    it('should return 401 Unauthorized for unauthenticated requests', async () => {
      const res = await listAgentsHandler(createReq('http://localhost:3000/api/agents', 'GET'));
      expect(res.status).toBe(401);
    });

    it('should return 403 Forbidden when Customer accesses Agent/Admin endpoints', async () => {
      // 1. GET /api/agents
      const res1 = await listAgentsHandler(
        createReq('http://localhost:3000/api/agents', 'GET', customerToken)
      );
      expect(res1.status).toBe(403);

      // 2. PUT /api/agents/:id/status
      const res2 = await updateAgentStatusHandler(
        createReq(
          `http://localhost:3000/api/agents/${agent1ProfileId}/status`,
          'PUT',
          customerToken,
          { status: 'AVAILABLE' }
        ),
        { params: { id: agent1ProfileId } }
      );
      expect(res2.status).toBe(403);

      // 3. PUT /api/agents/:id/zones
      const res3 = await updateAgentZonesHandler(
        createReq(
          `http://localhost:3000/api/agents/${agent1ProfileId}/zones`,
          'PUT',
          customerToken,
          { zoneIds: [zoneNorthId] }
        ),
        { params: { id: agent1ProfileId } }
      );
      expect(res3.status).toBe(403);

      // 4. POST /api/orders/:id/assign
      const res4 = await manualAssignOrderHandler(
        createReq(
          'http://localhost:3000/api/orders/dummy_id/assign',
          'POST',
          customerToken,
          { agentId: agent1ProfileId }
        ),
        { params: { id: 'dummy_id' } }
      );
      expect(res4.status).toBe(403);

      // 5. POST /api/orders/auto-assign
      const res5 = await autoAssignBatchHandler(
        createReq('http://localhost:3000/api/orders/auto-assign', 'POST', customerToken)
      );
      expect(res5.status).toBe(403);
    });

    it('should forbid an Agent from updating another Agent status or operational zones', async () => {
      // Agent 1 attempts to update Agent 2 status
      const res1 = await updateAgentStatusHandler(
        createReq(
          `http://localhost:3000/api/agents/${agent2ProfileId}/status`,
          'PUT',
          agent1Token,
          { status: 'OFFLINE' }
        ),
        { params: { id: agent2ProfileId } }
      );
      expect(res1.status).toBe(403);

      // Agent 1 attempts to update operational zones (Admin only)
      const res2 = await updateAgentZonesHandler(
        createReq(
          `http://localhost:3000/api/agents/${agent1ProfileId}/zones`,
          'PUT',
          agent1Token,
          { zoneIds: [zoneNorthId] }
        ),
        { params: { id: agent1ProfileId } }
      );
      expect(res2.status).toBe(403);
    });
  });
});
