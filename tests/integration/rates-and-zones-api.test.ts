// /home/skrisps/lastmile/tests/integration/rates-and-zones-api.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { POST as calculateHandler } from '@/app/api/rates/calculate/route';
import { GET as getZonesHandler, POST as postZonesHandler } from '@/app/api/zones/route';
import { GET as getZoneByIdHandler, PUT as putZoneHandler, DELETE as deleteZoneHandler } from '@/app/api/zones/[id]/route';
import { GET as getPincodesHandler, POST as postPincodesHandler } from '@/app/api/pincodes/route';
import { POST as postBulkPincodesHandler } from '@/app/api/pincodes/bulk/route';
import { GET as getPincodeByIdHandler, PUT as putPincodeHandler, DELETE as deletePincodeHandler } from '@/app/api/pincodes/[id]/route';
import { GET as getPincodeZoneHandler } from '@/app/api/pincodes/[pincode]/zone/route';
import { GET as getRateCardsHandler, POST as postRateCardsHandler } from '@/app/api/rates/cards/route';
import { GET as getRateCardByIdHandler, PUT as putRateCardHandler, DELETE as deleteRateCardHandler } from '@/app/api/rates/cards/[id]/route';
import { createSessionToken } from '@/lib/auth/jwt';

describe('Integration: Rates, Zones & Dynamic Engine API Suite (M2-R1)', () => {
  let adminToken: string;
  let customerToken: string;
  let agentToken: string;

  beforeAll(async () => {
    adminToken = await createSessionToken({
      userId: 'test_admin_m2_id',
      email: 'admin.m2.integration@lastmile.local',
      role: 'ADMIN',
      name: 'Admin M2 Tester',
    });

    customerToken = await createSessionToken({
      userId: 'test_customer_m2_id',
      email: 'customer.m2.integration@lastmile.local',
      role: 'CUSTOMER',
      name: 'Customer M2 Tester',
    });

    agentToken = await createSessionToken({
      userId: 'test_agent_m2_id',
      email: 'agent.m2.integration@lastmile.local',
      role: 'AGENT',
      name: 'Agent M2 Tester',
    });
  });

  describe('1. Upfront Quotation Endpoint (POST /api/rates/calculate)', () => {
    it('should calculate Intra-Zone B2C quote with itemized cost breakdown', async () => {
      // 560001 (Bangalore GPO) -> 560024 (Hebbal), both in ZONE_NORTH
      const req = new NextRequest('http://localhost:3000/api/rates/calculate', {
        method: 'POST',
        body: JSON.stringify({
          pickupPincode: '560001',
          dropPincode: '560024',
          customerType: 'B2C',
          lengthCm: 30,
          breadthCm: 20,
          heightCm: 10, // volWeight = 1.2 kg
          actualWeightKg: 2.5, // billable = 2.5 kg, excess = 2.0 kg
          isCod: false,
        }),
      });

      const res = await calculateHandler(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.pickupZone.code).toBe('ZONE_NORTH');
      expect(json.dropZone.code).toBe('ZONE_NORTH');
      expect(json.zoneType).toBe('INTRA_ZONE');
      expect(json.customerType).toBe('B2C');
      expect(json.billableWeightKg).toBe(2.5);
      expect(json.basePrice).toBe(40.0);
      expect(json.weightPrice).toBe(40.0); // 2.0 * 20
      expect(json.codSurcharge).toBe(0.0);
      expect(json.totalAmount).toBe(80.0);
      expect(json.breakdown).toBeDefined();
      expect(json.breakdown.totalAmount).toBe(80.0);
    });

    it('should calculate Inter-Zone B2C quote with COD surcharge breakdown', async () => {
      // 560001 (ZONE_NORTH) -> 560034 (ZONE_SOUTH)
      const req = new NextRequest('http://localhost:3000/api/rates/calculate', {
        method: 'POST',
        body: JSON.stringify({
          pickupPincode: '560001',
          dropPincode: '560034',
          customerType: 'B2C',
          lengthCm: 20,
          breadthCm: 20,
          heightCm: 20, // 8000 / 5000 = 1.6 kg
          actualWeightKg: 1.0, // billable = 1.6 kg, excess = 1.1 kg
          isCod: true,
          codAmount: 1500.0, // Fixed 40 + (1500 * 0.02 = 30) = 70 > min 50
        }),
      });

      const res = await calculateHandler(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.zoneType).toBe('INTER_ZONE');
      expect(json.customerType).toBe('B2C');
      expect(json.billableWeightKg).toBe(1.6);
      expect(json.basePrice).toBe(75.0);
      expect(json.weightPrice).toBe(44.0); // 1.1 * 40
      expect(json.codSurcharge).toBe(70.0);
      expect(json.totalAmount).toBe(189.0); // 75 + 44 + 70
    });

    it('should calculate Inter-Zone B2B quote with wholesale rates', async () => {
      // 560010 (ZONE_WEST) -> 560067 (ZONE_EAST)
      const req = new NextRequest('http://localhost:3000/api/rates/calculate', {
        method: 'POST',
        body: JSON.stringify({
          pickupPincode: '560010',
          dropPincode: '560067',
          customerType: 'B2B',
          lengthCm: 40,
          breadthCm: 30,
          heightCm: 20, // 24000 / 5000 = 4.8 kg
          actualWeightKg: 5.0, // billable = 5.0 kg, excess = 4.5 kg
          isCod: false,
        }),
      });

      const res = await calculateHandler(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.zoneType).toBe('INTER_ZONE');
      expect(json.customerType).toBe('B2B');
      expect(json.billableWeightKg).toBe(5.0);
      expect(json.basePrice).toBe(60.0);
      expect(json.weightPrice).toBe(135.0); // 4.5 * 30
      expect(json.totalAmount).toBe(195.0);
    });

    it('should return 404 when pickup pincode is unmapped/serviceable', async () => {
      const req = new NextRequest('http://localhost:3000/api/rates/calculate', {
        method: 'POST',
        body: JSON.stringify({
          pickupPincode: '999999',
          dropPincode: '560001',
          customerType: 'B2C',
          lengthCm: 10,
          breadthCm: 10,
          heightCm: 10,
          actualWeightKg: 1.0,
        }),
      });

      const res = await calculateHandler(req);
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toMatch(/pickup pincode 999999 is not serviceable/i);
    });

    it('should return 404 when drop pincode is unmapped/serviceable', async () => {
      const req = new NextRequest('http://localhost:3000/api/rates/calculate', {
        method: 'POST',
        body: JSON.stringify({
          pickupPincode: '560001',
          dropPincode: '888888',
          customerType: 'B2C',
          lengthCm: 10,
          breadthCm: 10,
          heightCm: 10,
          actualWeightKg: 1.0,
        }),
      });

      const res = await calculateHandler(req);
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toMatch(/drop pincode 888888 is not serviceable/i);
    });

    it('should return 400 Bad Request for zero or negative package dimensions', async () => {
      const req = new NextRequest('http://localhost:3000/api/rates/calculate', {
        method: 'POST',
        body: JSON.stringify({
          pickupPincode: '560001',
          dropPincode: '560024',
          customerType: 'B2C',
          lengthCm: -10,
          breadthCm: 20,
          heightCm: 10,
          actualWeightKg: 1.0,
        }),
      });

      const res = await calculateHandler(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe('Validation failed');
      expect(json.details).toBeDefined();
    });

    it('should return 400 Bad Request for malformed JSON body', async () => {
      const req = new NextRequest('http://localhost:3000/api/rates/calculate', {
        method: 'POST',
        body: 'invalid-json-content',
      });

      const res = await calculateHandler(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe('Invalid JSON body');
    });
  });

  describe('2. Runtime Dynamic Rate Card Updates & Zero-Restart Recalculation', () => {
    it('should immediately reflect updated rate card parameters without requiring server restarts', async () => {
      const payload = {
        pickupPincode: '560001',
        dropPincode: '560024',
        customerType: 'B2C',
        lengthCm: 10,
        breadthCm: 10,
        heightCm: 10,
        actualWeightKg: 1.5, // excess = 1.0 kg
        isCod: false,
      };

      // Step 1: Initial rate calculation
      const reqA = new NextRequest('http://localhost:3000/api/rates/calculate', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const resA = await calculateHandler(reqA);
      const jsonA = await resA.json();
      expect(resA.status).toBe(200);
      const initialTotal = jsonA.totalAmount; // 40 + (1.0 * 20) = 60.0

      // Step 2: Admin updates Rate Card dynamically via API
      const rateCard = await prisma.rateCard.findFirst({
        where: { zoneType: 'INTRA_ZONE', customerType: 'B2C', isActive: true },
      });
      expect(rateCard).not.toBeNull();

      const originalBaseRate = rateCard!.baseRate;
      const originalPerKgRate = rateCard!.perKgRate;

      const updateReq = new NextRequest(`http://localhost:3000/api/rates/cards/${rateCard!.id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          baseRate: 55.0,
          perKgRate: 35.0,
        }),
      });

      const updateRes = await putRateCardHandler(updateReq, { params: { id: rateCard!.id } });
      expect(updateRes.status).toBe(200);

      // Step 3: Immediate recalculation with IDENTICAL inputs
      const reqB = new NextRequest('http://localhost:3000/api/rates/calculate', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const resB = await calculateHandler(reqB);
      const jsonB = await resB.json();

      expect(resB.status).toBe(200);
      expect(jsonB.baseRate).toBe(55.0);
      expect(jsonB.perKgRate).toBe(35.0);
      expect(jsonB.totalAmount).toBe(90.0); // 55 + (1.0 * 35) = 90.0
      expect(jsonB.totalAmount).not.toBe(initialTotal);

      // Step 4: Revert rate card to preserve test isolation
      await prisma.rateCard.update({
        where: { id: rateCard!.id },
        data: { baseRate: originalBaseRate, perKgRate: originalPerKgRate },
      });
    });
  });

  describe('3. Admin RBAC Authorization Guards', () => {
    it('should reject unauthenticated requests to POST /api/zones (401)', async () => {
      const req = new NextRequest('http://localhost:3000/api/zones', {
        method: 'POST',
        body: JSON.stringify({ name: 'Unauth Zone', code: 'ZONE_UNAUTH' }),
      });
      const res = await postZonesHandler(req);
      expect(res.status).toBe(401);
    });

    it('should reject CUSTOMER requests to POST /api/zones (403)', async () => {
      const req = new NextRequest('http://localhost:3000/api/zones', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerToken}` },
        body: JSON.stringify({ name: 'Customer Zone', code: 'ZONE_CUST' }),
      });
      const res = await postZonesHandler(req);
      expect(res.status).toBe(403);
    });

    it('should reject AGENT requests to POST /api/zones (403)', async () => {
      const req = new NextRequest('http://localhost:3000/api/zones', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ name: 'Agent Zone', code: 'ZONE_AG' }),
      });
      const res = await postZonesHandler(req);
      expect(res.status).toBe(403);
    });

    it('should reject CUSTOMER requests to POST /api/rates/cards (403)', async () => {
      const req = new NextRequest('http://localhost:3000/api/rates/cards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${customerToken}` },
        body: JSON.stringify({
          zoneType: 'INTRA_ZONE',
          customerType: 'B2C',
          baseRate: 50,
          perKgRate: 25,
        }),
      });
      const res = await postRateCardsHandler(req);
      expect(res.status).toBe(403);
    });

    it('should reject AGENT requests to POST /api/pincodes/bulk (403)', async () => {
      const req = new NextRequest('http://localhost:3000/api/pincodes/bulk', {
        method: 'POST',
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({
          items: [{ pincode: '560888', zoneId: 'some_id' }],
        }),
      });
      const res = await postBulkPincodesHandler(req);
      expect(res.status).toBe(403);
    });
  });

  describe('4. Dynamic Zone, Pincode & Rate Card CRUD Management (Admin)', () => {
    let createdZoneId: string;
    let createdRateCardId: string;
    const testZoneCode = `ZONE_INT_TEST_${Date.now()}`;
    const testPincode = '560950';

    it('should allow Admin to create a new Zone (201)', async () => {
      const req = new NextRequest('http://localhost:3000/api/zones', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          name: `Integration Test Zone ${Date.now()}`,
          code: testZoneCode,
          description: 'Created by automated integration test suite',
          isActive: true,
        }),
      });

      const res = await postZonesHandler(req);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.zone).toBeDefined();
      expect(json.zone.code).toBe(testZoneCode);
      createdZoneId = json.zone.id;
    });

    it('should reject duplicate Zone code or name (409 Conflict)', async () => {
      const req = new NextRequest('http://localhost:3000/api/zones', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          name: `Duplicate Test Zone ${Date.now()}`,
          code: testZoneCode, // Existing code
          isActive: true,
        }),
      });

      const res = await postZonesHandler(req);
      expect(res.status).toBe(409);
    });

    it('should allow Admin to map a new Pincode to the created Zone (201)', async () => {
      const req = new NextRequest('http://localhost:3000/api/pincodes', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          pincode: testPincode,
          areaName: 'Integration Test Pincode Area',
          zoneId: createdZoneId,
        }),
      });

      const res = await postPincodesHandler(req);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.pincodeMapping.pincode).toBe(testPincode);
      expect(json.pincodeMapping.zoneId).toBe(createdZoneId);
    });

    it('should allow fast serviceability lookup for the new Pincode (200)', async () => {
      const req = new NextRequest(`http://localhost:3000/api/pincodes/${testPincode}/zone`);
      const res = await getPincodeZoneHandler(req, { params: { pincode: testPincode } });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.serviceable).toBe(true);
      expect(json.zone.code).toBe(testZoneCode);
    });

    it('should allow Admin to bulk import pincodes via atomic transaction (201)', async () => {
      const bulkPincodes = [
        { pincode: '560951', areaName: 'Bulk Area 1', zoneId: createdZoneId },
        { pincode: '560952', areaName: 'Bulk Area 2', zoneId: createdZoneId },
        { pincode: '560953', areaName: 'Bulk Area 3', zoneId: createdZoneId },
      ];

      const req = new NextRequest('http://localhost:3000/api/pincodes/bulk', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ items: bulkPincodes }),
      });

      const res = await postBulkPincodesHandler(req);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.success).toBe(true);
      expect(json.count).toBe(3);

      // Verify in DB
      const count = await prisma.pincodeMapping.count({
        where: { pincode: { in: ['560951', '560952', '560953'] } },
      });
      expect(count).toBe(3);
    });

    it('should allow Admin to create a new Rate Card and deactivate previous active card (201)', async () => {
      const req = new NextRequest('http://localhost:3000/api/rates/cards', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          zoneType: 'INTRA_ZONE',
          customerType: 'B2C',
          baseWeightKg: 0.5,
          baseRate: 45.0,
          perKgRate: 22.0,
          volumetricDivisor: 5000,
          codFixedSurcharge: 25.0,
          codPercentSurcharge: 1.5,
          minCodSurcharge: 30.0,
          isActive: true,
        }),
      });

      const res = await postRateCardsHandler(req);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.rateCard.baseRate).toBe(45.0);
      createdRateCardId = json.rateCard.id;

      // Verify only 1 active card exists for INTRA_ZONE / B2C
      const activeCards = await prisma.rateCard.findMany({
        where: { zoneType: 'INTRA_ZONE', customerType: 'B2C', isActive: true },
      });
      expect(activeCards.length).toBe(1);
      expect(activeCards[0].id).toBe(createdRateCardId);
    });

    it('should allow Admin to update and delete the test rate card and cleanup', async () => {
      // 1. Update rate card
      const updateReq = new NextRequest(`http://localhost:3000/api/rates/cards/${createdRateCardId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ baseRate: 48.0 }),
      });
      const updateRes = await putRateCardHandler(updateReq, { params: { id: createdRateCardId } });
      expect(updateRes.status).toBe(200);

      // 2. Delete test rate card
      const delRateReq = new NextRequest(`http://localhost:3000/api/rates/cards/${createdRateCardId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const delRateRes = await deleteRateCardHandler(delRateReq, { params: { id: createdRateCardId } });
      expect(delRateRes.status).toBe(200);

      // 3. Reactivate original rate card
      const originalCard = await prisma.rateCard.findFirst({
        where: { zoneType: 'INTRA_ZONE', customerType: 'B2C' },
        orderBy: { createdAt: 'asc' },
      });
      if (originalCard) {
        await prisma.rateCard.update({
          where: { id: originalCard.id },
          data: { isActive: true },
        });
      }

      // 4. Delete mapped test pincodes
      await prisma.pincodeMapping.deleteMany({
        where: { pincode: { in: [testPincode, '560951', '560952', '560953'] } },
      });

      // 5. Delete test zone
      const delZoneReq = new NextRequest(`http://localhost:3000/api/zones/${createdZoneId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const delZoneRes = await deleteZoneHandler(delZoneReq, { params: { id: createdZoneId } });
      expect(delZoneRes.status).toBe(200);
    });
  });

  describe('5. Zone & Pincode Listing and Search Queries', () => {
    it('should list all active zones for customers / agents', async () => {
      const req = new NextRequest('http://localhost:3000/api/zones', {
        headers: { Authorization: `Bearer ${customerToken}` },
      });
      const res = await getZonesHandler(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.zones).toBeDefined();
      expect(Array.isArray(json.zones)).toBe(true);
      expect(json.zones.length).toBeGreaterThanOrEqual(4);
    });

    it('should search zones by name or code', async () => {
      const req = new NextRequest('http://localhost:3000/api/zones?search=North', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const res = await getZonesHandler(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.zones.some((z: any) => z.code === 'ZONE_NORTH')).toBe(true);
    });

    it('should paginate pincode mappings and filter by search term', async () => {
      const req = new NextRequest('http://localhost:3000/api/pincodes?search=Koramangala&limit=10&page=1', {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const res = await getPincodesHandler(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.pincodes).toBeDefined();
      expect(json.pagination).toBeDefined();
      expect(json.pincodes.some((p: any) => p.pincode === '560034')).toBe(true);
    });
  });
});
