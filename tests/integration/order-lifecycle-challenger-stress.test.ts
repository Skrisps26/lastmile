// /home/skrisps/lastmile/tests/integration/order-lifecycle-challenger-stress.test.ts

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
import {
  deriveCurrentStatus,
  VALID_TRANSITIONS,
  ORDER_STATUSES,
  OrderStatus,
  validateTransition,
  InvalidStatusTransitionError,
} from '@/lib/orders/status-machine';

describe('Empirical Challenger Suite: Order Ledger Immutability, Multi-Cycle Rescheduling & Status Projection (M3-R2)', () => {
  let adminToken: string;
  let adminUserId: string;
  let customerToken: string;
  let customerUserId: string;
  let customer2Token: string;
  let customer2UserId: string;
  let agentToken: string;
  let agentUserId: string;
  let agentProfileId: string;
  let zoneNorthId: string;
  let zoneSouthId: string;

  beforeAll(async () => {
    // 1. Fetch / ensure zones and pincodes
    const zoneNorth = await prisma.zone.findFirst({ where: { code: 'ZONE_NORTH' } });
    const zoneSouth = await prisma.zone.findFirst({ where: { code: 'ZONE_SOUTH' } });
    zoneNorthId = zoneNorth!.id;
    zoneSouthId = zoneSouth!.id;

    // 2. Setup test users
    const dummyPasswordHash = await hashPassword('SecurePass123!');
    const cust = await prisma.user.upsert({
      where: { email: 'm3_challenger_cust@lastmile.local' },
      update: {},
      create: {
        name: 'Challenger Customer',
        email: 'm3_challenger_cust@lastmile.local',
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

    const cust2 = await prisma.user.upsert({
      where: { email: 'm3_challenger_cust2@lastmile.local' },
      update: {},
      create: {
        name: 'Challenger Customer 2',
        email: 'm3_challenger_cust2@lastmile.local',
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

    const admin = await prisma.user.upsert({
      where: { email: 'm3_challenger_admin@lastmile.local' },
      update: {},
      create: {
        name: 'Challenger Admin',
        email: 'm3_challenger_admin@lastmile.local',
        passwordHash: dummyPasswordHash,
        role: 'ADMIN',
      },
    });
    adminUserId = admin.id;
    adminToken = await createSessionToken({
      userId: admin.id,
      email: admin.email,
      role: 'ADMIN',
      name: admin.name,
    });

    const agentUser = await prisma.user.upsert({
      where: { email: 'm3_challenger_agent@lastmile.local' },
      update: {},
      create: {
        name: 'Challenger Agent',
        email: 'm3_challenger_agent@lastmile.local',
        passwordHash: dummyPasswordHash,
        role: 'AGENT',
      },
    });
    agentUserId = agentUser.id;
    const agentProf = await prisma.deliveryAgentProfile.upsert({
      where: { userId: agentUser.id },
      update: {},
      create: {
        userId: agentUser.id,
        status: 'AVAILABLE',
        vehicleType: 'VAN',
        vehicleNumber: 'KA-05-CHALLENGER',
        maxCapacity: 30,
      },
    });
    agentProfileId = agentProf.id;
    agentToken = await createSessionToken({
      userId: agentUser.id,
      email: agentUser.email,
      role: 'AGENT',
      name: agentUser.name,
    });

    // Cleanup previous challenger test orders
    await prisma.order.deleteMany({
      where: {
        OR: [
          { customerId: { in: [customerUserId, customer2UserId] } },
          { trackingNumber: { startsWith: 'LMD-CHALLENGER-' } },
        ],
      },
    });
  });

  afterAll(async () => {
    await prisma.order.deleteMany({
      where: {
        OR: [
          { customerId: { in: [customerUserId, customer2UserId] } },
          { trackingNumber: { startsWith: 'LMD-CHALLENGER-' } },
        ],
      },
    });
  });

  describe('1. Audit Ledger Append-Only Immutability Verification', () => {
    it('should strictly append new records and never update or delete existing history rows across all status transitions', async () => {
      // 1. Create order
      const createRes = await createOrderHandler(
        new NextRequest('http://localhost:3000/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${customerToken}` },
          body: JSON.stringify({
            senderName: 'Immutability Sender',
            senderPhone: '+91-9876543210',
            senderStreet: '100 Tech Park',
            senderCity: 'Bangalore',
            senderState: 'Karnataka',
            pickupPincode: '560001',
            recipientName: 'Immutability Recipient',
            recipientPhone: '+91-9876543211',
            recipientStreet: '200 Outer Ring',
            recipientCity: 'Bangalore',
            recipientState: 'Karnataka',
            dropPincode: '560024',
            packageLengthCm: 20,
            packageBreadthCm: 15,
            packageHeightCm: 10,
            actualWeightKg: 1.5,
          }),
        })
      );
      expect(createRes.status).toBe(201);
      const createdData = await createRes.json();
      const orderId = createdData.id;

      // Assign agent
      await prisma.order.update({
        where: { id: orderId },
        data: { assignedAgentId: agentProfileId },
      });

      // Track snapshots of every history row
      const historySnapshots: Array<{
        id: string;
        orderId: string;
        status: string;
        changedById: string | null;
        reason: string | null;
        notes: string | null;
        metadata: string | null;
        createdAt: Date;
      }> = [];

      // Capture initial CREATED row
      const initialRows = await prisma.orderStatusHistory.findMany({
        where: { orderId },
        orderBy: { createdAt: 'asc' },
      });
      expect(initialRows).toHaveLength(1);
      historySnapshots.push({ ...initialRows[0] });

      const lifecycleSteps = [
        {
          status: 'ASSIGNED' as OrderStatus,
          notes: 'Agent assigned to order',
          token: adminToken,
        },
        {
          status: 'PICKED_UP' as OrderStatus,
          notes: 'Package picked up from origin',
          token: agentToken,
        },
        {
          status: 'IN_TRANSIT' as OrderStatus,
          notes: 'In transit to destination hub',
          token: agentToken,
        },
        {
          status: 'OUT_FOR_DELIVERY' as OrderStatus,
          notes: 'Out for delivery attempt 1',
          token: agentToken,
        },
        {
          status: 'FAILED' as OrderStatus,
          reason: 'Customer residence locked',
          notes: 'Delivery attempt failed',
          token: agentToken,
        },
      ];

      for (let stepIndex = 0; stepIndex < lifecycleSteps.length; stepIndex++) {
        const step = lifecycleSteps[stepIndex];
        const res = await transitionStatusHandler(
          new NextRequest(`http://localhost:3000/api/orders/${orderId}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', cookie: `auth-token=${step.token}` },
            body: JSON.stringify({
              status: step.status,
              reason: step.reason,
              notes: step.notes,
            }),
          }),
          { params: { id: orderId } }
        );
        expect(res.status).toBe(200);

        // Query all history rows from DB directly
        const currentDbRows = await prisma.orderStatusHistory.findMany({
          where: { orderId },
          orderBy: { createdAt: 'asc' },
        });

        // 1. Expected row count is exactly previous count + 1
        expect(currentDbRows).toHaveLength(historySnapshots.length + 1);

        // 2. Deep compare all prior rows to ensure byte-for-byte immutability
        for (let i = 0; i < historySnapshots.length; i++) {
          const original = historySnapshots[i];
          const current = currentDbRows[i];

          expect(current.id).toBe(original.id);
          expect(current.orderId).toBe(original.orderId);
          expect(current.status).toBe(original.status);
          expect(current.changedById).toBe(original.changedById);
          expect(current.reason).toBe(original.reason);
          expect(current.notes).toBe(original.notes);
          expect(current.metadata).toBe(original.metadata);
          expect(current.createdAt.getTime()).toBe(original.createdAt.getTime());
        }

        // 3. Save new row to snapshots
        const newestRow = currentDbRows[currentDbRows.length - 1];
        expect(newestRow.status).toBe(step.status);
        if (step.reason) {
          expect(newestRow.reason).toBe(step.reason);
        }
        historySnapshots.push({ ...newestRow });
      }
    });
  });

  describe('2. Multi-Cycle Failed Delivery & Reschedule Flow Stress Testing', () => {
    it('should accurately handle a 3-cycle failure & reschedule lifecycle: FAILED -> RESCHEDULED -> OUT_FOR_DELIVERY -> FAILED -> RESCHEDULED -> OUT_FOR_DELIVERY -> FAILED -> RESCHEDULED -> OUT_FOR_DELIVERY -> DELIVERED', async () => {
      // 1. Create order
      const createRes = await createOrderHandler(
        new NextRequest('http://localhost:3000/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${customerToken}` },
          body: JSON.stringify({
            senderName: 'MultiCycle Sender',
            senderPhone: '+91-9876543210',
            senderStreet: '101 Multi St',
            senderCity: 'Bangalore',
            senderState: 'Karnataka',
            pickupPincode: '560001',
            recipientName: 'MultiCycle Recipient',
            recipientPhone: '+91-9876543211',
            recipientStreet: '202 Multi Way',
            recipientCity: 'Bangalore',
            recipientState: 'Karnataka',
            dropPincode: '560024',
            packageLengthCm: 25,
            packageBreadthCm: 20,
            packageHeightCm: 15,
            actualWeightKg: 2.0,
          }),
        })
      );
      expect(createRes.status).toBe(201);
      const order = await createRes.json();
      const orderId = order.id;

      // Assign agent
      await prisma.order.update({
        where: { id: orderId },
        data: { assignedAgentId: agentProfileId },
      });

      // Step A: CREATED -> ASSIGNED -> PICKED_UP -> IN_TRANSIT -> OUT_FOR_DELIVERY
      await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${orderId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${adminToken}` },
          body: JSON.stringify({ status: 'ASSIGNED' }),
        }),
        { params: { id: orderId } }
      );
      await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${orderId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${agentToken}` },
          body: JSON.stringify({ status: 'PICKED_UP' }),
        }),
        { params: { id: orderId } }
      );
      await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${orderId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${agentToken}` },
          body: JSON.stringify({ status: 'IN_TRANSIT' }),
        }),
        { params: { id: orderId } }
      );
      await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${orderId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${agentToken}` },
          body: JSON.stringify({ status: 'OUT_FOR_DELIVERY', notes: 'Initial delivery attempt 1' }),
        }),
        { params: { id: orderId } }
      );

      // Verify current status is OUT_FOR_DELIVERY
      let currentCheck = await getOrderByIdHandler(
        new NextRequest(`http://localhost:3000/api/orders/${orderId}`, {
          headers: { cookie: `auth-token=${customerToken}` },
        }),
        { params: { id: orderId } }
      );
      expect((await currentCheck.json()).currentStatus).toBe('OUT_FOR_DELIVERY');

      // === CYCLE 1 ===
      // 1. Fail attempt 1
      const fail1Res = await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${orderId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${agentToken}` },
          body: JSON.stringify({
            status: 'FAILED',
            reason: 'Attempt 1: Recipient not reachable on phone',
            notes: 'Call log: 3 attempts made',
          }),
        }),
        { params: { id: orderId } }
      );
      expect(fail1Res.status).toBe(200);
      expect((await fail1Res.json()).currentStatus).toBe('FAILED');

      // 2. Customer Reschedule 1
      const resched1Date = '2026-08-25T10:00:00.000Z';
      const resched1Res = await rescheduleOrderHandler(
        new NextRequest(`http://localhost:3000/api/orders/${orderId}/reschedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${customerToken}` },
          body: JSON.stringify({
            scheduledDate: resched1Date,
            reason: 'Reschedule Cycle 1: Deliver Tuesday morning',
          }),
        }),
        { params: { id: orderId } }
      );
      expect(resched1Res.status).toBe(200);
      const resched1Data = await resched1Res.json();
      expect(resched1Data.currentStatus).toBe('RESCHEDULED');
      expect(new Date(resched1Data.scheduledDate).toISOString()).toBe(resched1Date);

      // === CYCLE 2 ===
      // 3. Out for delivery 2
      const out2Res = await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${orderId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${agentToken}` },
          body: JSON.stringify({ status: 'OUT_FOR_DELIVERY', notes: 'Out for delivery attempt 2' }),
        }),
        { params: { id: orderId } }
      );
      expect(out2Res.status).toBe(200);
      expect((await out2Res.json()).currentStatus).toBe('OUT_FOR_DELIVERY');

      // 4. Fail attempt 2
      const fail2Res = await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${orderId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${agentToken}` },
          body: JSON.stringify({
            status: 'FAILED',
            reason: 'Attempt 2: Gate security denied entry / OTP expired',
          }),
        }),
        { params: { id: orderId } }
      );
      expect(fail2Res.status).toBe(200);
      expect((await fail2Res.json()).currentStatus).toBe('FAILED');

      // 5. Customer Reschedule 2
      const resched2Date = '2026-08-26T14:00:00.000Z';
      const resched2Res = await rescheduleOrderHandler(
        new NextRequest(`http://localhost:3000/api/orders/${orderId}/reschedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${customerToken}` },
          body: JSON.stringify({
            scheduledDate: resched2Date,
            reason: 'Reschedule Cycle 2: Deliver Wednesday afternoon',
          }),
        }),
        { params: { id: orderId } }
      );
      expect(resched2Res.status).toBe(200);
      const resched2Data = await resched2Res.json();
      expect(resched2Data.currentStatus).toBe('RESCHEDULED');
      expect(new Date(resched2Data.scheduledDate).toISOString()).toBe(resched2Date);

      // === CYCLE 3 ===
      // 6. Out for delivery 3
      const out3Res = await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${orderId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${agentToken}` },
          body: JSON.stringify({ status: 'OUT_FOR_DELIVERY', notes: 'Out for delivery attempt 3' }),
        }),
        { params: { id: orderId } }
      );
      expect(out3Res.status).toBe(200);
      expect((await out3Res.json()).currentStatus).toBe('OUT_FOR_DELIVERY');

      // 7. Fail attempt 3
      const fail3Res = await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${orderId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${agentToken}` },
          body: JSON.stringify({
            status: 'FAILED',
            reason: 'Attempt 3: Heavy rain / waterlogged route',
          }),
        }),
        { params: { id: orderId } }
      );
      expect(fail3Res.status).toBe(200);
      expect((await fail3Res.json()).currentStatus).toBe('FAILED');

      // 8. Customer Reschedule 3
      const resched3Date = '2026-08-27T16:00:00.000Z';
      const resched3Res = await rescheduleOrderHandler(
        new NextRequest(`http://localhost:3000/api/orders/${orderId}/reschedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${customerToken}` },
          body: JSON.stringify({
            scheduledDate: resched3Date,
            reason: 'Reschedule Cycle 3: Deliver Thursday evening',
          }),
        }),
        { params: { id: orderId } }
      );
      expect(resched3Res.status).toBe(200);
      const resched3Data = await resched3Res.json();
      expect(resched3Data.currentStatus).toBe('RESCHEDULED');
      expect(new Date(resched3Data.scheduledDate).toISOString()).toBe(resched3Date);

      // === FINAL SUCCESSFUL DELIVERY ===
      // 9. Out for delivery 4
      const out4Res = await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${orderId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${agentToken}` },
          body: JSON.stringify({ status: 'OUT_FOR_DELIVERY', notes: 'Out for delivery attempt 4 (Final)' }),
        }),
        { params: { id: orderId } }
      );
      expect(out4Res.status).toBe(200);
      expect((await out4Res.json()).currentStatus).toBe('OUT_FOR_DELIVERY');

      // 10. DELIVERED
      const deliveredRes = await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${orderId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${agentToken}` },
          body: JSON.stringify({ status: 'DELIVERED', notes: 'Handed over successfully with OTP confirmation' }),
        }),
        { params: { id: orderId } }
      );
      expect(deliveredRes.status).toBe(200);
      const deliveredData = await deliveredRes.json();
      expect(deliveredData.currentStatus).toBe('DELIVERED');

      // Verify entire chronological history sequence in database
      const fullHistory = await prisma.orderStatusHistory.findMany({
        where: { orderId },
        orderBy: { createdAt: 'asc' },
      });

      // Total events:
      // 1. CREATED
      // 2. ASSIGNED
      // 3. PICKED_UP
      // 4. IN_TRANSIT
      // 5. OUT_FOR_DELIVERY (1)
      // 6. FAILED (1)
      // 7. RESCHEDULED (1)
      // 8. OUT_FOR_DELIVERY (2)
      // 9. FAILED (2)
      // 10. RESCHEDULED (2)
      // 11. OUT_FOR_DELIVERY (3)
      // 12. FAILED (3)
      // 13. RESCHEDULED (3)
      // 14. OUT_FOR_DELIVERY (4)
      // 15. DELIVERED
      expect(fullHistory).toHaveLength(15);

      const expectedSequence: OrderStatus[] = [
        'CREATED',
        'ASSIGNED',
        'PICKED_UP',
        'IN_TRANSIT',
        'OUT_FOR_DELIVERY',
        'FAILED',
        'RESCHEDULED',
        'OUT_FOR_DELIVERY',
        'FAILED',
        'RESCHEDULED',
        'OUT_FOR_DELIVERY',
        'FAILED',
        'RESCHEDULED',
        'OUT_FOR_DELIVERY',
        'DELIVERED',
      ];

      for (let i = 0; i < expectedSequence.length; i++) {
        expect(fullHistory[i].status).toBe(expectedSequence[i]);
      }

      // Verify specific reasons on failed attempts
      expect(fullHistory[5].reason).toContain('Attempt 1: Recipient not reachable');
      expect(fullHistory[8].reason).toContain('Attempt 2: Gate security denied entry');
      expect(fullHistory[11].reason).toContain('Attempt 3: Heavy rain');

      // Verify metadata on reschedule attempts
      const meta1 = JSON.parse(fullHistory[6].metadata!);
      const meta2 = JSON.parse(fullHistory[9].metadata!);
      const meta3 = JSON.parse(fullHistory[12].metadata!);

      expect(meta1.newScheduledDate).toBe(resched1Date);
      expect(meta2.newScheduledDate).toBe(resched2Date);
      expect(meta3.newScheduledDate).toBe(resched3Date);

      // Verify Public Tracking Timeline matches full sequence
      const trackRes = await trackOrderHandler(
        new NextRequest(`http://localhost:3000/api/orders/track/${order.trackingNumber}`),
        { params: { trackingNumber: order.trackingNumber } }
      );
      expect(trackRes.status).toBe(200);
      const trackData = await trackRes.json();
      expect(trackData.currentStatus).toBe('DELIVERED');
      expect(trackData.progressPercentage).toBe(100);
      expect(trackData.timeline).toHaveLength(15);
      for (let i = 0; i < expectedSequence.length; i++) {
        expect(trackData.timeline[i].status).toBe(expectedSequence[i]);
      }
    });
  });

  describe('3. Order Status Projection Consistency Across History Queries', () => {
    it('should project identical current status across getOrderById, getOrderByTrackingNumber, and listOrders across all lifecycle stages', async () => {
      // 1. Create order
      const createRes = await createOrderHandler(
        new NextRequest('http://localhost:3000/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${customerToken}` },
          body: JSON.stringify({
            senderName: 'Consistency Sender',
            senderPhone: '+91-9876543210',
            senderStreet: '303 Consistency Way',
            senderCity: 'Bangalore',
            senderState: 'Karnataka',
            pickupPincode: '560001',
            recipientName: 'Consistency Recipient',
            recipientPhone: '+91-9876543211',
            recipientStreet: '404 Consistency Blvd',
            recipientCity: 'Bangalore',
            recipientState: 'Karnataka',
            dropPincode: '560024',
            packageLengthCm: 15,
            packageBreadthCm: 15,
            packageHeightCm: 15,
            actualWeightKg: 1.0,
          }),
        })
      );
      const order = await createRes.json();
      const orderId = order.id;
      const trackingNumber = order.trackingNumber;

      // Assign agent
      await prisma.order.update({
        where: { id: orderId },
        data: { assignedAgentId: agentProfileId },
      });

      // Helper function to assert projection consistency across all 3 query endpoints
      const assertAllQueryEndpointsMatch = async (expectedStatus: OrderStatus) => {
        // A. getOrderById
        const getByIdRes = await getOrderByIdHandler(
          new NextRequest(`http://localhost:3000/api/orders/${orderId}`, {
            headers: { cookie: `auth-token=${adminToken}` },
          }),
          { params: { id: orderId } }
        );
        expect(getByIdRes.status).toBe(200);
        const getByIdData = await getByIdRes.json();
        expect(getByIdData.currentStatus).toBe(expectedStatus);

        // B. getOrderByTrackingNumber (Public)
        const trackRes = await trackOrderHandler(
          new NextRequest(`http://localhost:3000/api/orders/track/${trackingNumber}`),
          { params: { trackingNumber } }
        );
        expect(trackRes.status).toBe(200);
        const trackData = await trackRes.json();
        expect(trackData.currentStatus).toBe(expectedStatus);

        // C. listOrders (Admin query)
        const listRes = await listOrdersHandler(
          new NextRequest(`http://localhost:3000/api/orders?search=${trackingNumber}`, {
            headers: { cookie: `auth-token=${adminToken}` },
          })
        );
        expect(listRes.status).toBe(200);
        const listData = await listRes.json();
        expect(listData.orders).toHaveLength(1);
        expect(listData.orders[0].currentStatus).toBe(expectedStatus);

        // D. listOrders with matching status filter
        const matchFilterRes = await listOrdersHandler(
          new NextRequest(`http://localhost:3000/api/orders?status=${expectedStatus}&search=${trackingNumber}`, {
            headers: { cookie: `auth-token=${adminToken}` },
          })
        );
        const matchFilterData = await matchFilterRes.json();
        expect(matchFilterData.orders).toHaveLength(1);
        expect(matchFilterData.orders[0].id).toBe(orderId);

        // E. listOrders with non-matching status filter must return empty
        const otherStatuses = ORDER_STATUSES.filter((s) => s !== expectedStatus);
        for (const other of otherStatuses.slice(0, 3)) {
          const nonMatchRes = await listOrdersHandler(
            new NextRequest(`http://localhost:3000/api/orders?status=${other}&search=${trackingNumber}`, {
              headers: { cookie: `auth-token=${adminToken}` },
            })
          );
          const nonMatchData = await nonMatchRes.json();
          expect(nonMatchData.orders).toHaveLength(0);
        }
      };

      // Check Stage 1: CREATED
      await assertAllQueryEndpointsMatch('CREATED');

      // Stage 2: ASSIGNED
      await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${orderId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${adminToken}` },
          body: JSON.stringify({ status: 'ASSIGNED' }),
        }),
        { params: { id: orderId } }
      );
      await assertAllQueryEndpointsMatch('ASSIGNED');

      // Stage 3: PICKED_UP
      await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${orderId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${agentToken}` },
          body: JSON.stringify({ status: 'PICKED_UP' }),
        }),
        { params: { id: orderId } }
      );
      await assertAllQueryEndpointsMatch('PICKED_UP');

      // Stage 4: IN_TRANSIT
      await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${orderId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${agentToken}` },
          body: JSON.stringify({ status: 'IN_TRANSIT' }),
        }),
        { params: { id: orderId } }
      );
      await assertAllQueryEndpointsMatch('IN_TRANSIT');

      // Stage 5: OUT_FOR_DELIVERY
      await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${orderId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${agentToken}` },
          body: JSON.stringify({ status: 'OUT_FOR_DELIVERY' }),
        }),
        { params: { id: orderId } }
      );
      await assertAllQueryEndpointsMatch('OUT_FOR_DELIVERY');

      // Stage 6: FAILED
      await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${orderId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${agentToken}` },
          body: JSON.stringify({ status: 'FAILED', reason: 'Customer requested evening delivery' }),
        }),
        { params: { id: orderId } }
      );
      await assertAllQueryEndpointsMatch('FAILED');

      // Stage 7: RESCHEDULED
      await rescheduleOrderHandler(
        new NextRequest(`http://localhost:3000/api/orders/${orderId}/reschedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${customerToken}` },
          body: JSON.stringify({ scheduledDate: '2026-08-28T18:00:00.000Z', reason: 'Evening delivery' }),
        }),
        { params: { id: orderId } }
      );
      await assertAllQueryEndpointsMatch('RESCHEDULED');

      // Stage 8: OUT_FOR_DELIVERY
      await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${orderId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${agentToken}` },
          body: JSON.stringify({ status: 'OUT_FOR_DELIVERY' }),
        }),
        { params: { id: orderId } }
      );
      await assertAllQueryEndpointsMatch('OUT_FOR_DELIVERY');

      // Stage 9: DELIVERED
      await transitionStatusHandler(
        new NextRequest(`http://localhost:3000/api/orders/${orderId}/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${agentToken}` },
          body: JSON.stringify({ status: 'DELIVERED', notes: 'Delivered in full' }),
        }),
        { params: { id: orderId } }
      );
      await assertAllQueryEndpointsMatch('DELIVERED');
    });
  });

  describe('4. Adversarial Attack Vectors on Rescheduling & Ledger Operations', () => {
    it('should reject non-owner customer attempting to reschedule another customer order (403)', async () => {
      // Create order for Customer 1
      const order = await prisma.order.create({
        data: {
          trackingNumber: 'LMD-CHALLENGER-RO-1',
          customerId: customerUserId,
          customerType: 'B2C',
          senderName: 'Sender',
          senderPhone: '+91-9876543210',
          senderStreet: '123 Main',
          senderCity: 'Bangalore',
          senderState: 'Karnataka',
          pickupPincode: '560001',
          pickupZoneId: zoneNorthId,
          recipientName: 'Recipient',
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

      // Put in FAILED state
      await prisma.orderStatusHistory.createMany({
        data: [
          { orderId: order.id, status: 'CREATED' },
          { orderId: order.id, status: 'OUT_FOR_DELIVERY' },
          { orderId: order.id, status: 'FAILED', reason: 'Attempt failed' },
        ],
      });

      // Customer 2 attempts to reschedule Customer 1 order
      const res = await rescheduleOrderHandler(
        new NextRequest(`http://localhost:3000/api/orders/${order.id}/reschedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: `auth-token=${customer2Token}` },
          body: JSON.stringify({ scheduledDate: '2026-08-30T10:00:00Z' }),
        }),
        { params: { id: order.id } }
      );
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain('only reschedule your own orders');
    });

    it('should reject invalid / unparseable date strings in reschedule requests (400)', async () => {
      const order = await prisma.order.create({
        data: {
          trackingNumber: 'LMD-CHALLENGER-RO-2',
          customerId: customerUserId,
          customerType: 'B2C',
          senderName: 'Sender',
          senderPhone: '+91-9876543210',
          senderStreet: '123 Main',
          senderCity: 'Bangalore',
          senderState: 'Karnataka',
          pickupPincode: '560001',
          pickupZoneId: zoneNorthId,
          recipientName: 'Recipient',
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
          { orderId: order.id, status: 'CREATED' },
          { orderId: order.id, status: 'OUT_FOR_DELIVERY' },
          { orderId: order.id, status: 'FAILED', reason: 'Attempt failed' },
        ],
      });

      const invalidDates = ['not-a-date', '2026-99-99', '', 'undefined', '12345'];
      for (const badDate of invalidDates) {
        const res = await rescheduleOrderHandler(
          new NextRequest(`http://localhost:3000/api/orders/${order.id}/reschedule`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', cookie: `auth-token=${customerToken}` },
            body: JSON.stringify({ scheduledDate: badDate }),
          }),
          { params: { id: order.id } }
        );
        expect(res.status).toBe(400);
      }
    });

    it('should reject whitespace-only reasons when transitioning to FAILED (400)', async () => {
      const order = await prisma.order.create({
        data: {
          trackingNumber: 'LMD-CHALLENGER-RO-3',
          customerId: customerUserId,
          customerType: 'B2C',
          senderName: 'Sender',
          senderPhone: '+91-9876543210',
          senderStreet: '123 Main',
          senderCity: 'Bangalore',
          senderState: 'Karnataka',
          pickupPincode: '560001',
          pickupZoneId: zoneNorthId,
          recipientName: 'Recipient',
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
          { orderId: order.id, status: 'CREATED' },
          { orderId: order.id, status: 'OUT_FOR_DELIVERY' },
        ],
      });

      const whitespaceReasons = ['   ', '\t\t', '\n\n', ' \t \n '];
      for (const badReason of whitespaceReasons) {
        const res = await transitionStatusHandler(
          new NextRequest(`http://localhost:3000/api/orders/${order.id}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', cookie: `auth-token=${agentToken}` },
            body: JSON.stringify({ status: 'FAILED', reason: badReason }),
          }),
          { params: { id: order.id } }
        );
        expect(res.status).toBe(400);
      }
    });
  });
});
