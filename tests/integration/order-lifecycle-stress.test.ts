// /home/skrisps/lastmile/tests/integration/order-lifecycle-stress.test.ts

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

describe('Adversarial Stress Suite: Order Lifecycle, Concurrency, Security & Edge Cases (M3)', () => {
  let adminToken: string;
  let customerToken: string;
  let agentToken: string;
  let customerUserId: string;
  let agentProfileId: string;
  let zoneNorthId: string;
  let zoneSouthId: string;

  beforeAll(async () => {
    // 1. Fetch / ensure zones
    const zoneNorth = await prisma.zone.findFirst({ where: { code: 'ZONE_NORTH' } });
    const zoneSouth = await prisma.zone.findFirst({ where: { code: 'ZONE_SOUTH' } });
    zoneNorthId = zoneNorth!.id;
    zoneSouthId = zoneSouth!.id;

    // 2. Setup test users
    const dummyPasswordHash = await hashPassword('SecurePass123!');
    const cust = await prisma.user.upsert({
      where: { email: 'm3lifecycle_cust@lastmile.local' },
      update: {},
      create: {
        name: 'Stress Customer M3',
        email: 'm3lifecycle_cust@lastmile.local',
        passwordHash: dummyPasswordHash,
        role: 'CUSTOMER',
      },
    });
    customerUserId = cust.id;
    customerToken = await createSessionToken({
      userId: cust.id,
      email: cust.email,
      role: 'CUSTOMER',
      name: cust.name,
    });

    const admin = await prisma.user.upsert({
      where: { email: 'm3lifecycle_admin@lastmile.local' },
      update: {},
      create: {
        name: 'Stress Admin M3',
        email: 'm3lifecycle_admin@lastmile.local',
        passwordHash: dummyPasswordHash,
        role: 'ADMIN',
      },
    });
    adminToken = await createSessionToken({
      userId: admin.id,
      email: admin.email,
      role: 'ADMIN',
      name: admin.name,
    });

    const agentUser = await prisma.user.upsert({
      where: { email: 'm3lifecycle_agent@lastmile.local' },
      update: {},
      create: {
        name: 'Stress Agent M3',
        email: 'm3lifecycle_agent@lastmile.local',
        passwordHash: dummyPasswordHash,
        role: 'AGENT',
      },
    });
    const agentProf = await prisma.deliveryAgentProfile.upsert({
      where: { userId: agentUser.id },
      update: {},
      create: {
        userId: agentUser.id,
        status: 'AVAILABLE',
        vehicleType: 'TRUCK',
        vehicleNumber: 'KA-03-STRESS',
        maxCapacity: 50,
      },
    });
    agentProfileId = agentProf.id;
    agentToken = await createSessionToken({
      userId: agentUser.id,
      email: agentUser.email,
      role: 'AGENT',
      name: agentUser.name,
    });

    // Cleanup stress test orders
    await prisma.order.deleteMany({
      where: {
        OR: [
          { customerId: customerUserId },
          { trackingNumber: { in: ['LMD-20260823-STRESS-CANC1', 'LMD-20260823-MULTI-FAIL'] } },
        ],
      },
    });
  });

  afterAll(async () => {
    await prisma.order.deleteMany({
      where: {
        OR: [
          { customerId: customerUserId },
          { trackingNumber: { in: ['LMD-20260823-STRESS-CANC1', 'LMD-20260823-MULTI-FAIL'] } },
        ],
      },
    });
  });

  describe('1. Order Cancellation Paths & Terminal State Enforcement', () => {
    it('should allow cancellation from CREATED status', async () => {
      const createRes = await createOrderHandler(
        new NextRequest('http://localhost:3000/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${customerToken}` },
          body: JSON.stringify({
            senderName: 'Sender Test',
            senderPhone: '+91-9876543210',
            senderStreet: '123 Main',
            senderCity: 'Bangalore',
            senderState: 'Karnataka',
            pickupPincode: '560001',
            recipientName: 'Recipient Test',
            recipientPhone: '+91-9876543211',
            recipientStreet: '456 Side',
            recipientCity: 'Bangalore',
            recipientState: 'Karnataka',
            dropPincode: '560024',
            packageLengthCm: 10,
            packageBreadthCm: 10,
            packageHeightCm: 10,
            actualWeightKg: 1.0,
          }),
        })
      );
      const order = await createRes.json();

      const cancelRes = await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${order.id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${adminToken}` },
          body: JSON.stringify({ status: 'CANCELLED', reason: 'Customer requested cancellation before dispatch' }),
        }),
        { params: { id: order.id } }
      );
      expect(cancelRes.status).toBe(200);
      const data = await cancelRes.json();
      expect(data.currentStatus).toBe('CANCELLED');

      // Subsequent transition from CANCELLED must fail
      const nextRes = await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${order.id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${adminToken}` },
          body: JSON.stringify({ status: 'ASSIGNED' }),
        }),
        { params: { id: order.id } }
      );
      expect(nextRes.status).toBe(400);
    });

    it('should allow cancellation from FAILED status and reject further actions', async () => {
      const order = await prisma.order.create({
        data: {
          trackingNumber: 'LMD-20260823-STRESS-CANC1',
          customerId: customerUserId,
          customerType: 'B2C',
          senderName: 'Sender Test',
          senderPhone: '+91-9876543210',
          senderStreet: '123 Main',
          senderCity: 'Bangalore',
          senderState: 'Karnataka',
          pickupPincode: '560001',
          pickupZoneId: zoneNorthId,
          recipientName: 'Recipient Test',
          recipientPhone: '+91-9876543211',
          recipientStreet: '456 Side',
          recipientCity: 'Bangalore',
          recipientState: 'Karnataka',
          dropPincode: '560024',
          dropZoneId: zoneNorthId,
          packageLengthCm: 10,
          packageBreadthCm: 10,
          packageHeightCm: 10,
          actualWeightKg: 1.0,
          volumetricWeightKg: 0.2,
          billableWeightKg: 1.0,
          volumetricDivisor: 5000,
          zoneType: 'INTRA_ZONE',
          basePrice: 40.0,
          weightPrice: 10.0,
          codSurcharge: 0.0,
          totalAmount: 50.0,
          assignedAgentId: agentProfileId,
        },
      });

      await prisma.orderStatusHistory.createMany({
        data: [
          { orderId: order.id, status: 'CREATED', createdAt: new Date(Date.now() - 4000) },
          { orderId: order.id, status: 'ASSIGNED', createdAt: new Date(Date.now() - 3000) },
          { orderId: order.id, status: 'PICKED_UP', createdAt: new Date(Date.now() - 2000) },
          { orderId: order.id, status: 'FAILED', reason: 'Receiver refused parcel', createdAt: new Date(Date.now() - 1000) },
        ],
      });

      const cancelRes = await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${order.id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${adminToken}` },
          body: JSON.stringify({ status: 'CANCELLED', reason: 'Returned to merchant / cancelled' }),
        }),
        { params: { id: order.id } }
      );
      expect(cancelRes.status).toBe(200);
      const data = await cancelRes.json();
      expect(data.currentStatus).toBe('CANCELLED');

      // Attempting to reschedule cancelled order must fail
      const reschedRes = await rescheduleOrderHandler(
        new NextRequest(`http://localhost:3000/api/orders/${order.id}/reschedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${customerToken}` },
          body: JSON.stringify({ scheduledDate: '2026-08-30' }),
        }),
        { params: { id: order.id } }
      );
      expect(reschedRes.status).toBe(400);
    });
  });

  describe('2. Repeated Multi-Cycle Failure and Rescheduling Journey', () => {
    it('should support multi-attempt failure -> reschedule -> failure -> reschedule -> delivered cycle preserving full history', async () => {
      const order = await prisma.order.create({
        data: {
          trackingNumber: 'LMD-20260823-MULTI-FAIL',
          customerId: customerUserId,
          customerType: 'B2C',
          senderName: 'Sender Test',
          senderPhone: '+91-9876543210',
          senderStreet: '123 Main',
          senderCity: 'Bangalore',
          senderState: 'Karnataka',
          pickupPincode: '560001',
          pickupZoneId: zoneNorthId,
          recipientName: 'Recipient Test',
          recipientPhone: '+91-9876543211',
          recipientStreet: '456 Side',
          recipientCity: 'Bangalore',
          recipientState: 'Karnataka',
          dropPincode: '560024',
          dropZoneId: zoneNorthId,
          packageLengthCm: 10,
          packageBreadthCm: 10,
          packageHeightCm: 10,
          actualWeightKg: 1.0,
          volumetricWeightKg: 0.2,
          billableWeightKg: 1.0,
          volumetricDivisor: 5000,
          zoneType: 'INTRA_ZONE',
          basePrice: 40.0,
          weightPrice: 10.0,
          codSurcharge: 0.0,
          totalAmount: 50.0,
          assignedAgentId: agentProfileId,
        },
      });

      await prisma.orderStatusHistory.createMany({
        data: [
          { orderId: order.id, status: 'CREATED', createdAt: new Date(Date.now() - 6000) },
          { orderId: order.id, status: 'ASSIGNED', createdAt: new Date(Date.now() - 5000) },
          { orderId: order.id, status: 'PICKED_UP', createdAt: new Date(Date.now() - 4000) },
          { orderId: order.id, status: 'IN_TRANSIT', createdAt: new Date(Date.now() - 3000) },
          { orderId: order.id, status: 'OUT_FOR_DELIVERY', createdAt: new Date(Date.now() - 2000) },
        ],
      });

      // Attempt 1 fails
      await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${order.id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${agentToken}` },
          body: JSON.stringify({ status: 'FAILED', reason: 'Attempt 1 failed: Customer busy' }),
        }),
        { params: { id: order.id } }
      );

      // Reschedule 1
      await rescheduleOrderHandler(
        new NextRequest(`http://localhost:3000/api/orders/${order.id}/reschedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${customerToken}` },
          body: JSON.stringify({ scheduledDate: '2026-08-26T10:00:00Z', reason: 'Rescheduled attempt 1' }),
        }),
        { params: { id: order.id } }
      );

      // Out for delivery 2
      await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${order.id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${agentToken}` },
          body: JSON.stringify({ status: 'OUT_FOR_DELIVERY', notes: 'Attempt 2 out for delivery' }),
        }),
        { params: { id: order.id } }
      );

      // Attempt 2 fails
      await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${order.id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${agentToken}` },
          body: JSON.stringify({ status: 'FAILED', reason: 'Attempt 2 failed: Incorrect address landmark' }),
        }),
        { params: { id: order.id } }
      );

      // Reschedule 2
      await rescheduleOrderHandler(
        new NextRequest(`http://localhost:3000/api/orders/${order.id}/reschedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${customerToken}` },
          body: JSON.stringify({ scheduledDate: '2026-08-27T14:00:00Z', reason: 'Rescheduled attempt 2' }),
        }),
        { params: { id: order.id } }
      );

      // Out for delivery 3
      await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${order.id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${agentToken}` },
          body: JSON.stringify({ status: 'OUT_FOR_DELIVERY', notes: 'Attempt 3 out for delivery' }),
        }),
        { params: { id: order.id } }
      );

      // Delivered
      const finalRes = await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${order.id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${agentToken}` },
          body: JSON.stringify({ status: 'DELIVERED', notes: 'Delivered successfully on attempt 3' }),
        }),
        { params: { id: order.id } }
      );
      expect(finalRes.status).toBe(200);
      const finalData = await finalRes.json();
      expect(finalData.currentStatus).toBe('DELIVERED');
      // 5 initial + 1 fail + 1 resched + 1 out + 1 fail + 1 resched + 1 out + 1 del = 12 total events
      expect(finalData.statusHistory).toHaveLength(12);
    });
  });

  describe('3. Injection Attacks & Malicious Payload Sanitization', () => {
    it('should safely handle SQL injection payloads in public tracking URL', async () => {
      const sqlInjections = [
        "' OR '1'='1",
        "'; DROP TABLE \"Order\"; --",
        "1 UNION SELECT * FROM \"User\"",
        "../../etc/passwd",
      ];

      for (const payload of sqlInjections) {
        const req = new NextRequest(`http://localhost:3000/api/orders/track/${encodeURIComponent(payload)}`, {
          method: 'GET',
        });
        const res = await trackOrderHandler(req, { params: { trackingNumber: payload } });
        expect(res.status).toBe(404);
      }
    });

    it('should safely accept and store rich unicode, emojis, and quotes in notes and reasons', async () => {
      const createRes = await createOrderHandler(
        new NextRequest('http://localhost:3000/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${customerToken}` },
          body: JSON.stringify({
            senderName: '山田太郎 📦',
            senderPhone: '+91-9876543210',
            senderStreet: 'Rue de l’Église #401',
            senderCity: 'München',
            senderState: 'Bayern',
            pickupPincode: '560001',
            recipientName: 'مريم محمد',
            recipientPhone: '+91-9876543211',
            recipientStreet: 'Apt "B" <script>alert(1)</script>',
            recipientCity: 'Bangalore',
            recipientState: 'Karnataka',
            dropPincode: '560024',
            packageLengthCm: 15,
            packageBreadthCm: 15,
            packageHeightCm: 15,
            actualWeightKg: 1.5,
            notes: 'Handle with extreme care: 脆弱 / Fragile! 🚨',
          }),
        })
      );
      expect(createRes.status).toBe(201);
      const order = await createRes.json();
      expect(order.senderName).toBe('山田太郎 📦');
      expect(order.recipientName).toBe('مريم محمد');
      expect(order.notes).toBe('Handle with extreme care: 脆弱 / Fragile! 🚨');
    });
  });

  describe('4. Concurrency & Rapid Sequential State Transitions', () => {
    it('should correctly handle sequential state transitions without state corruption', async () => {
      const createRes = await createOrderHandler(
        new NextRequest('http://localhost:3000/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${customerToken}` },
          body: JSON.stringify({
            senderName: 'Concurrent Sender',
            senderPhone: '+91-9876543210',
            senderStreet: '123 MG Road',
            senderCity: 'Bangalore',
            senderState: 'Karnataka',
            pickupPincode: '560001',
            recipientName: 'Concurrent Recipient',
            recipientPhone: '+91-9876543211',
            recipientStreet: '456 Outer Ring',
            recipientCity: 'Bangalore',
            recipientState: 'Karnataka',
            dropPincode: '560024',
            packageLengthCm: 20,
            packageBreadthCm: 20,
            packageHeightCm: 20,
            actualWeightKg: 2.0,
          }),
        })
      );
      const order = await createRes.json();

      await prisma.order.update({
        where: { id: order.id },
        data: { assignedAgentId: agentProfileId },
      });

      // Execute sequential steps
      await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${order.id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${adminToken}` },
          body: JSON.stringify({ status: 'ASSIGNED' }),
        }),
        { params: { id: order.id } }
      );

      await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${order.id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${agentToken}` },
          body: JSON.stringify({ status: 'PICKED_UP' }),
        }),
        { params: { id: order.id } }
      );

      await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${order.id}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${agentToken}` },
          body: JSON.stringify({ status: 'IN_TRANSIT' }),
        }),
        { params: { id: order.id } }
      );

      // Verify final derived state
      const finalOrderRes = await getOrderByIdHandler(
        new NextRequest(`http://localhost:3000/api/orders/${order.id}`, {
          method: 'GET',
          headers: { cookie: `auth-token=${adminToken}` },
        }),
        { params: { id: order.id } }
      );
      const finalOrder = await finalOrderRes.json();
      expect(finalOrder.currentStatus).toBe('IN_TRANSIT');
      expect(finalOrder.statusHistory).toHaveLength(4);
    });
  });
});
