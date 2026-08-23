// /home/skrisps/lastmile/tests/integration/rates-and-zones-stress.test.ts

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
import { calculateVolumetricWeight, calculateBillableWeight, calculateWeightPrice, calculateCodSurcharge, calculateRate } from '@/lib/rate-engine/calculator';

describe('Adversarial Empirical Stress Suite: M2 Zones, Pincodes & Dynamic Rate Engine', () => {
  let adminToken: string;
  let customerToken: string;
  let agentToken: string;
  let expiredToken: string;
  let forgedToken: string;

  // Cleanup tracking
  const createdZoneIds: string[] = [];
  const createdPincodes: string[] = [];
  const createdRateCardIds: string[] = [];

  beforeAll(async () => {
    adminToken = await createSessionToken({
      userId: 'stress_admin_id',
      email: 'stress.admin@lastmile.local',
      role: 'ADMIN',
      name: 'Stress Admin',
    });

    customerToken = await createSessionToken({
      userId: 'stress_customer_id',
      email: 'stress.customer@lastmile.local',
      role: 'CUSTOMER',
      name: 'Stress Customer',
    });

    agentToken = await createSessionToken({
      userId: 'stress_agent_id',
      email: 'stress.agent@lastmile.local',
      role: 'AGENT',
      name: 'Stress Agent',
    });

    // Manually create expired token (1 hour in past)
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback-secret-for-tests-only-do-not-use-in-production-min-32-chars');
    expiredToken = await new SignJWT({
      userId: 'expired_user_id',
      email: 'expired@lastmile.local',
      role: 'ADMIN',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(secret);

    // Forged token with invalid signature
    const wrongSecret = new TextEncoder().encode('wrong-secret-key-that-does-not-match-jwt-secret-min-32-chars');
    forgedToken = await new SignJWT({
      userId: 'forged_admin_id',
      email: 'forged.admin@lastmile.local',
      role: 'ADMIN',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1d')
      .sign(wrongSecret);
  });

  afterAll(async () => {
    // Cleanup any remaining entities created during tests
    if (createdPincodes.length > 0) {
      await prisma.pincodeMapping.deleteMany({
        where: { pincode: { in: createdPincodes } },
      }).catch(() => {});
    }
    if (createdRateCardIds.length > 0) {
      await prisma.rateCard.deleteMany({
        where: { id: { in: createdRateCardIds } },
      }).catch(() => {});
    }
    if (createdZoneIds.length > 0) {
      await prisma.zone.deleteMany({
        where: { id: { in: createdZoneIds } },
      }).catch(() => {});
    }
  });

  // =========================================================================
  // TASK 1.1: Unmapped Pickup or Drop Pincodes Returning Descriptive 404s
  // =========================================================================
  describe('1. Unmapped & Inactive Pincode Serviceability (404 Descriptive Responses)', () => {
    let inactiveZoneId: string;
    const inactivePincode = '560980';

    beforeAll(async () => {
      // Create an inactive zone with a mapped pincode
      const zone = await prisma.zone.create({
        data: {
          name: 'Inactive Test Zone',
          code: `INACTIVE_ZONE_${Date.now()}`,
          isActive: false,
        },
      });
      inactiveZoneId = zone.id;
      createdZoneIds.push(zone.id);

      await prisma.pincodeMapping.create({
        data: {
          pincode: inactivePincode,
          areaName: 'Inactive Area',
          zoneId: zone.id,
        },
      });
      createdPincodes.push(inactivePincode);
    });

    it('1.1 should return 404 with descriptive error when pickup pincode does not exist in mapping table', async () => {
      const req = new NextRequest('http://localhost:3000/api/rates/calculate', {
        method: 'POST',
        body: JSON.stringify({
          pickupPincode: '999999',
          dropPincode: '560001',
          customerType: 'B2C',
          lengthCm: 20,
          breadthCm: 20,
          heightCm: 10,
          actualWeightKg: 1.0,
        }),
      });

      const res = await calculateHandler(req);
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toBeDefined();
      expect(json.error).toMatch(/pickup pincode 999999 is not serviceable/i);
    });

    it('1.2 should return 404 with descriptive error when drop pincode does not exist in mapping table', async () => {
      const req = new NextRequest('http://localhost:3000/api/rates/calculate', {
        method: 'POST',
        body: JSON.stringify({
          pickupPincode: '560001',
          dropPincode: '888888',
          customerType: 'B2C',
          lengthCm: 20,
          breadthCm: 20,
          heightCm: 10,
          actualWeightKg: 1.0,
        }),
      });

      const res = await calculateHandler(req);
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toBeDefined();
      expect(json.error).toMatch(/drop pincode 888888 is not serviceable/i);
    });

    it('1.3 should return 404 fail-fast when BOTH pickup and drop pincodes are unmapped', async () => {
      const req = new NextRequest('http://localhost:3000/api/rates/calculate', {
        method: 'POST',
        body: JSON.stringify({
          pickupPincode: '999999',
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
      expect(json.error).toMatch(/pickup pincode 999999 is not serviceable/i);
    });

    it('1.4 should return 404 when pickup pincode belongs to an INACTIVE zone', async () => {
      const req = new NextRequest('http://localhost:3000/api/rates/calculate', {
        method: 'POST',
        body: JSON.stringify({
          pickupPincode: inactivePincode,
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
      expect(json.error).toMatch(/pickup pincode 560980 is not serviceable/i);
    });

    it('1.5 should return 404 when drop pincode belongs to an INACTIVE zone', async () => {
      const req = new NextRequest('http://localhost:3000/api/rates/calculate', {
        method: 'POST',
        body: JSON.stringify({
          pickupPincode: '560001',
          dropPincode: inactivePincode,
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
      expect(json.error).toMatch(/drop pincode 560980 is not serviceable/i);
    });

    it('1.6 should return 404 on fast serviceability check GET /api/pincodes/:pincode/zone for unmapped pincode', async () => {
      const req = new NextRequest('http://localhost:3000/api/pincodes/000000/zone');
      const res = await getPincodeZoneHandler(req, { params: { pincode: '000000' } });
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.serviceable).toBe(false);
      expect(json.error).toMatch(/not currently serviceable/i);
    });

    it('1.7 should return 404 on fast serviceability check GET /api/pincodes/:pincode/zone for pincode in inactive zone', async () => {
      const req = new NextRequest(`http://localhost:3000/api/pincodes/${inactivePincode}/zone`);
      const res = await getPincodeZoneHandler(req, { params: { pincode: inactivePincode } });
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.serviceable).toBe(false);
      expect(json.error).toMatch(/not currently serviceable/i);
    });
  });

  // =========================================================================
  // TASK 1.2: Negative/Zero Dimensions and Weights Returning 400 Bad Request
  // =========================================================================
  describe('2. Negative/Zero Dimensions & Weights Validation (400 Bad Request)', () => {
    const validBasePayload = {
      pickupPincode: '560001',
      dropPincode: '560024',
      customerType: 'B2C',
      lengthCm: 20,
      breadthCm: 15,
      heightCm: 10,
      actualWeightKg: 1.5,
      isCod: false,
    };

    it('2.1 should reject lengthCm = 0 with 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost:3000/api/rates/calculate', {
        method: 'POST',
        body: JSON.stringify({ ...validBasePayload, lengthCm: 0 }),
      });
      const res = await calculateHandler(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe('Validation failed');
      expect(json.details.lengthCm).toBeDefined();
      expect(json.details.lengthCm[0]).toMatch(/strictly greater than 0/i);
    });

    it('2.2 should reject lengthCm < 0 with 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost:3000/api/rates/calculate', {
        method: 'POST',
        body: JSON.stringify({ ...validBasePayload, lengthCm: -15.5 }),
      });
      const res = await calculateHandler(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.details.lengthCm).toBeDefined();
    });

    it('2.3 should reject breadthCm = 0 and breadthCm < 0 with 400 Bad Request', async () => {
      for (const val of [0, -1, -50.2]) {
        const req = new NextRequest('http://localhost:3000/api/rates/calculate', {
          method: 'POST',
          body: JSON.stringify({ ...validBasePayload, breadthCm: val }),
        });
        const res = await calculateHandler(req);
        const json = await res.json();

        expect(res.status).toBe(400);
        expect(json.details.breadthCm).toBeDefined();
      }
    });

    it('2.4 should reject heightCm = 0 and heightCm < 0 with 400 Bad Request', async () => {
      for (const val of [0, -0.01, -100]) {
        const req = new NextRequest('http://localhost:3000/api/rates/calculate', {
          method: 'POST',
          body: JSON.stringify({ ...validBasePayload, heightCm: val }),
        });
        const res = await calculateHandler(req);
        const json = await res.json();

        expect(res.status).toBe(400);
        expect(json.details.heightCm).toBeDefined();
      }
    });

    it('2.5 should reject actualWeightKg = 0 with 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost:3000/api/rates/calculate', {
        method: 'POST',
        body: JSON.stringify({ ...validBasePayload, actualWeightKg: 0 }),
      });
      const res = await calculateHandler(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.details.actualWeightKg).toBeDefined();
      expect(json.details.actualWeightKg[0]).toMatch(/strictly greater than 0/i);
    });

    it('2.6 should reject actualWeightKg < 0 with 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost:3000/api/rates/calculate', {
        method: 'POST',
        body: JSON.stringify({ ...validBasePayload, actualWeightKg: -2.5 }),
      });
      const res = await calculateHandler(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.details.actualWeightKg).toBeDefined();
    });

    it('2.7 should reject negative codAmount with 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost:3000/api/rates/calculate', {
        method: 'POST',
        body: JSON.stringify({ ...validBasePayload, isCod: true, codAmount: -500 }),
      });
      const res = await calculateHandler(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.details.codAmount).toBeDefined();
    });

    it('2.8 should reject negative declaredValue with 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost:3000/api/rates/calculate', {
        method: 'POST',
        body: JSON.stringify({ ...validBasePayload, declaredValue: -1000 }),
      });
      const res = await calculateHandler(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.details.declaredValue).toBeDefined();
    });

    it('2.9 should reject zero or negative custom volumetricDivisor with 400 Bad Request', async () => {
      for (const divisor of [0, -5000]) {
        const req = new NextRequest('http://localhost:3000/api/rates/calculate', {
          method: 'POST',
          body: JSON.stringify({ ...validBasePayload, volumetricDivisor: divisor }),
        });
        const res = await calculateHandler(req);
        const json = await res.json();

        expect(res.status).toBe(400);
        expect(json.details.volumetricDivisor).toBeDefined();
      }
    });

    it('2.10 should reject invalid customerType with 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost:3000/api/rates/calculate', {
        method: 'POST',
        body: JSON.stringify({ ...validBasePayload, customerType: 'ENTERPRISE' }),
      });
      const res = await calculateHandler(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.details.customerType).toBeDefined();
    });

    it('2.11 should reject missing required fields (empty object) with 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost:3000/api/rates/calculate', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const res = await calculateHandler(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.details.pickupPincode).toBeDefined();
      expect(json.details.dropPincode).toBeDefined();
      expect(json.details.lengthCm).toBeDefined();
      expect(json.details.breadthCm).toBeDefined();
      expect(json.details.heightCm).toBeDefined();
      expect(json.details.actualWeightKg).toBeDefined();
    });

    it('2.12 should reject non-numeric string representations for dimensions with 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost:3000/api/rates/calculate', {
        method: 'POST',
        body: JSON.stringify({
          ...validBasePayload,
          lengthCm: 'twenty',
          actualWeightKg: 'five_kg',
        }),
      });
      const res = await calculateHandler(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.details.lengthCm).toBeDefined();
      expect(json.details.actualWeightKg).toBeDefined();
    });
  });

  // =========================================================================
  // TASK 1.3: Non-Admin Attempts to Mutate Zones, Pincodes, Rate Cards -> 403 Forbidden
  // =========================================================================
  describe('3. RBAC Security & Non-Admin Mutation Protection (403 Forbidden / 401 Unauthorized)', () => {
    let dummyZoneId: string;
    let dummyPincodeId: string;
    let dummyRateCardId: string;

    beforeAll(async () => {
      // Create test resources as Admin
      const zone = await prisma.zone.create({
        data: {
          name: 'RBAC Guard Test Zone',
          code: `ZONE_RBAC_${Date.now()}`,
          isActive: true,
        },
      });
      dummyZoneId = zone.id;
      createdZoneIds.push(zone.id);

      const pincode = await prisma.pincodeMapping.create({
        data: {
          pincode: '560988',
          areaName: 'RBAC Pincode Area',
          zoneId: dummyZoneId,
        },
      });
      dummyPincodeId = pincode.id;
      createdPincodes.push('560988');

      const rateCard = await prisma.rateCard.create({
        data: {
          zoneType: 'INTRA_ZONE',
          customerType: 'B2B',
          baseWeightKg: 1.0,
          baseRate: 50.0,
          perKgRate: 20.0,
          volumetricDivisor: 5000,
          isActive: false, // Inactive so it doesn't collide with active rate cards
        },
      });
      dummyRateCardId = rateCard.id;
      createdRateCardIds.push(rateCard.id);
    });

    describe('3.1 Zones Mutation RBAC', () => {
      it('POST /api/zones: should return 401 for unauthenticated request', async () => {
        const req = new NextRequest('http://localhost:3000/api/zones', {
          method: 'POST',
          body: JSON.stringify({ name: 'Hacker Zone', code: 'ZONE_HACK' }),
        });
        const res = await postZonesHandler(req);
        expect(res.status).toBe(401);
      });

      it('POST /api/zones: should return 403 for CUSTOMER and AGENT', async () => {
        for (const token of [customerToken, agentToken]) {
          const req = new NextRequest('http://localhost:3000/api/zones', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: JSON.stringify({ name: 'Hacker Zone', code: `ZONE_HACK_${Date.now()}` }),
          });
          const res = await postZonesHandler(req);
          expect(res.status).toBe(403);
        }
      });

      it('PUT /api/zones/:id: should return 403 for CUSTOMER and AGENT', async () => {
        for (const token of [customerToken, agentToken]) {
          const req = new NextRequest(`http://localhost:3000/api/zones/${dummyZoneId}`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}` },
            body: JSON.stringify({ name: 'Mutated By Non-Admin' }),
          });
          const res = await putZoneHandler(req, { params: { id: dummyZoneId } });
          expect(res.status).toBe(403);
        }
      });

      it('DELETE /api/zones/:id: should return 403 for CUSTOMER and AGENT', async () => {
        for (const token of [customerToken, agentToken]) {
          const req = new NextRequest(`http://localhost:3000/api/zones/${dummyZoneId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });
          const res = await deleteZoneHandler(req, { params: { id: dummyZoneId } });
          expect(res.status).toBe(403);
        }
      });
    });

    describe('3.2 Pincodes & Bulk Pincodes Mutation RBAC', () => {
      it('POST /api/pincodes: should return 403 for CUSTOMER and AGENT', async () => {
        for (const token of [customerToken, agentToken]) {
          const req = new NextRequest('http://localhost:3000/api/pincodes', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: JSON.stringify({ pincode: '560989', zoneId: dummyZoneId }),
          });
          const res = await postPincodesHandler(req);
          expect(res.status).toBe(403);
        }
      });

      it('POST /api/pincodes/bulk: should return 403 for CUSTOMER and AGENT', async () => {
        for (const token of [customerToken, agentToken]) {
          const req = new NextRequest('http://localhost:3000/api/pincodes/bulk', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              items: [{ pincode: '560989', zoneId: dummyZoneId }],
            }),
          });
          const res = await postBulkPincodesHandler(req);
          expect(res.status).toBe(403);
        }
      });

      it('PUT /api/pincodes/:id: should return 403 for CUSTOMER and AGENT', async () => {
        for (const token of [customerToken, agentToken]) {
          const req = new NextRequest(`http://localhost:3000/api/pincodes/${dummyPincodeId}`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}` },
            body: JSON.stringify({ areaName: 'Malicious Update' }),
          });
          const res = await putPincodeHandler(req, { params: { id: dummyPincodeId } });
          expect(res.status).toBe(403);
        }
      });

      it('DELETE /api/pincodes/:id: should return 403 for CUSTOMER and AGENT', async () => {
        for (const token of [customerToken, agentToken]) {
          const req = new NextRequest(`http://localhost:3000/api/pincodes/${dummyPincodeId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });
          const res = await deletePincodeHandler(req, { params: { id: dummyPincodeId } });
          expect(res.status).toBe(403);
        }
      });
    });

    describe('3.3 Rate Cards Mutation RBAC', () => {
      it('POST /api/rates/cards: should return 403 for CUSTOMER and AGENT', async () => {
        for (const token of [customerToken, agentToken]) {
          const req = new NextRequest('http://localhost:3000/api/rates/cards', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              zoneType: 'INTRA_ZONE',
              customerType: 'B2C',
              baseRate: 10,
              perKgRate: 5,
            }),
          });
          const res = await postRateCardsHandler(req);
          expect(res.status).toBe(403);
        }
      });

      it('PUT /api/rates/cards/:id: should return 403 for CUSTOMER and AGENT', async () => {
        for (const token of [customerToken, agentToken]) {
          const req = new NextRequest(`http://localhost:3000/api/rates/cards/${dummyRateCardId}`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}` },
            body: JSON.stringify({ baseRate: 1.0 }),
          });
          const res = await putRateCardHandler(req, { params: { id: dummyRateCardId } });
          expect(res.status).toBe(403);
        }
      });

      it('DELETE /api/rates/cards/:id: should return 403 for CUSTOMER and AGENT', async () => {
        for (const token of [customerToken, agentToken]) {
          const req = new NextRequest(`http://localhost:3000/api/rates/cards/${dummyRateCardId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });
          const res = await deleteRateCardHandler(req, { params: { id: dummyRateCardId } });
          expect(res.status).toBe(403);
        }
      });
    });

    describe('3.4 Expired & Forged Token Rejection', () => {
      it('should reject expired JWT tokens with 401 Unauthorized', async () => {
        const req = new NextRequest('http://localhost:3000/api/zones', {
          method: 'POST',
          headers: { Authorization: `Bearer ${expiredToken}` },
          body: JSON.stringify({ name: 'Expired Test', code: 'ZONE_EXP' }),
        });
        const res = await postZonesHandler(req);
        expect(res.status).toBe(401);
      });

      it('should reject forged/invalid signature JWT tokens with 401 Unauthorized', async () => {
        const req = new NextRequest('http://localhost:3000/api/zones', {
          method: 'POST',
          headers: { Authorization: `Bearer ${forgedToken}` },
          body: JSON.stringify({ name: 'Forged Test', code: 'ZONE_FORGED' }),
        });
        const res = await postZonesHandler(req);
        expect(res.status).toBe(401);
      });
    });
  });

  // =========================================================================
  // TASK 1.4: Bulk Pincode Upload with Duplicate Entries or Invalid Zone IDs
  // =========================================================================
  describe('4. Bulk Pincode Upload Stress & Validation', () => {
    let validZoneId: string;
    let validZoneId2: string;

    beforeAll(async () => {
      const z1 = await prisma.zone.create({
        data: { name: 'Bulk Test Zone 1', code: `ZONE_BULK1_${Date.now()}`, isActive: true },
      });
      validZoneId = z1.id;
      createdZoneIds.push(z1.id);

      const z2 = await prisma.zone.create({
        data: { name: 'Bulk Test Zone 2', code: `ZONE_BULK2_${Date.now()}`, isActive: true },
      });
      validZoneId2 = z2.id;
      createdZoneIds.push(z2.id);
    });

    it('4.1 should return 400 Bad Request when bulk upload references an invalid/non-existent zoneId', async () => {
      const nonExistentZoneId = 'non_existent_zone_cuid_12345';
      const req = new NextRequest('http://localhost:3000/api/pincodes/bulk', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          items: [
            { pincode: '560960', areaName: 'Valid Area', zoneId: validZoneId },
            { pincode: '560961', areaName: 'Invalid Area', zoneId: nonExistentZoneId },
          ],
        }),
      });

      const res = await postBulkPincodesHandler(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toMatch(/referenced zoneid\(s\) do not exist/i);
      expect(json.error).toContain(nonExistentZoneId);

      // Verify atomic rollback: pincode 560960 should NOT have been created
      const checkPincode = await prisma.pincodeMapping.findUnique({
        where: { pincode: '560960' },
      });
      expect(checkPincode).toBeNull();
    });

    it('4.2 should handle bulk upload with duplicate pincodes within the same request array (upsert idempotency)', async () => {
      const testPincode = '560962';
      createdPincodes.push(testPincode);

      // Same pincode mapped first to Zone 1, then overwritten to Zone 2 in the same batch
      const req = new NextRequest('http://localhost:3000/api/pincodes/bulk', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          items: [
            { pincode: testPincode, areaName: 'Original Area', zoneId: validZoneId },
            { pincode: testPincode, areaName: 'Overwritten Area', zoneId: validZoneId2 },
          ],
        }),
      });

      const res = await postBulkPincodesHandler(req);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.success).toBe(true);
      expect(json.count).toBe(2);

      // Verify the final mapping state in the database reflects the last upserted value (Zone 2)
      const mapping = await prisma.pincodeMapping.findUnique({
        where: { pincode: testPincode },
      });
      expect(mapping).not.toBeNull();
      expect(mapping!.zoneId).toBe(validZoneId2);
      expect(mapping!.areaName).toBe('Overwritten Area');
    });

    it('4.3 should update existing pincode mapping cleanly when re-uploaded via bulk endpoint', async () => {
      const testPincode = '560963';
      createdPincodes.push(testPincode);

      // 1. First bulk upload
      const req1 = new NextRequest('http://localhost:3000/api/pincodes/bulk', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          items: [{ pincode: testPincode, areaName: 'Initial Name', zoneId: validZoneId }],
        }),
      });
      const res1 = await postBulkPincodesHandler(req1);
      expect(res1.status).toBe(201);

      // 2. Second bulk upload re-mapping to Zone 2
      const req2 = new NextRequest('http://localhost:3000/api/pincodes/bulk', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          items: [{ pincode: testPincode, areaName: 'Updated Area Name', zoneId: validZoneId2 }],
        }),
      });
      const res2 = await postBulkPincodesHandler(req2);
      const json2 = await res2.json();

      expect(res2.status).toBe(201);
      expect(json2.success).toBe(true);

      const mapping = await prisma.pincodeMapping.findUnique({
        where: { pincode: testPincode },
      });
      expect(mapping!.zoneId).toBe(validZoneId2);
      expect(mapping!.areaName).toBe('Updated Area Name');
    });

    it('4.4 should reject bulk upload with empty items array with 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost:3000/api/pincodes/bulk', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ items: [] }),
      });

      const res = await postBulkPincodesHandler(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.details.items).toBeDefined();
      expect(json.details.items[0]).toMatch(/at least one pincode item/i);
    });

    it('4.5 should reject bulk upload exceeding 500 items limit with 400 Bad Request', async () => {
      const largeItems = Array.from({ length: 501 }, (_, i) => ({
        pincode: `56${String(i).padStart(4, '0')}`,
        zoneId: validZoneId,
      }));

      const req = new NextRequest('http://localhost:3000/api/pincodes/bulk', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ items: largeItems }),
      });

      const res = await postBulkPincodesHandler(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.details.items).toBeDefined();
      expect(json.details.items[0]).toMatch(/maximum 500 items/i);
    });

    it('4.6 should reject bulk upload with malformed pincode strings (< 3 chars or empty)', async () => {
      const req = new NextRequest('http://localhost:3000/api/pincodes/bulk', {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          items: [
            { pincode: '12', zoneId: validZoneId }, // < 3 chars
            { pincode: '', zoneId: validZoneId }, // empty
          ],
        }),
      });

      const res = await postBulkPincodesHandler(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe('Validation failed');
    });
  });

  // =========================================================================
  // TASK 1.5: Pure Rate Engine Boundary Conditions & Mathematical Invariants
  // =========================================================================
  describe('5. Pure Rate Engine Invariants & Edge Cases', () => {
    it('5.1 should handle exact weight ties (actualWeight == volumetricWeight)', () => {
      // 50 x 40 x 25 / 5000 = 50000 / 5000 = 10.0 kg
      const vol = calculateVolumetricWeight(50, 40, 25, 5000);
      expect(vol).toBe(10.0);

      const billable = calculateBillableWeight(10.0, vol);
      expect(billable).toBe(10.0);
    });

    it('5.2 should handle exact base weight boundary (billableWeight == baseWeightKg)', () => {
      const pricing = {
        baseWeightKg: 0.5,
        baseRate: 40.0,
        perKgRate: 20.0,
        volumetricDivisor: 5000,
        codFixedSurcharge: 0,
        codPercentSurcharge: 0,
        minCodSurcharge: 0,
      };

      const result = calculateRate({
        lengthCm: 10,
        breadthCm: 10,
        heightCm: 10, // 0.2 kg vol
        actualWeightKg: 0.5, // 0.5 kg actual -> billable = 0.5 kg
        isCod: false,
        pricing,
      });

      expect(result.billableWeightKg).toBe(0.5);
      expect(result.excessWeightKg).toBe(0.0);
      expect(result.weightPrice).toBe(0.0);
      expect(result.basePrice).toBe(40.0);
      expect(result.totalAmount).toBe(40.0);
    });

    it('5.3 should calculate fractional excess weights with exact 2 decimal precision', () => {
      const pricing = {
        baseWeightKg: 0.5,
        baseRate: 50.0,
        perKgRate: 33.33,
        volumetricDivisor: 5000,
        codFixedSurcharge: 0,
        codPercentSurcharge: 0,
        minCodSurcharge: 0,
      };

      const result = calculateRate({
        lengthCm: 10,
        breadthCm: 10,
        heightCm: 10,
        actualWeightKg: 1.23, // excess = 1.23 - 0.5 = 0.73 kg
        isCod: false,
        pricing,
      });

      expect(result.billableWeightKg).toBe(1.23);
      expect(result.excessWeightKg).toBe(0.73);
      // 0.73 * 33.33 = 24.3309 -> round2 = 24.33
      expect(result.weightPrice).toBe(24.33);
      expect(result.totalAmount).toBe(74.33);
    });

    it('5.4 should enforce COD floor minimum when percentage fee is lower than minCodSurcharge', () => {
      // Fixed 10 + 1% of 500 = 10 + 5 = 15 < min 40 -> codSurcharge should be 40
      const surcharge = calculateCodSurcharge(true, 500, 10, 1.0, 40.0);
      expect(surcharge).toBe(40.0);
    });

    it('5.5 should apply combined fixed + percent fee when above floor', () => {
      // Fixed 20 + 2% of 5000 = 20 + 100 = 120 > min 50 -> codSurcharge should be 120
      const surcharge = calculateCodSurcharge(true, 5000, 20, 2.0, 50.0);
      expect(surcharge).toBe(120.0);
    });

    it('5.6 should return 0 COD surcharge when isCod is false regardless of codAmount or declaredValue', () => {
      const surcharge = calculateCodSurcharge(false, 10000, 50, 5.0, 100.0);
      expect(surcharge).toBe(0.0);
    });

    it('5.7 should return 422 Unprocessable Entity when no active rate card exists for zoneType/customerType', async () => {
      // Query B2B Intra-zone if we ensure no active card or deactivated
      // Let's test with a request for which we temporarily deactivate the rate card
      const activeCard = await prisma.rateCard.findFirst({
        where: { zoneType: 'INTRA_ZONE', customerType: 'B2B', isActive: true },
      });

      if (activeCard) {
        await prisma.rateCard.update({
          where: { id: activeCard.id },
          data: { isActive: false },
        });
      }

      const req = new NextRequest('http://localhost:3000/api/rates/calculate', {
        method: 'POST',
        body: JSON.stringify({
          pickupPincode: '560001',
          dropPincode: '560024',
          customerType: 'B2B',
          lengthCm: 10,
          breadthCm: 10,
          heightCm: 10,
          actualWeightKg: 1.0,
        }),
      });

      const res = await calculateHandler(req);
      const json = await res.json();

      expect(res.status).toBe(422);
      expect(json.error).toMatch(/no active rate card configured for INTRA_ZONE and B2B/i);

      // Re-enable
      if (activeCard) {
        await prisma.rateCard.update({
          where: { id: activeCard.id },
          data: { isActive: true },
        });
      }
    });
  });

  // =========================================================================
  // TASK 1.6: Concurrency & Transaction Integrity Stress Testing
  // =========================================================================
  describe('6. Concurrency & Transactional Stress', () => {
    let concZoneId: string;

    beforeAll(async () => {
      const z = await prisma.zone.create({
        data: { name: 'Concurrent Test Zone', code: `ZONE_CONC_${Date.now()}`, isActive: true },
      });
      concZoneId = z.id;
      createdZoneIds.push(z.id);
    });

    it('6.1 should handle 10 concurrent bulk pincode uploads without deadlock or corruption', async () => {
      const bulkPromises = Array.from({ length: 10 }, (_, i) => {
        const testPincodes = [
          { pincode: `5690${String(i).padStart(2, '0')}`, areaName: `Area ${i}-1`, zoneId: concZoneId },
          { pincode: `5691${String(i).padStart(2, '0')}`, areaName: `Area ${i}-2`, zoneId: concZoneId },
        ];
        testPincodes.forEach((p) => createdPincodes.push(p.pincode));

        const req = new NextRequest('http://localhost:3000/api/pincodes/bulk', {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ items: testPincodes }),
        });

        return postBulkPincodesHandler(req);
      });

      const results = await Promise.all(bulkPromises);
      for (const res of results) {
        expect(res.status).toBe(201);
        const json = await res.json();
        expect(json.success).toBe(true);
        expect(json.count).toBe(2);
      }
    });

    it('6.2 should handle 20 concurrent quotation requests with 100% success and identical deterministic outputs', async () => {
      const quotePromises = Array.from({ length: 20 }, () => {
        const req = new NextRequest('http://localhost:3000/api/rates/calculate', {
          method: 'POST',
          body: JSON.stringify({
            pickupPincode: '560001',
            dropPincode: '560034',
            customerType: 'B2C',
            lengthCm: 25,
            breadthCm: 20,
            heightCm: 15,
            actualWeightKg: 2.0,
            isCod: true,
            codAmount: 2000,
          }),
        });
        return calculateHandler(req);
      });

      const results = await Promise.all(quotePromises);
      const jsonResults = await Promise.all(results.map((r) => r.json()));

      for (let i = 0; i < results.length; i++) {
        expect(results[i].status).toBe(200);
        expect(jsonResults[i].totalAmount).toBe(jsonResults[0].totalAmount);
        expect(jsonResults[i].zoneType).toBe('INTER_ZONE');
      }
    });
  });
});
