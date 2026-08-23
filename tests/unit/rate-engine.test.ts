// /home/skrisps/lastmile/tests/unit/rate-engine.test.ts

import { describe, it, expect } from 'vitest';
import {
  round2,
  calculateVolumetricWeight,
  calculateBillableWeight,
  calculateWeightPrice,
  calculateCodSurcharge,
  calculateRate,
  computeRateQuote,
  assembleRateQuoteBreakdown,
} from '@/lib/rate-engine/calculator';
import { RateCardParameters, RateCardPricingParams } from '@/lib/rate-engine/types';

describe('Unit: Rate Calculation Engine Suite (M2-R1)', () => {
  // Reference Pricing Parameters (Standard Rate Cards)
  const intraB2CRateCard: RateCardParameters = {
    zoneType: 'INTRA_ZONE',
    customerType: 'B2C',
    baseWeightKg: 0.5,
    baseRate: 40.0,
    perKgRate: 20.0,
    volumetricDivisor: 5000.0,
    codFixedSurcharge: 25.0,
    codPercentSurcharge: 1.5,
    minCodSurcharge: 30.0,
  };

  const intraB2BRateCard: RateCardParameters = {
    zoneType: 'INTRA_ZONE',
    customerType: 'B2B',
    baseWeightKg: 0.5,
    baseRate: 30.0,
    perKgRate: 15.0,
    volumetricDivisor: 5000.0,
    codFixedSurcharge: 15.0,
    codPercentSurcharge: 1.0,
    minCodSurcharge: 20.0,
  };

  const interB2CRateCard: RateCardParameters = {
    zoneType: 'INTER_ZONE',
    customerType: 'B2C',
    baseWeightKg: 0.5,
    baseRate: 75.0,
    perKgRate: 40.0,
    volumetricDivisor: 5000.0,
    codFixedSurcharge: 40.0,
    codPercentSurcharge: 2.0,
    minCodSurcharge: 50.0,
  };

  const interB2BRateCard: RateCardParameters = {
    zoneType: 'INTER_ZONE',
    customerType: 'B2B',
    baseWeightKg: 0.5,
    baseRate: 60.0,
    perKgRate: 30.0,
    volumetricDivisor: 5000.0,
    codFixedSurcharge: 25.0,
    codPercentSurcharge: 1.2,
    minCodSurcharge: 35.0,
  };

  describe('1. Precision & Math Helpers (round2)', () => {
    it('should round numbers to 2 decimal places without IEEE 754 precision artifacts', () => {
      expect(round2(1.005)).toBe(1.01);
      expect(round2(40.333333)).toBe(40.33);
      expect(round2(40.666666)).toBe(40.67);
      expect(round2(0)).toBe(0);
      expect(round2(100.00001)).toBe(100);
    });
  });

  describe('2. Volumetric Weight Calculation & Dimensional Logic', () => {
    it('should calculate volumetric weight using (L * B * H) / divisor', () => {
      // 50 x 40 x 30 = 60,000 / 5,000 = 12.0 kg
      expect(calculateVolumetricWeight(50, 40, 30, 5000)).toBe(12.0);
      // 20 x 20 x 25 = 10,000 / 5,000 = 2.0 kg
      expect(calculateVolumetricWeight(20, 20, 25, 5000)).toBe(2.0);
      // 10 x 10 x 10 = 1,000 / 5,000 = 0.2 kg
      expect(calculateVolumetricWeight(10, 10, 10, 5000)).toBe(0.2);
    });

    it('should support custom volumetric divisors (e.g. 4000 vs 5000 vs 6000)', () => {
      const volume = 20 * 20 * 20; // 8000 cm3
      expect(calculateVolumetricWeight(20, 20, 20, 5000)).toBe(1.6);
      expect(calculateVolumetricWeight(20, 20, 20, 4000)).toBe(2.0);
      expect(calculateVolumetricWeight(20, 20, 20, 6000)).toBe(1.33);
    });

    it('should throw error for non-positive package dimensions or divisor', () => {
      expect(() => calculateVolumetricWeight(0, 10, 10)).toThrow(/strictly greater than 0/i);
      expect(() => calculateVolumetricWeight(10, -5, 10)).toThrow(/strictly greater than 0/i);
      expect(() => calculateVolumetricWeight(10, 10, 0)).toThrow(/strictly greater than 0/i);
      expect(() => calculateVolumetricWeight(10, 10, 10, 0)).toThrow(/divisor.*strictly greater than 0/i);
      expect(() => calculateVolumetricWeight(10, 10, 10, -100)).toThrow(/divisor.*strictly greater than 0/i);
    });
  });

  describe('3. Billable Weight Calculation & Ties', () => {
    it('should resolve exact actual == volumetric weight ties unambiguously', () => {
      expect(calculateBillableWeight(2.0, 2.0)).toBe(2.0);
      expect(calculateBillableWeight(0.5, 0.5)).toBe(0.5);
    });

    it('should bill on actual weight when actual > volumetric (heavy dense parcels)', () => {
      expect(calculateBillableWeight(5.0, 0.2)).toBe(5.0);
      expect(calculateBillableWeight(10.5, 3.2)).toBe(10.5);
    });

    it('should bill on volumetric weight when volumetric > actual (bulky lightweight parcels)', () => {
      expect(calculateBillableWeight(0.5, 12.0)).toBe(12.0);
      expect(calculateBillableWeight(1.0, 4.5)).toBe(4.5);
    });

    it('should throw error for non-positive actual weight or negative volumetric weight', () => {
      expect(() => calculateBillableWeight(0, 5.0)).toThrow(/actual weight.*strictly greater than 0/i);
      expect(() => calculateBillableWeight(-2.0, 5.0)).toThrow(/actual weight.*strictly greater than 0/i);
      expect(() => calculateBillableWeight(2.0, -1.0)).toThrow(/volumetric weight cannot be negative/i);
    });
  });

  describe('4. Base Weight & Incremental Excess Weight Pricing', () => {
    it('should charge zero excess weight when billable weight is less than or equal to base weight', () => {
      const resUnder = calculateWeightPrice(0.3, 0.5, 20.0);
      expect(resUnder.excessWeightKg).toBe(0);
      expect(resUnder.weightPrice).toBe(0);

      const resExact = calculateWeightPrice(0.5, 0.5, 20.0);
      expect(resExact.excessWeightKg).toBe(0);
      expect(resExact.weightPrice).toBe(0);
    });

    it('should calculate fractional excess weight and price accurately', () => {
      // billable = 2.5 kg, base = 0.5 kg -> excess = 2.0 kg @ 20/kg = 40.0
      const res = calculateWeightPrice(2.5, 0.5, 20.0);
      expect(res.excessWeightKg).toBe(2.0);
      expect(res.weightPrice).toBe(40.0);

      // billable = 1.25 kg, base = 0.5 kg -> excess = 0.75 kg @ 20/kg = 15.0
      const resFrac = calculateWeightPrice(1.25, 0.5, 20.0);
      expect(resFrac.excessWeightKg).toBe(0.75);
      expect(resFrac.weightPrice).toBe(15.0);
    });

    it('should throw error for invalid baseWeightKg or perKgRate', () => {
      expect(() => calculateWeightPrice(2.0, 0, 20.0)).toThrow(/base weight.*strictly greater than 0/i);
      expect(() => calculateWeightPrice(2.0, -0.5, 20.0)).toThrow(/base weight.*strictly greater than 0/i);
      expect(() => calculateWeightPrice(2.0, 0.5, -5.0)).toThrow(/per-kg rate cannot be negative/i);
    });
  });

  describe('5. Cash on Delivery (COD) Surcharge Evaluation', () => {
    it('should return 0.00 COD surcharge when isCod is false', () => {
      expect(calculateCodSurcharge(false, 5000, 25, 1.5, 30)).toBe(0.0);
      expect(calculateCodSurcharge(false, 0, 25, 1.5, 30)).toBe(0.0);
    });

    it('should apply floor minimum when fixed + percentage fee is below minimum floor', () => {
      // fixed = 25, pct = 1.5%, min = 30
      // For codAmount = 100: fixed(25) + 1.5 = 26.5 < min(30) => 30.00
      expect(calculateCodSurcharge(true, 100, 25, 1.5, 30)).toBe(30.0);
    });

    it('should apply computed fee when fixed + percentage fee exceeds minimum floor', () => {
      // For codAmount = 2000: fixed(25) + (2000 * 0.015 = 30) = 55.0 > min(30) => 55.00
      expect(calculateCodSurcharge(true, 2000, 25, 1.5, 30)).toBe(55.0);
    });

    it('should apply minimum floor fee when COD amount is 0 or not provided', () => {
      expect(calculateCodSurcharge(true, 0, 25, 1.5, 30)).toBe(30.0);
    });
  });

  describe('6. End-to-End Pure Rate Engine Calculations (computeRateQuote)', () => {
    it('should calculate Intra-Zone B2C quote correctly', () => {
      const quote = computeRateQuote(
        {
          lengthCm: 20,
          breadthCm: 20,
          heightCm: 25, // 10000 / 5000 = 2.0 kg
          actualWeightKg: 2.0,
          isCod: false,
        },
        intraB2CRateCard
      );

      expect(quote.actualWeightKg).toBe(2.0);
      expect(quote.volumetricWeightKg).toBe(2.0);
      expect(quote.billableWeightKg).toBe(2.0);
      expect(quote.excessWeightKg).toBe(1.5); // 2.0 - 0.5
      expect(quote.basePrice).toBe(40.0);
      expect(quote.weightPrice).toBe(30.0); // 1.5 * 20
      expect(quote.codSurcharge).toBe(0.0);
      expect(quote.totalAmount).toBe(70.0); // 40 + 30
    });

    it('should calculate Intra-Zone B2B quote with wholesale discount', () => {
      const quote = computeRateQuote(
        {
          lengthCm: 30,
          breadthCm: 20,
          heightCm: 10, // 6000 / 5000 = 1.2 kg
          actualWeightKg: 2.5, // billable = 2.5 kg, excess = 2.0 kg
          isCod: false,
        },
        intraB2BRateCard
      );

      expect(quote.billableWeightKg).toBe(2.5);
      expect(quote.basePrice).toBe(30.0);
      expect(quote.weightPrice).toBe(30.0); // 2.0 * 15
      expect(quote.codSurcharge).toBe(0.0);
      expect(quote.totalAmount).toBe(60.0); // 30 + 30
    });

    it('should calculate Inter-Zone B2C quote with COD surcharge', () => {
      const quote = computeRateQuote(
        {
          lengthCm: 20,
          breadthCm: 20,
          heightCm: 20, // 8000 / 5000 = 1.6 kg
          actualWeightKg: 1.0, // billable = 1.6 kg, excess = 1.1 kg
          isCod: true,
          codAmount: 1500.0, // fixed(40) + (1500 * 0.02 = 30) = 70.0 > min(50)
        },
        interB2CRateCard
      );

      expect(quote.volumetricWeightKg).toBe(1.6);
      expect(quote.billableWeightKg).toBe(1.6);
      expect(quote.excessWeightKg).toBe(1.1);
      expect(quote.basePrice).toBe(75.0);
      expect(quote.weightPrice).toBe(44.0); // 1.1 * 40
      expect(quote.codSurcharge).toBe(70.0);
      expect(quote.totalAmount).toBe(189.0); // 75 + 44 + 70
    });

    it('should calculate Inter-Zone B2B quote correctly', () => {
      const quote = computeRateQuote(
        {
          lengthCm: 40,
          breadthCm: 30,
          heightCm: 20, // 24000 / 5000 = 4.8 kg
          actualWeightKg: 5.0, // billable = 5.0 kg, excess = 4.5 kg
          isCod: false,
        },
        interB2BRateCard
      );

      expect(quote.billableWeightKg).toBe(5.0);
      expect(quote.basePrice).toBe(60.0);
      expect(quote.weightPrice).toBe(135.0); // 4.5 * 30
      expect(quote.totalAmount).toBe(195.0); // 60 + 135
    });

    it('should use declaredValue when codAmount is not provided but isCod is true', () => {
      const quote = computeRateQuote(
        {
          lengthCm: 10,
          breadthCm: 10,
          heightCm: 10,
          actualWeightKg: 0.5,
          isCod: true,
          declaredValue: 2000.0,
        },
        intraB2CRateCard
      );

      // fixed(25) + (2000 * 0.015 = 30) = 55.0
      expect(quote.codSurcharge).toBe(55.0);
      expect(quote.totalAmount).toBe(95.0); // 40 + 55
    });
  });

  describe('7. assembleRateQuoteBreakdown Function', () => {
    it('should assemble full RateQuoteBreakdown with zone metadata', () => {
      const pickupZone = { id: 'zone_1', name: 'North Metro', code: 'ZONE_NORTH' };
      const dropZone = { id: 'zone_1', name: 'North Metro', code: 'ZONE_NORTH' };

      const breakdown = assembleRateQuoteBreakdown(
        {
          pickupPincode: '560001',
          dropPincode: '560024',
          customerType: 'B2C',
          lengthCm: 20,
          breadthCm: 20,
          heightCm: 25,
          actualWeightKg: 2.0,
          isCod: false,
        },
        pickupZone,
        dropZone,
        'INTRA_ZONE',
        intraB2CRateCard
      );

      expect(breakdown.pickupZone).toEqual(pickupZone);
      expect(breakdown.dropZone).toEqual(dropZone);
      expect(breakdown.zoneType).toBe('INTRA_ZONE');
      expect(breakdown.customerType).toBe('B2C');
      expect(breakdown.billableWeightKg).toBe(2.0);
      expect(breakdown.totalAmount).toBe(70.0);
    });
  });
});
