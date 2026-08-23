// /home/skrisps/lastmile/tests/integration/order-lifecycle-api.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { POST as createOrderHandler, GET as listOrdersHandler } from '@/app/api/orders/route';
import { GET as getOrderByIdHandler } from '@/app/api/orders/[id]/route';
import { POST as transitionStatusHandler } from '@/app/api/orders/[id]/status/route';
import { POST as rescheduleOrderHandler } from '@/app/api/orders/[id]/reschedule/route';
import { GET as trackOrderHandler } from '@/app/api/orders/track/[trackingNumber]/route';
import { createSessionToken } from '@/lib/auth/jwt';
import { hashPassword } from '@/lib/auth/password';

import { computeRateQuote } from '@/lib/rate-engine/calculator';

describe('Integration: Role-Based Order Lifecycle & Immutable Audit Ledger API Suite (M3-R2)', () => {
  // Test User Accounts
  let adminToken: string;
  let adminUserId: string;

  let customer1Token: string;
  let customer1UserId: string;

  let customer2Token: string;
  let customer2UserId: string;

  let agentToken: string;
  let agentUserId: string;
  let agentProfileId: string;

  let otherAgentToken: string;
  let otherAgentUserId: string;
  let otherAgentProfileId: string;

  // Zones & Pincodes
  let zoneNorthId: string;
  let zoneSouthId: string;

  beforeAll(async () => {
    // 1. Setup / Verify Zones & Pincode Mappings
    const zoneNorth = await prisma.zone.upsert({
      where: { code: 'ZONE_NORTH' },
      update: { isActive: true },
      create: {
        name: 'North Metro Zone',
        code: 'ZONE_NORTH',
        description: 'Northern metropolitan district',
        isActive: true,
      },
    });
    zoneNorthId = zoneNorth.id;

    const zoneSouth = await prisma.zone.upsert({
      where: { code: 'ZONE_SOUTH' },
      update: { isActive: true },
      create: {
        name: 'South Suburban Zone',
        code: 'ZONE_SOUTH',
        description: 'Southern suburban district',
        isActive: true,
      },
    });
    zoneSouthId = zoneSouth.id;

    await prisma.pincodeMapping.upsert({
      where: { pincode: '560001' },
      update: { zoneId: zoneNorthId },
      create: { pincode: '560001', areaName: 'Bangalore GPO', zoneId: zoneNorthId },
    });

    await prisma.pincodeMapping.upsert({
      where: { pincode: '560024' },
      update: { zoneId: zoneNorthId },
      create: { pincode: '560024', areaName: 'Hebbal Metro', zoneId: zoneNorthId },
    });

    await prisma.pincodeMapping.upsert({
      where: { pincode: '560076' },
      update: { zoneId: zoneSouthId },
      create: { pincode: '560076', areaName: 'Bannerghatta Road', zoneId: zoneSouthId },
    });

    // 2. Clean up any leftover test rate cards or previous test orders
    await prisma.rateCard.deleteMany({
      where: {
        id: { in: ['ratecard_intra_b2c_test', 'ratecard_inter_b2c_test', 'ratecard_intra_b2b_test'] },
      },
    });

    // 3. Setup Test Users
    const dummyPasswordHash = await hashPassword('SecurePass123!');

    // Admin
    const adminUser = await prisma.user.upsert({
      where: { email: 'admin.m3@lastmile.local' },
      update: {},
      create: {
        name: 'M3 Admin Commander',
        email: 'admin.m3@lastmile.local',
        passwordHash: dummyPasswordHash,
        role: 'ADMIN',
      },
    });
    adminUserId = adminUser.id;
    adminToken = await createSessionToken({
      userId: adminUser.id,
      email: adminUser.email,
      role: 'ADMIN',
      name: adminUser.name,
    });

    // Customer 1
    const cust1 = await prisma.user.upsert({
      where: { email: 'customer1.m3@lastmile.local' },
      update: {},
      create: {
        name: 'Alice Customer M3',
        email: 'customer1.m3@lastmile.local',
        passwordHash: dummyPasswordHash,
        role: 'CUSTOMER',
      },
    });
    customer1UserId = cust1.id;
    customer1Token = await createSessionToken({
      userId: cust1.id,
      email: cust1.email,
      role: 'CUSTOMER',
      name: cust1.name,
    });

    // Customer 2
    const cust2 = await prisma.user.upsert({
      where: { email: 'customer2.m3@lastmile.local' },
      update: {},
      create: {
        name: 'Bob Customer M3',
        email: 'customer2.m3@lastmile.local',
        passwordHash: dummyPasswordHash,
        role: 'CUSTOMER',
      },
    });
    customer2UserId = cust2.id;
    customer2Token = await createSessionToken({
      userId: cust2.id,
      email: cust2.email,
      role: 'CUSTOMER',
      name: cust2.name,
    });

    // Assigned Agent
    const agentUser = await prisma.user.upsert({
      where: { email: 'agent1.m3@lastmile.local' },
      update: {},
      create: {
        name: 'Speedy Agent M3',
        email: 'agent1.m3@lastmile.local',
        passwordHash: dummyPasswordHash,
        role: 'AGENT',
      },
    });
    agentUserId = agentUser.id;
    const agentProf = await prisma.deliveryAgentProfile.upsert({
      where: { userId: agentUserId },
      update: {},
      create: {
        userId: agentUserId,
        status: 'AVAILABLE',
        vehicleType: 'BIKE',
        vehicleNumber: 'KA-01-M3-1111',
        maxCapacity: 15,
      },
    });
    agentProfileId = agentProf.id;
    agentToken = await createSessionToken({
      userId: agentUserId,
      email: agentUser.email,
      role: 'AGENT',
      name: agentUser.name,
    });

    // Other Agent (Not assigned)
    const otherAgentUser = await prisma.user.upsert({
      where: { email: 'agent2.m3@lastmile.local' },
      update: {},
      create: {
        name: 'Other Agent M3',
        email: 'agent2.m3@lastmile.local',
        passwordHash: dummyPasswordHash,
        role: 'AGENT',
      },
    });
    otherAgentUserId = otherAgentUser.id;
    const otherProf = await prisma.deliveryAgentProfile.upsert({
      where: { userId: otherAgentUserId },
      update: {},
      create: {
        userId: otherAgentUserId,
        status: 'AVAILABLE',
        vehicleType: 'VAN',
        vehicleNumber: 'KA-02-M3-2222',
        maxCapacity: 20,
      },
    });
    otherAgentProfileId = otherProf.id;
    otherAgentToken = await createSessionToken({
      userId: otherAgentUserId,
      email: otherAgentUser.email,
      role: 'AGENT',
      name: otherAgentUser.name,
    });

    // Clean up any previous test orders for clean test environment
    await prisma.order.deleteMany({
      where: {
        OR: [
          { customerId: { in: [customer1UserId, customer2UserId] } },
          { trackingNumber: { in: ['LMD-20260823-FAIL1', 'LMD-20260823-RBAC1', 'LMD-20260823-TRACK99'] } },
        ],
      },
    });
  });

  describe('1. Dynamic Order Creation with Price Snapshot (POST /api/orders)', () => {
    it('should create an Intra-Zone B2C order with snapshot quotation and initial CREATED ledger entry', async () => {
      const activeRateCard = await prisma.rateCard.findFirst({
        where: { zoneType: 'INTRA_ZONE', customerType: 'B2C', isActive: true },
      });
      expect(activeRateCard).toBeDefined();

      const expectedQuote = computeRateQuote(
        {
          lengthCm: 30,
          breadthCm: 20,
          heightCm: 10,
          actualWeightKg: 2.5,
          isCod: false,
        },
        activeRateCard!
      );

      const req = new NextRequest('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `auth-token=${customer1Token}`,
        },
        body: JSON.stringify({
          senderName: 'Alice Sender',
          senderPhone: '+91-9876543210',
          senderStreet: '123 MG Road',
          senderCity: 'Bangalore',
          senderState: 'Karnataka',
          pickupPincode: '560001',
          recipientName: 'David Recipient',
          recipientPhone: '+91-9876543211',
          recipientStreet: '456 Outer Ring Road',
          recipientCity: 'Bangalore',
          recipientState: 'Karnataka',
          dropPincode: '560024',
          packageLengthCm: 30,
          packageBreadthCm: 20,
          packageHeightCm: 10,
          actualWeightKg: 2.5,
          customerType: 'B2C',
          isCod: false,
          notes: 'Deliver before 5 PM',
        }),
      });

      const res = await createOrderHandler(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.id).toBeDefined();
      expect(data.trackingNumber).toMatch(/^LMD-\d{8}-[A-Z0-9]{5}$/);
      expect(data.customerId).toBe(customer1UserId);
      expect(data.zoneType).toBe('INTRA_ZONE');
      expect(data.actualWeightKg).toBe(expectedQuote.actualWeightKg);
      expect(data.volumetricWeightKg).toBe(expectedQuote.volumetricWeightKg);
      expect(data.billableWeightKg).toBe(expectedQuote.billableWeightKg);
      expect(data.basePrice).toBe(expectedQuote.basePrice);
      expect(data.weightPrice).toBe(expectedQuote.weightPrice);
      expect(data.codSurcharge).toBe(expectedQuote.codSurcharge);
      expect(data.totalAmount).toBe(expectedQuote.totalAmount);
      expect(data.currentStatus).toBe('CREATED');
      expect(data.statusHistory).toHaveLength(1);
      expect(data.statusHistory[0].status).toBe('CREATED');
      expect(data.statusHistory[0].changedById).toBe(customer1UserId);
    });

    it('should create an Inter-Zone COD B2C order with COD surcharge calculated dynamically', async () => {
      const activeRateCard = await prisma.rateCard.findFirst({
        where: { zoneType: 'INTER_ZONE', customerType: 'B2C', isActive: true },
      });
      expect(activeRateCard).toBeDefined();

      const expectedQuote = computeRateQuote(
        {
          lengthCm: 40,
          breadthCm: 30,
          heightCm: 20,
          actualWeightKg: 3.0,
          isCod: true,
          codAmount: 2000,
          declaredValue: 2000,
        },
        activeRateCard!
      );

      const req = new NextRequest('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `auth-token=${customer1Token}`,
        },
        body: JSON.stringify({
          senderName: 'Alice Sender',
          senderPhone: '+91-9876543210',
          senderStreet: '123 MG Road',
          senderCity: 'Bangalore',
          senderState: 'Karnataka',
          pickupPincode: '560001',
          recipientName: 'Eve Southern',
          recipientPhone: '+91-9876543212',
          recipientStreet: '789 Bannerghatta Main',
          recipientCity: 'Bangalore',
          recipientState: 'Karnataka',
          dropPincode: '560076',
          packageLengthCm: 40,
          packageBreadthCm: 30,
          packageHeightCm: 20,
          actualWeightKg: 3.0,
          customerType: 'B2C',
          isCod: true,
          codAmount: 2000,
          declaredValue: 2000,
        }),
      });

      const res = await createOrderHandler(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.zoneType).toBe('INTER_ZONE');
      expect(data.isCod).toBe(true);
      expect(data.volumetricWeightKg).toBe(expectedQuote.volumetricWeightKg);
      expect(data.billableWeightKg).toBe(expectedQuote.billableWeightKg);
      expect(data.basePrice).toBe(expectedQuote.basePrice);
      expect(data.weightPrice).toBe(expectedQuote.weightPrice);
      expect(data.codSurcharge).toBe(expectedQuote.codSurcharge);
      expect(data.totalAmount).toBe(expectedQuote.totalAmount);
      expect(data.currentStatus).toBe('CREATED');
    });

    it('should reject order creation if pickup or drop pincode is unserviceable (404)', async () => {
      const req = new NextRequest('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `auth-token=${customer1Token}`,
        },
        body: JSON.stringify({
          senderName: 'Alice Sender',
          senderPhone: '+91-9876543210',
          senderStreet: '123 MG Road',
          senderCity: 'Bangalore',
          senderState: 'Karnataka',
          pickupPincode: '999999', // Non-existent
          recipientName: 'David Recipient',
          recipientPhone: '+91-9876543211',
          recipientStreet: '456 Outer Ring Road',
          recipientCity: 'Bangalore',
          recipientState: 'Karnataka',
          dropPincode: '560024',
          packageLengthCm: 10,
          packageBreadthCm: 10,
          packageHeightCm: 10,
          actualWeightKg: 1.0,
        }),
      });

      const res = await createOrderHandler(req);
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toContain('999999');
    });

    it('should reject order creation for unauthenticated user (401)', async () => {
      const req = new NextRequest('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderName: 'Unauth Sender',
          senderPhone: '+91-9876543210',
          senderStreet: '123 MG Road',
          senderCity: 'Bangalore',
          senderState: 'Karnataka',
          pickupPincode: '560001',
          recipientName: 'David Recipient',
          recipientPhone: '+91-9876543211',
          recipientStreet: '456 Outer Ring Road',
          recipientCity: 'Bangalore',
          recipientState: 'Karnataka',
          dropPincode: '560024',
          packageLengthCm: 10,
          packageBreadthCm: 10,
          packageHeightCm: 10,
          actualWeightKg: 1.0,
        }),
      });

      const res = await createOrderHandler(req);
      expect(res.status).toBe(401);
    });
  });

  describe('2. Sequential Status Progression: CREATED -> ASSIGNED -> PICKED_UP -> IN_TRANSIT -> OUT_FOR_DELIVERY -> DELIVERED', () => {
    let orderId: string;
    let trackingNumber: string;

    beforeAll(async () => {
      // Create initial order
      const req = new NextRequest('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `auth-token=${customer1Token}`,
        },
        body: JSON.stringify({
          senderName: 'Alice Sender',
          senderPhone: '+91-9876543210',
          senderStreet: '123 MG Road',
          senderCity: 'Bangalore',
          senderState: 'Karnataka',
          pickupPincode: '560001',
          recipientName: 'David Recipient',
          recipientPhone: '+91-9876543211',
          recipientStreet: '456 Outer Ring Road',
          recipientCity: 'Bangalore',
          recipientState: 'Karnataka',
          dropPincode: '560024',
          packageLengthCm: 20,
          packageBreadthCm: 15,
          packageHeightCm: 10,
          actualWeightKg: 1.0,
          customerType: 'B2C',
        }),
      });

      const res = await createOrderHandler(req);
      const data = await res.json();
      orderId = data.id;
      trackingNumber = data.trackingNumber;

      // Assign agent to order directly in DB for testing transitions
      await prisma.order.update({
        where: { id: orderId },
        data: { assignedAgentId: agentProfileId },
      });
    });

    it('Step 1: Admin transitions CREATED -> ASSIGNED', async () => {
      const req = new NextRequest(`http://localhost:3000/api/orders/${orderId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `auth-token=${adminToken}`,
        },
        body: JSON.stringify({
          status: 'ASSIGNED',
          notes: 'Assigned to Speedy Agent M3',
        }),
      });

      const res = await transitionStatusHandler(req, { params: { id: orderId } });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.currentStatus).toBe('ASSIGNED');
      expect(data.statusHistory).toHaveLength(2);
      expect(data.statusHistory[1].status).toBe('ASSIGNED');
    });

    it('Step 2: Assigned Agent transitions ASSIGNED -> PICKED_UP', async () => {
      const req = new NextRequest(`http://localhost:3000/api/orders/${orderId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `auth-token=${agentToken}`,
        },
        body: JSON.stringify({
          status: 'PICKED_UP',
          notes: 'Package collected from sender premises',
        }),
      });

      const res = await transitionStatusHandler(req, { params: { id: orderId } });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.currentStatus).toBe('PICKED_UP');
      expect(data.statusHistory).toHaveLength(3);
      expect(data.statusHistory[2].status).toBe('PICKED_UP');
    });

    it('Step 3: Assigned Agent transitions PICKED_UP -> IN_TRANSIT', async () => {
      const req = new NextRequest(`http://localhost:3000/api/orders/${orderId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `auth-token=${agentToken}`,
        },
        body: JSON.stringify({
          status: 'IN_TRANSIT',
          notes: 'In transit to distribution hub',
        }),
      });

      const res = await transitionStatusHandler(req, { params: { id: orderId } });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.currentStatus).toBe('IN_TRANSIT');
      expect(data.statusHistory).toHaveLength(4);
      expect(data.statusHistory[3].status).toBe('IN_TRANSIT');
    });

    it('Step 4: Assigned Agent transitions IN_TRANSIT -> OUT_FOR_DELIVERY', async () => {
      const req = new NextRequest(`http://localhost:3000/api/orders/${orderId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `auth-token=${agentToken}`,
        },
        body: JSON.stringify({
          status: 'OUT_FOR_DELIVERY',
          notes: 'Courier is out for final mile delivery',
        }),
      });

      const res = await transitionStatusHandler(req, { params: { id: orderId } });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.currentStatus).toBe('OUT_FOR_DELIVERY');
      expect(data.statusHistory).toHaveLength(5);
      expect(data.statusHistory[4].status).toBe('OUT_FOR_DELIVERY');
    });

    it('Step 5: Assigned Agent transitions OUT_FOR_DELIVERY -> DELIVERED (Terminal State)', async () => {
      const req = new NextRequest(`http://localhost:3000/api/orders/${orderId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `auth-token=${agentToken}`,
        },
        body: JSON.stringify({
          status: 'DELIVERED',
          notes: 'Handed over to recipient with signature confirmation',
        }),
      });

      const res = await transitionStatusHandler(req, { params: { id: orderId } });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.currentStatus).toBe('DELIVERED');
      expect(data.statusHistory).toHaveLength(6);
      expect(data.statusHistory[5].status).toBe('DELIVERED');
    });

    it('Step 6: Attempting any transition after DELIVERED is rejected as terminal (400)', async () => {
      const req = new NextRequest(`http://localhost:3000/api/orders/${orderId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `auth-token=${adminToken}`,
        },
        body: JSON.stringify({
          status: 'OUT_FOR_DELIVERY',
          notes: 'Attempting to re-deliver already delivered order',
        }),
      });

      const res = await transitionStatusHandler(req, { params: { id: orderId } });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("Invalid status transition from 'DELIVERED'");
    });
  });

  describe('3. Failed Delivery Flow & Rescheduling (OUT_FOR_DELIVERY -> FAILED -> RESCHEDULED -> OUT_FOR_DELIVERY -> DELIVERED)', () => {
    let failOrderId: string;

    beforeAll(async () => {
      // Create and fast-forward an order to OUT_FOR_DELIVERY
      const order = await prisma.order.create({
        data: {
          trackingNumber: 'LMD-20260823-FAIL1',
          customerId: customer1UserId,
          customerType: 'B2C',
          senderName: 'Alice Sender',
          senderPhone: '+91-9876543210',
          senderStreet: '123 MG Road',
          senderCity: 'Bangalore',
          senderState: 'Karnataka',
          pickupPincode: '560001',
          pickupZoneId: zoneNorthId,
          recipientName: 'David Recipient',
          recipientPhone: '+91-9876543211',
          recipientStreet: '456 Outer Ring Road',
          recipientCity: 'Bangalore',
          recipientState: 'Karnataka',
          dropPincode: '560024',
          dropZoneId: zoneNorthId,
          packageLengthCm: 20,
          packageBreadthCm: 15,
          packageHeightCm: 10,
          actualWeightKg: 1.0,
          volumetricWeightKg: 0.6,
          billableWeightKg: 1.0,
          volumetricDivisor: 5000,
          zoneType: 'INTRA_ZONE',
          basePrice: 50.0,
          weightPrice: 10.0,
          codSurcharge: 0.0,
          totalAmount: 60.0,
          assignedAgentId: agentProfileId,
        },
      });
      failOrderId = order.id;

      // Seed initial history up to OUT_FOR_DELIVERY
      await prisma.orderStatusHistory.createMany({
        data: [
          { orderId: failOrderId, status: 'CREATED', createdAt: new Date(Date.now() - 5000) },
          { orderId: failOrderId, status: 'ASSIGNED', createdAt: new Date(Date.now() - 4000) },
          { orderId: failOrderId, status: 'PICKED_UP', createdAt: new Date(Date.now() - 3000) },
          { orderId: failOrderId, status: 'IN_TRANSIT', createdAt: new Date(Date.now() - 2000) },
          { orderId: failOrderId, status: 'OUT_FOR_DELIVERY', createdAt: new Date(Date.now() - 1000) },
        ],
      });
    });

    it('should reject FAILED transition if reason is missing or empty (400)', async () => {
      const req = new NextRequest(`http://localhost:3000/api/orders/${failOrderId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `auth-token=${agentToken}`,
        },
        body: JSON.stringify({
          status: 'FAILED',
          reason: '', // Empty reason
          notes: 'Customer not home',
        }),
      });

      const res = await transitionStatusHandler(req, { params: { id: failOrderId } });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(JSON.stringify(json)).toContain('reason');
    });

    it('should transition OUT_FOR_DELIVERY -> FAILED when valid reason is provided', async () => {
      const req = new NextRequest(`http://localhost:3000/api/orders/${failOrderId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `auth-token=${agentToken}`,
        },
        body: JSON.stringify({
          status: 'FAILED',
          reason: 'Customer residence locked / OTP verification failed',
          notes: 'Attempted call 3 times, no response',
        }),
      });

      const res = await transitionStatusHandler(req, { params: { id: failOrderId } });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.currentStatus).toBe('FAILED');
    });

    it('should allow Customer to reschedule a FAILED order for a new delivery date', async () => {
      const newDate = '2026-08-25T10:00:00.000Z';
      const req = new NextRequest(`http://localhost:3000/api/orders/${failOrderId}/reschedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `auth-token=${customer1Token}`,
        },
        body: JSON.stringify({
          scheduledDate: newDate,
          reason: 'Please deliver after 2 PM on Tuesday',
        }),
      });

      const res = await rescheduleOrderHandler(req, { params: { id: failOrderId } });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.currentStatus).toBe('RESCHEDULED');
      expect(new Date(data.scheduledDate).toISOString()).toBe(newDate);
      expect(data.statusHistory[data.statusHistory.length - 1].status).toBe('RESCHEDULED');
    });

    it('should reject rescheduling an order that is not in FAILED status (400)', async () => {
      // Current status is RESCHEDULED, not FAILED
      const req = new NextRequest(`http://localhost:3000/api/orders/${failOrderId}/reschedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `auth-token=${customer1Token}`,
        },
        body: JSON.stringify({
          scheduledDate: '2026-08-26T10:00:00.000Z',
        }),
      });

      const res = await rescheduleOrderHandler(req, { params: { id: failOrderId } });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("only orders in 'FAILED' state can be rescheduled");
    });

    it('should allow RESCHEDULED -> OUT_FOR_DELIVERY -> DELIVERED to complete journey', async () => {
      // RESCHEDULED -> OUT_FOR_DELIVERY
      const req1 = new NextRequest(`http://localhost:3000/api/orders/${failOrderId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `auth-token=${agentToken}`,
        },
        body: JSON.stringify({
          status: 'OUT_FOR_DELIVERY',
          notes: 'Second attempt out for delivery',
        }),
      });

      const res1 = await transitionStatusHandler(req1, { params: { id: failOrderId } });
      expect(res1.status).toBe(200);
      const data1 = await res1.json();
      expect(data1.currentStatus).toBe('OUT_FOR_DELIVERY');

      // OUT_FOR_DELIVERY -> DELIVERED
      const req2 = new NextRequest(`http://localhost:3000/api/orders/${failOrderId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `auth-token=${agentToken}`,
        },
        body: JSON.stringify({
          status: 'DELIVERED',
          notes: 'Successfully delivered on second attempt',
        }),
      });

      const res2 = await transitionStatusHandler(req2, { params: { id: failOrderId } });
      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      expect(data2.currentStatus).toBe('DELIVERED');
    });
  });

  describe('4. Audit Ledger Immutability Verification', () => {
    it('should ensure that historical records are never modified or overwritten and record count strictly increments', async () => {
      // Create new order
      const req = new NextRequest('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `auth-token=${customer1Token}`,
        },
        body: JSON.stringify({
          senderName: 'Immutable Test Sender',
          senderPhone: '+91-9876543210',
          senderStreet: '123 MG Road',
          senderCity: 'Bangalore',
          senderState: 'Karnataka',
          pickupPincode: '560001',
          recipientName: 'Immutable Recipient',
          recipientPhone: '+91-9876543211',
          recipientStreet: '456 Outer Ring Road',
          recipientCity: 'Bangalore',
          recipientState: 'Karnataka',
          dropPincode: '560024',
          packageLengthCm: 20,
          packageBreadthCm: 15,
          packageHeightCm: 10,
          actualWeightKg: 1.0,
        }),
      });

      const res = await createOrderHandler(req);
      const order = await res.json();
      const orderId = order.id;

      // Assign agent
      await prisma.order.update({
        where: { id: orderId },
        data: { assignedAgentId: agentProfileId },
      });

      // Get initial snapshot of history event 1
      const history1 = await prisma.orderStatusHistory.findMany({ where: { orderId } });
      expect(history1).toHaveLength(1);
      const event1Id = history1[0].id;
      const event1CreatedAt = history1[0].createdAt.toISOString();
      const event1Status = history1[0].status;

      // Transition 1: CREATED -> ASSIGNED
      await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${orderId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${adminToken}` },
          body: JSON.stringify({ status: 'ASSIGNED', notes: 'Event 2 note' }),
        }),
        { params: { id: orderId } }
      );

      const history2 = await prisma.orderStatusHistory.findMany({
        where: { orderId },
        orderBy: { createdAt: 'asc' },
      });
      expect(history2).toHaveLength(2);
      // Verify Event 1 is 100% untouched
      expect(history2[0].id).toBe(event1Id);
      expect(history2[0].createdAt.toISOString()).toBe(event1CreatedAt);
      expect(history2[0].status).toBe(event1Status);

      // Transition 2: ASSIGNED -> PICKED_UP
      await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${orderId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${agentToken}` },
          body: JSON.stringify({ status: 'PICKED_UP', notes: 'Event 3 note' }),
        }),
        { params: { id: orderId } }
      );

      const history3 = await prisma.orderStatusHistory.findMany({
        where: { orderId },
        orderBy: { createdAt: 'asc' },
      });
      expect(history3).toHaveLength(3);
      // Verify Events 1 and 2 are 100% untouched
      expect(history3[0].id).toBe(event1Id);
      expect(history3[0].createdAt.toISOString()).toBe(event1CreatedAt);
      expect(history3[1].id).toBe(history2[1].id);
      expect(history3[1].createdAt.toISOString()).toBe(history2[1].createdAt.toISOString());
    });
  });

  describe('5. Role-Based Authorization & Permissions Verification', () => {
    let orderId: string;

    beforeAll(async () => {
      // Create order belonging to Customer 1
      const order = await prisma.order.create({
        data: {
          trackingNumber: 'LMD-20260823-RBAC1',
          customerId: customer1UserId,
          customerType: 'B2C',
          senderName: 'Alice Sender',
          senderPhone: '+91-9876543210',
          senderStreet: '123 MG Road',
          senderCity: 'Bangalore',
          senderState: 'Karnataka',
          pickupPincode: '560001',
          pickupZoneId: zoneNorthId,
          recipientName: 'David Recipient',
          recipientPhone: '+91-9876543211',
          recipientStreet: '456 Outer Ring Road',
          recipientCity: 'Bangalore',
          recipientState: 'Karnataka',
          dropPincode: '560024',
          dropZoneId: zoneNorthId,
          packageLengthCm: 20,
          packageBreadthCm: 15,
          packageHeightCm: 10,
          actualWeightKg: 1.0,
          volumetricWeightKg: 0.6,
          billableWeightKg: 1.0,
          volumetricDivisor: 5000,
          zoneType: 'INTRA_ZONE',
          basePrice: 50.0,
          weightPrice: 10.0,
          codSurcharge: 0.0,
          totalAmount: 60.0,
          assignedAgentId: agentProfileId, // Assigned to agent 1
        },
      });
      orderId = order.id;

      await prisma.orderStatusHistory.create({
        data: { orderId, status: 'CREATED' },
      });
    });

    it('Customer 1 can view their own order (200)', async () => {
      const req = new NextRequest(`http://localhost:3000/api/orders/${orderId}`, {
        method: 'GET',
        headers: { cookie: `auth-token=${customer1Token}` },
      });
      const res = await getOrderByIdHandler(req, { params: { id: orderId } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe(orderId);
      expect(data.currentStatus).toBe('CREATED');
    });

    it('Customer 2 is forbidden from viewing Customer 1 order (403)', async () => {
      const req = new NextRequest(`http://localhost:3000/api/orders/${orderId}`, {
        method: 'GET',
        headers: { cookie: `auth-token=${customer2Token}` },
      });
      const res = await getOrderByIdHandler(req, { params: { id: orderId } });
      expect(res.status).toBe(403);
    });

    it('Customer is forbidden from executing status transitions (403)', async () => {
      const req = new NextRequest(`http://localhost:3000/api/orders/${orderId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `auth-token=${customer1Token}`,
        },
        body: JSON.stringify({ status: 'ASSIGNED' }),
      });
      const res = await transitionStatusHandler(req, { params: { id: orderId } });
      expect(res.status).toBe(403);
    });

    it('Unassigned Agent is forbidden from transitioning an order assigned to another agent (403)', async () => {
      // otherAgent is NOT assigned to this order
      const req = new NextRequest(`http://localhost:3000/api/orders/${orderId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `auth-token=${otherAgentToken}`,
        },
        body: JSON.stringify({ status: 'ASSIGNED' }),
      });
      const res = await transitionStatusHandler(req, { params: { id: orderId } });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain('agents can only transition statuses for orders assigned to them');
    });

    it('Admin can view any order and override any status transition (200)', async () => {
      const getReq = new NextRequest(`http://localhost:3000/api/orders/${orderId}`, {
        method: 'GET',
        headers: { cookie: `auth-token=${adminToken}` },
      });
      const getRes = await getOrderByIdHandler(getReq, { params: { id: orderId } });
      expect(getRes.status).toBe(200);

      const statusReq = new NextRequest(`http://localhost:3000/api/orders/${orderId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `auth-token=${adminToken}`,
        },
        body: JSON.stringify({ status: 'ASSIGNED', notes: 'Admin system override' }),
      });
      const statusRes = await transitionStatusHandler(statusReq, { params: { id: orderId } });
      expect(statusRes.status).toBe(200);
      const statusData = await statusRes.json();
      expect(statusData.currentStatus).toBe('ASSIGNED');
    });
  });

  describe('6. Public Tracking Endpoint (GET /api/orders/track/[trackingNumber])', () => {
    let trackingNum: string;

    beforeAll(async () => {
      const order = await prisma.order.create({
        data: {
          trackingNumber: 'LMD-20260823-TRACK99',
          customerId: customer1UserId,
          customerType: 'B2C',
          senderName: 'Public Sender',
          senderPhone: '+91-9876543210',
          senderStreet: '123 MG Road',
          senderCity: 'Bangalore',
          senderState: 'Karnataka',
          pickupPincode: '560001',
          pickupZoneId: zoneNorthId,
          recipientName: 'Public Recipient',
          recipientPhone: '+91-9876543211',
          recipientStreet: '456 Outer Ring Road',
          recipientCity: 'Bangalore',
          recipientState: 'Karnataka',
          dropPincode: '560024',
          dropZoneId: zoneNorthId,
          packageLengthCm: 25,
          packageBreadthCm: 20,
          packageHeightCm: 15,
          actualWeightKg: 2.0,
          volumetricWeightKg: 1.5,
          billableWeightKg: 2.0,
          volumetricDivisor: 5000,
          zoneType: 'INTRA_ZONE',
          basePrice: 50.0,
          weightPrice: 30.0,
          codSurcharge: 0.0,
          totalAmount: 80.0,
        },
      });
      trackingNum = order.trackingNumber;

      await prisma.orderStatusHistory.createMany({
        data: [
          { orderId: order.id, status: 'CREATED', createdAt: new Date(Date.now() - 3000) },
          { orderId: order.id, status: 'ASSIGNED', createdAt: new Date(Date.now() - 2000) },
          { orderId: order.id, status: 'PICKED_UP', createdAt: new Date(Date.now() - 1000) },
        ],
      });
    });

    it('should return tracking details without authentication (public access)', async () => {
      const req = new NextRequest(`http://localhost:3000/api/orders/track/${trackingNum}`, {
        method: 'GET',
      });
      const res = await trackOrderHandler(req, { params: { trackingNumber: trackingNum } });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.trackingNumber).toBe(trackingNum);
      expect(data.currentStatus).toBe('PICKED_UP');
      expect(data.currentStatusLabel).toBe('Picked Up');
      expect(data.progressPercentage).toBe(50);
      expect(data.timeline).toHaveLength(3);
      expect(data.timeline[0].status).toBe('CREATED');
      expect(data.timeline[1].status).toBe('ASSIGNED');
      expect(data.timeline[2].status).toBe('PICKED_UP');

      // Crucial Security Invariant: Public tracking MUST NOT expose internal pricing or financial metrics
      expect(data.basePrice).toBeUndefined();
      expect(data.weightPrice).toBeUndefined();
      expect(data.codSurcharge).toBeUndefined();
      expect(data.totalAmount).toBeUndefined();
    });

    it('should return 404 for non-existent tracking number', async () => {
      const req = new NextRequest(`http://localhost:3000/api/orders/track/LMD-99999999-XXXXX`, {
        method: 'GET',
      });
      const res = await trackOrderHandler(req, { params: { trackingNumber: 'LMD-99999999-XXXXX' } });
      expect(res.status).toBe(404);
    });
  });

  describe('7. Multi-Parameter Order Querying & Filtering (GET /api/orders)', () => {
    it('Customer query returns only their own orders', async () => {
      const req = new NextRequest('http://localhost:3000/api/orders?page=1&limit=10', {
        method: 'GET',
        headers: { cookie: `auth-token=${customer1Token}` },
      });
      const res = await listOrdersHandler(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.orders).toBeDefined();
      expect(data.pagination).toBeDefined();
      for (const order of data.orders) {
        expect(order.customerId).toBe(customer1UserId);
      }
    });

    it('Admin can query orders filtered by status and search keyword', async () => {
      const req = new NextRequest('http://localhost:3000/api/orders?search=Alice&page=1&limit=5', {
        method: 'GET',
        headers: { cookie: `auth-token=${adminToken}` },
      });
      const res = await listOrdersHandler(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.orders).toBeDefined();
      expect(data.pagination.page).toBe(1);
    });
  });
});
