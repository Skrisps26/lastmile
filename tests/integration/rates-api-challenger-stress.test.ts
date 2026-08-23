// /home/skrisps/lastmile/tests/integration/rates-api-challenger-stress.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { POST as calculateHandler } from '@/app/api/rates/calculate/route';
import { POST as postRateCardsHandler } from '@/app/api/rates/cards/route';
import { DELETE as deleteRateCardHandler } from '@/app/api/rates/cards/[id]/route';
import { createSessionToken } from '@/lib/auth/jwt';

describe('Adversarial Challenger Integration Suite: Rates API & System Boundaries (M2-R1)', () => {
  let adminToken: string;
  let customerToken: string;

  beforeAll(async () => {
    adminToken = await createSessionToken({
      userId: 'test_admin_challenger_id',
      email: 'admin.challenger@lastmile.local',
      role: 'ADMIN',
      name: 'Challenger Admin',
    });

    customerToken = await createSessionToken({
      userId: 'test_cust_challenger_id',
      email: 'customer.challenger@lastmile.local',
      role: 'CUSTOMER',
      name: 'Challenger Customer',
    });
  });

  // =========================================================================
  // 1. API Level Weight Ties & High Precision
  // =========================================================================
  describe('1. API Level Weight Ties & High Precision Endpoints', () => {
    it('should calculate exact 1.0kg tie via API: 10x10x50 cm, 1.0kg actual', async () => {
      const req = new NextRequest('http://localhost:3000/api/rates/calculate', {
        method: 'POST',
        body: JSON.stringify({
          pickupPincode: '560001',
          dropPincode: '560024',
          customerType: 'B2C',
          lengthCm: 10,
          breadthCm: 10,
          heightCm: 50,
          actualWeightKg: 1.0,
          isCod: false,
        }),
      });

      const res = await calculateHandler(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.actualWeightKg).toBe(1.0);
      expect(json.volumetricWeightKg).toBe(1.0);
      expect(json.billableWeightKg).toBe(1.0);
      expect(json.excessWeightKg).toBe(0.5); // 1.0 - 0.5
      expect(json.basePrice).toBe(40.0);
      expect(json.weightPrice).toBe(10.0);
      expect(json.totalAmount).toBe(50.0);
    });

    it('should calculate exact fractional weights and decimal precision via API', async () => {
      const req = new NextRequest('http://localhost:3000/api/rates/calculate', {
        method: 'POST',
        body: JSON.stringify({
          pickupPincode: '560001',
          dropPincode: '560034', // Inter-zone (ZONE_NORTH -> ZONE_SOUTH)
          customerType: 'B2C',
          lengthCm: 25.5,
          breadthCm: 15.2,
          heightCm: 12.8, // 4961.28 / 5000 = 0.992256 -> 0.99 kg
          actualWeightKg: 1.33, // Billable = 1.33 kg
          isCod: true,
          codAmount: 1999.99, // Inter B2C: fixed 40, pct 2% of 1999.99 = 40.00, sum = 80.00
        }),
      });

      const res = await calculateHandler(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.zoneType).toBe('INTER_ZONE');
      expect(json.volumetricWeightKg).toBe(0.99);
      expect(json.billableWeightKg).toBe(1.33);
      expect(json.excessWeightKg).toBe(0.83); // 1.33 - 0.5
      expect(json.basePrice).toBe(75.0);
      expect(json.weightPrice).toBe(33.2); // 0.83 * 40 = 33.20
      expect(json.codSurcharge).toBe(80.0); // 40 + 40.00
      expect(json.totalAmount).toBe(188.2); // 75 + 33.2 + 80.00
    });
  });

  // =========================================================================
  // 2. Custom Divisors & Extreme Payloads via API
  // =========================================================================
  describe('2. Custom Divisors & Extreme Payloads via API', () => {
    it('should respect custom volumetricDivisor override in API request (4000 vs 5000)', async () => {
      const payloadStandard = {
        pickupPincode: '560001',
        dropPincode: '560024',
        customerType: 'B2C',
        lengthCm: 20,
        breadthCm: 20,
        heightCm: 20, // 8000 cm3
        actualWeightKg: 1.0,
      };

      // 1. Standard (default 5000) -> 8000 / 5000 = 1.6 kg
      const req5000 = new NextRequest('http://localhost:3000/api/rates/calculate', {
        method: 'POST',
        body: JSON.stringify(payloadStandard),
      });
      const res5000 = await calculateHandler(req5000);
      const json5000 = await res5000.json();
      expect(json5000.volumetricDivisor).toBe(5000);
      expect(json5000.volumetricWeightKg).toBe(1.6);
      expect(json5000.totalAmount).toBe(62.0); // 40 + (1.1 * 20) = 62.0

      // 2. Override with 4000 -> 8000 / 4000 = 2.0 kg
      const req4000 = new NextRequest('http://localhost:3000/api/rates/calculate', {
        method: 'POST',
        body: JSON.stringify({
          ...payloadStandard,
          volumetricDivisor: 4000,
        }),
      });
      const res4000 = await calculateHandler(req4000);
      const json4000 = await res4000.json();
      expect(json4000.volumetricDivisor).toBe(4000);
      expect(json4000.volumetricWeightKg).toBe(2.0);
      expect(json4000.totalAmount).toBe(70.0); // 40 + (1.5 * 20) = 70.0
    });

    it('should handle extreme dimensions (500cm) and weights (1000kg) via API', async () => {
      const req = new NextRequest('http://localhost:3000/api/rates/calculate', {
        method: 'POST',
        body: JSON.stringify({
          pickupPincode: '560001',
          dropPincode: '560024',
          customerType: 'B2C',
          lengthCm: 500,
          breadthCm: 200,
          heightCm: 100, // 10,000,000 / 5000 = 2000 kg
          actualWeightKg: 1000,
          isCod: false,
        }),
      });

      const res = await calculateHandler(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.volumetricWeightKg).toBe(2000.0);
      expect(json.billableWeightKg).toBe(2000.0);
      expect(json.excessWeightKg).toBe(1999.5);
      expect(json.weightPrice).toBe(39990.0); // 1999.5 * 20
      expect(json.totalAmount).toBe(40030.0); // 40 + 39990
    });

    it('should handle massive COD amounts (e.g. ₹5,000,000) via API', async () => {
      const req = new NextRequest('http://localhost:3000/api/rates/calculate', {
        method: 'POST',
        body: JSON.stringify({
          pickupPincode: '560001',
          dropPincode: '560024',
          customerType: 'B2C',
          lengthCm: 10,
          breadthCm: 10,
          heightCm: 10,
          actualWeightKg: 0.5,
          isCod: true,
          codAmount: 5000000.0, // Fixed 25 + 1.5% of 5,000,000 = 75,000 -> 75,025
        }),
      });

      const res = await calculateHandler(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.codSurcharge).toBe(75025.0);
      expect(json.totalAmount).toBe(75065.0); // 40 + 75025
    });
  });

  // =========================================================================
  // 3. Concurrency & High-Throughput Burst Calculations
  // =========================================================================
  describe('3. Concurrency & High-Throughput Burst Calculations', () => {
    it('should handle 50 concurrent rate calculation requests consistently', async () => {
      const requests = Array.from({ length: 50 }, (_, i) => {
        const isB2B = i % 2 === 0;
        return new NextRequest('http://localhost:3000/api/rates/calculate', {
          method: 'POST',
          body: JSON.stringify({
            pickupPincode: '560001',
            dropPincode: i % 3 === 0 ? '560024' : '560034',
            customerType: isB2B ? 'B2B' : 'B2C',
            lengthCm: 10 + (i % 15),
            breadthCm: 10 + (i % 10),
            heightCm: 10 + (i % 8),
            actualWeightKg: 0.5 + (i * 0.1),
            isCod: i % 4 === 0,
            codAmount: 1000,
          }),
        });
      });

      const responses = await Promise.all(requests.map((r) => calculateHandler(r)));

      expect(responses.length).toBe(50);
      for (const res of responses) {
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.totalAmount).toBeGreaterThan(0);
        expect(json.totalAmount).toBe(json.breakdown.totalAmount);
      }
    });
  });
});
