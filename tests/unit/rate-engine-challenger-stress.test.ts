// /home/skrisps/lastmile/tests/unit/rate-engine-challenger-stress.test.ts

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
import { RateCardParameters } from '@/lib/rate-engine/types';

describe('Adversarial Challenger Stress Suite: Rate Calculation Engine (M2-R1)', () => {
  // Base reference rate cards with typical and edge pricing parameters
  const standardIntraB2C: RateCardParameters = {
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

  const edgePrecisionRateCard: RateCardParameters = {
    zoneType: 'INTER_ZONE',
    customerType: 'B2B',
    baseWeightKg: 0.33,
    baseRate: 49.99,
    perKgRate: 29.99,
    volumetricDivisor: 5000.0,
    codFixedSurcharge: 19.99,
    codPercentSurcharge: 1.75,
    minCodSurcharge: 39.99,
  };

  // =========================================================================
  // 1. Weight Tie Boundaries & Epsilon Thresholds
  // =========================================================================
  describe('1. Weight Tie Boundaries & Exact Matches', () => {
    it('should resolve exact 1.0kg tie: 10x10x50 cm (5000 cm3) / 5000 = 1.00kg vs actual 1.00kg', () => {
      const volWeight = calculateVolumetricWeight(10, 10, 50, 5000);
      expect(volWeight).toBe(1.0);

      const billableWeight = calculateBillableWeight(1.0, volWeight);
      expect(billableWeight).toBe(1.0);

      const result = computeRateQuote(
        {
          lengthCm: 10,
          breadthCm: 10,
          heightCm: 50,
          actualWeightKg: 1.0,
          isCod: false,
        },
        standardIntraB2C
      );

      expect(result.actualWeightKg).toBe(1.0);
      expect(result.volumetricWeightKg).toBe(1.0);
      expect(result.billableWeightKg).toBe(1.0);
      expect(result.excessWeightKg).toBe(0.5); // 1.0 - 0.5
      expect(result.basePrice).toBe(40.0);
      expect(result.weightPrice).toBe(10.0); // 0.5 * 20
      expect(result.totalAmount).toBe(50.0);
    });

    it('should resolve exact 2.0kg tie: 20x20x25 cm (10000 cm3) / 5000 = 2.00kg vs actual 2.00kg', () => {
      const volWeight = calculateVolumetricWeight(20, 20, 25, 5000);
      expect(volWeight).toBe(2.0);

      const billableWeight = calculateBillableWeight(2.0, volWeight);
      expect(billableWeight).toBe(2.0);

      const result = computeRateQuote(
        {
          lengthCm: 20,
          breadthCm: 20,
          heightCm: 25,
          actualWeightKg: 2.0,
          isCod: false,
        },
        standardIntraB2C
      );

      expect(result.billableWeightKg).toBe(2.0);
      expect(result.excessWeightKg).toBe(1.5);
      expect(result.weightPrice).toBe(30.0);
      expect(result.totalAmount).toBe(70.0);
    });

    it('should resolve exact 50.0kg tie: 100x50x50 cm (250000 cm3) / 5000 = 50.00kg vs actual 50.00kg', () => {
      const volWeight = calculateVolumetricWeight(100, 50, 50, 5000);
      expect(volWeight).toBe(50.0);

      const result = computeRateQuote(
        {
          lengthCm: 100,
          breadthCm: 50,
          heightCm: 50,
          actualWeightKg: 50.0,
          isCod: false,
        },
        standardIntraB2C
      );

      expect(result.billableWeightKg).toBe(50.0);
      expect(result.excessWeightKg).toBe(49.5);
      expect(result.weightPrice).toBe(990.0); // 49.5 * 20
      expect(result.totalAmount).toBe(1030.0); // 40 + 990
    });

    it('should resolve fractional ties: 10x10x12.5 cm (1250 cm3) / 5000 = 0.25kg vs actual 0.25kg', () => {
      const volWeight = calculateVolumetricWeight(10, 10, 12.5, 5000);
      expect(volWeight).toBe(0.25);

      const result = computeRateQuote(
        {
          lengthCm: 10,
          breadthCm: 10,
          heightCm: 12.5,
          actualWeightKg: 0.25,
          isCod: false,
        },
        standardIntraB2C
      );

      expect(result.billableWeightKg).toBe(0.25);
      expect(result.excessWeightKg).toBe(0.0); // 0.25 < 0.5 baseWeight
      expect(result.weightPrice).toBe(0.0);
      expect(result.totalAmount).toBe(40.0);
    });

    it('should handle epsilon near-ties (actual slightly higher vs volumetric slightly higher)', () => {
      // 10x10x50 = 5000 / 5000 = 1.0kg
      // Case A: actual = 1.004 kg -> round2(Math.max(1.004, 1.0)) = 1.00 kg
      const resA = calculateBillableWeight(1.004, 1.0);
      expect(resA).toBe(1.0);

      // Case B: actual = 1.006 kg -> round2(Math.max(1.006, 1.0)) = 1.01 kg
      const resB = calculateBillableWeight(1.006, 1.0);
      expect(resB).toBe(1.01);

      // Case C: actual = 0.999 kg, vol = 1.000 kg -> billable = 1.00 kg
      const resC = calculateBillableWeight(0.999, 1.0);
      expect(resC).toBe(1.0);

      // Case D: actual = 1.000 kg, vol = 0.999 kg -> billable = 1.00 kg
      const resD = calculateBillableWeight(1.0, 0.999);
      expect(resD).toBe(1.0);
    });

    it('should correctly evaluate base weight threshold boundary (exact equality, under, and slight over)', () => {
      // Exact base weight
      const exact = calculateWeightPrice(0.5, 0.5, 20.0);
      expect(exact.excessWeightKg).toBe(0.0);
      expect(exact.weightPrice).toBe(0.0);

      // Under base weight
      const under = calculateWeightPrice(0.499, 0.5, 20.0);
      expect(under.excessWeightKg).toBe(0.0);
      expect(under.weightPrice).toBe(0.0);

      // Infinitesimal over base weight that rounds to 0.00 excess
      const slightOverZero = calculateWeightPrice(0.504, 0.5, 20.0);
      expect(slightOverZero.excessWeightKg).toBe(0.0);
      expect(slightOverZero.weightPrice).toBe(0.0);

      // Small over base weight that rounds to 0.01 excess
      const slightOverOne = calculateWeightPrice(0.506, 0.5, 20.0);
      expect(slightOverOne.excessWeightKg).toBe(0.01);
      expect(slightOverOne.weightPrice).toBe(0.2); // 0.01 * 20 = 0.20
    });
  });

  // =========================================================================
  // 2. Floating-Point Rounding & Decimal Precision
  // =========================================================================
  describe('2. Floating-Point Rounding & Decimal Precision', () => {
    it('should round standard IEEE-754 precision trap numbers accurately', () => {
      expect(round2(1.005)).toBe(1.01);
      expect(round2(1.015)).toBe(1.02);
      expect(round2(1.025)).toBe(1.03);
      expect(round2(1.035)).toBe(1.04);
      expect(round2(1.045)).toBe(1.05);
      expect(round2(1.055)).toBe(1.06);
      expect(round2(1.065)).toBe(1.07);
      expect(round2(1.075)).toBe(1.08);
      expect(round2(1.085)).toBe(1.09);
      expect(round2(1.095)).toBe(1.1);
      expect(round2(0.1 + 0.2)).toBe(0.3);
      expect(round2(0.0000001)).toBe(0.0);
    });

    it('should handle fractional repeating weights without precision drift', () => {
      // 1/3 kg = 0.3333333333333333
      const thirdKg = 1 / 3;
      const volThird = calculateVolumetricWeight(10, 10, 10, 3000); // 1000 / 3000 = 0.33333...
      expect(volThird).toBe(0.33);

      // 2/3 kg = 0.6666666666666666
      const volTwoThird = calculateVolumetricWeight(20, 20, 10, 6000); // 4000 / 6000 = 0.66666...
      expect(volTwoThird).toBe(0.67);

      // Billable weight on repeating fraction
      const billable = calculateBillableWeight(thirdKg, 0.1);
      expect(billable).toBe(0.33);
    });

    it('should calculate rate engine output accurately with prices ending in .99', () => {
      // Edge card: baseRate = 49.99, perKgRate = 29.99, baseWeight = 0.33
      // billableWeight = 1.33 kg -> excess = 1.00 kg
      // basePrice = 49.99
      // weightPrice = 1.00 * 29.99 = 29.99
      // isCod = true, codAmount = 1000
      // codFee = max(19.99 + (1000 * 0.0175 = 17.5) = 37.49, min 39.99) => 39.99
      // total = 49.99 + 29.99 + 39.99 = 119.97
      const result = computeRateQuote(
        {
          lengthCm: 20,
          breadthCm: 20,
          heightCm: 16.625, // 6650 / 5000 = 1.33 kg
          actualWeightKg: 1.33,
          isCod: true,
          codAmount: 1000,
        },
        edgePrecisionRateCard
      );

      expect(result.billableWeightKg).toBe(1.33);
      expect(result.excessWeightKg).toBe(1.0); // 1.33 - 0.33 = 1.00
      expect(result.basePrice).toBe(49.99);
      expect(result.weightPrice).toBe(29.99);
      expect(result.codSurcharge).toBe(39.99); // minCodSurcharge applied because 37.49 < 39.99
      expect(result.totalAmount).toBe(119.97); // 49.99 + 29.99 + 39.99
    });

    it('should maintain strict sum invariant totalAmount === basePrice + weightPrice + codSurcharge across 100 arbitrary float combinations', () => {
      for (let i = 1; i <= 100; i++) {
        const length = 5 + (i * 0.77);
        const breadth = 5 + (i * 0.63);
        const height = 5 + (i * 0.49);
        const actualWeight = 0.1 + (i * 0.137);
        const isCod = i % 2 === 0;
        const codAmount = isCod ? 100 + i * 33.33 : 0;

        const quote = computeRateQuote(
          {
            lengthCm: length,
            breadthCm: breadth,
            heightCm: height,
            actualWeightKg: actualWeight,
            isCod,
            codAmount,
          },
          edgePrecisionRateCard
        );

        const expectedSum = round2(quote.basePrice + quote.weightPrice + quote.codSurcharge);
        expect(quote.totalAmount).toBe(expectedSum);
        expect(quote.totalAmount).toBeGreaterThanOrEqual(quote.basePrice);
      }
    });
  });

  // =========================================================================
  // 3. Extreme Dimensions & Weights Stress
  // =========================================================================
  describe('3. Extreme Dimensions & Weights', () => {
    it('should handle sub-gram and tiny items: 1x1x1 cm and 0.001kg actual weight', () => {
      // 1 x 1 x 1 = 1 cm3 / 5000 = 0.0002 kg -> round2 = 0.00 kg
      const volWeight = calculateVolumetricWeight(1, 1, 1, 5000);
      expect(volWeight).toBe(0.0);

      // actualWeight = 0.001 kg -> round2(max(0.001, 0.00)) = 0.00 kg
      const billable = calculateBillableWeight(0.001, volWeight);
      expect(billable).toBe(0.0);

      const quote = computeRateQuote(
        {
          lengthCm: 1,
          breadthCm: 1,
          heightCm: 1,
          actualWeightKg: 0.001,
          isCod: false,
        },
        standardIntraB2C
      );

      expect(quote.volumetricWeightKg).toBe(0.0);
      expect(quote.billableWeightKg).toBe(0.0);
      expect(quote.excessWeightKg).toBe(0.0);
      expect(quote.basePrice).toBe(40.0);
      expect(quote.weightPrice).toBe(0.0);
      expect(quote.totalAmount).toBe(40.0);
    });

    it('should handle extreme aspect ratio parcels (long pipes / rods): 500x1x1 cm', () => {
      // 500 x 1 x 1 = 500 cm3 / 5000 = 0.10 kg
      const volWeight = calculateVolumetricWeight(500, 1, 1, 5000);
      expect(volWeight).toBe(0.1);

      const quote = computeRateQuote(
        {
          lengthCm: 500,
          breadthCm: 1,
          heightCm: 1,
          actualWeightKg: 0.05,
          isCod: false,
        },
        standardIntraB2C
      );

      expect(quote.volumetricWeightKg).toBe(0.1);
      expect(quote.billableWeightKg).toBe(0.1);
      expect(quote.excessWeightKg).toBe(0.0); // 0.1 <= 0.5
      expect(quote.totalAmount).toBe(40.0);
    });

    it('should handle large flat sheet parcels: 200x200x0.5 cm', () => {
      // 200 x 200 x 0.5 = 20000 cm3 / 5000 = 4.00 kg
      const volWeight = calculateVolumetricWeight(200, 200, 0.5, 5000);
      expect(volWeight).toBe(4.0);

      const quote = computeRateQuote(
        {
          lengthCm: 200,
          breadthCm: 200,
          heightCm: 0.5,
          actualWeightKg: 1.5,
          isCod: false,
        },
        standardIntraB2C
      );

      expect(quote.billableWeightKg).toBe(4.0); // Volumetric dominates
      expect(quote.excessWeightKg).toBe(3.5); // 4.0 - 0.5
      expect(quote.weightPrice).toBe(70.0); // 3.5 * 20
      expect(quote.totalAmount).toBe(110.0); // 40 + 70
    });

    it('should handle massive heavy freight: 10000kg actual weight', () => {
      const quote = computeRateQuote(
        {
          lengthCm: 100,
          breadthCm: 100,
          heightCm: 100, // 1,000,000 / 5000 = 200 kg
          actualWeightKg: 10000, // 10,000 kg actual
          isCod: false,
        },
        standardIntraB2C
      );

      expect(quote.volumetricWeightKg).toBe(200.0);
      expect(quote.billableWeightKg).toBe(10000.0);
      expect(quote.excessWeightKg).toBe(9999.5); // 10000 - 0.5
      expect(quote.weightPrice).toBe(199990.0); // 9999.5 * 20
      expect(quote.totalAmount).toBe(200030.0); // 40 + 199990
    });

    it('should handle massive dimensional volume: 500x500x500 cm = 25000kg volumetric weight', () => {
      // 500 x 500 x 500 = 125,000,000 / 5000 = 25000.00 kg
      const volWeight = calculateVolumetricWeight(500, 500, 500, 5000);
      expect(volWeight).toBe(25000.0);

      const quote = computeRateQuote(
        {
          lengthCm: 500,
          breadthCm: 500,
          heightCm: 500,
          actualWeightKg: 100,
          isCod: false,
        },
        standardIntraB2C
      );

      expect(quote.billableWeightKg).toBe(25000.0);
      expect(quote.excessWeightKg).toBe(24999.5);
      expect(quote.weightPrice).toBe(499990.0); // 24999.5 * 20
      expect(quote.totalAmount).toBe(500030.0);
    });
  });

  // =========================================================================
  // 4. Extreme COD Amounts & Custom Divisor Overrides
  // =========================================================================
  describe('4. Extreme COD Amounts & Custom Divisor Overrides', () => {
    it('should apply minimum COD floor for small COD amounts (e.g. ₹1.00)', () => {
      // fixed = 25, pct = 1.5% of 1 = 0.015, sum = 25.015, min = 30 -> 30.00
      const surcharge = calculateCodSurcharge(true, 1.0, 25.0, 1.5, 30.0);
      expect(surcharge).toBe(30.0);
    });

    it('should compute exact COD surcharge on massive COD amounts (e.g. ₹10,000,000)', () => {
      // fixed = 25, pct = 1.5% of 10,000,000 = 150,000, sum = 150,025 -> 150025.00
      const surcharge = calculateCodSurcharge(true, 10000000, 25.0, 1.5, 30.0);
      expect(surcharge).toBe(150025.0);
    });

    it('should fall back to declaredValue when codAmount is 0 or undefined but isCod is true', () => {
      const quoteWithDeclared = computeRateQuote(
        {
          lengthCm: 10,
          breadthCm: 10,
          heightCm: 10,
          actualWeightKg: 0.5,
          isCod: true,
          codAmount: 0,
          declaredValue: 4000.0,
        },
        standardIntraB2C
      );

      // fixed(25) + (4000 * 0.015 = 60) = 85.00
      expect(quoteWithDeclared.codSurcharge).toBe(85.0);
      expect(quoteWithDeclared.totalAmount).toBe(125.0); // 40 + 85
    });

    it('should support various standard and custom divisors (4000 vs 5000 vs 6000 vs 2500)', () => {
      const volume = 30 * 20 * 20; // 12000 cm3

      // Divisor 4000 (Air freight / Express) -> 12000 / 4000 = 3.00 kg
      expect(calculateVolumetricWeight(30, 20, 20, 4000)).toBe(3.0);

      // Divisor 5000 (Standard) -> 12000 / 5000 = 2.40 kg
      expect(calculateVolumetricWeight(30, 20, 20, 5000)).toBe(2.4);

      // Divisor 6000 (Ocean / Ground heavy) -> 12000 / 6000 = 2.00 kg
      expect(calculateVolumetricWeight(30, 20, 20, 6000)).toBe(2.0);

      // Divisor 2500 (Voluminous express) -> 12000 / 2500 = 4.80 kg
      expect(calculateVolumetricWeight(30, 20, 20, 2500)).toBe(4.8);
    });

    it('should give customDivisor priority over RateCard default divisor in computeRateQuote', () => {
      const quoteWithOverride = computeRateQuote(
        {
          lengthCm: 20,
          breadthCm: 20,
          heightCm: 20, // 8000 cm3
          actualWeightKg: 1.0,
          volumetricDivisor: 4000, // Explicit override: 8000 / 4000 = 2.0 kg
        },
        standardIntraB2C // Rate card has 5000
      );

      expect(quoteWithOverride.volumetricDivisor).toBe(4000);
      expect(quoteWithOverride.volumetricWeightKg).toBe(2.0);
      expect(quoteWithOverride.billableWeightKg).toBe(2.0);
      expect(quoteWithOverride.excessWeightKg).toBe(1.5);
      expect(quoteWithOverride.totalAmount).toBe(70.0); // 40 + 30
    });
  });

  // =========================================================================
  // 5. Mathematical Invariants & Property-Based Random Stress
  // =========================================================================
  describe('5. Mathematical Invariants & Property-Based Random Stress (1,000 iterations)', () => {
    it('should satisfy dimensional symmetry: permutation of (L, B, H) produces identical volumetric weight and price', () => {
      const perms = [
        [30, 20, 15],
        [30, 15, 20],
        [20, 30, 15],
        [20, 15, 30],
        [15, 30, 20],
        [15, 20, 30],
      ];

      const baseline = computeRateQuote(
        {
          lengthCm: perms[0][0],
          breadthCm: perms[0][1],
          heightCm: perms[0][2],
          actualWeightKg: 2.0,
          isCod: true,
          codAmount: 500,
        },
        standardIntraB2C
      );

      for (let i = 1; i < perms.length; i++) {
        const quote = computeRateQuote(
          {
            lengthCm: perms[i][0],
            breadthCm: perms[i][1],
            heightCm: perms[i][2],
            actualWeightKg: 2.0,
            isCod: true,
            codAmount: 500,
          },
          standardIntraB2C
        );

        expect(quote.volumetricWeightKg).toBe(baseline.volumetricWeightKg);
        expect(quote.billableWeightKg).toBe(baseline.billableWeightKg);
        expect(quote.totalAmount).toBe(baseline.totalAmount);
      }
    });

    it('should satisfy monotonicity invariant: increasing weight or dimensions never decreases billable weight or total quote', () => {
      let prevBillable = 0;
      let prevTotal = 0;

      for (let w = 0.5; w <= 20.0; w += 0.5) {
        const quote = computeRateQuote(
          {
            lengthCm: 10 + w * 2,
            breadthCm: 10 + w * 2,
            heightCm: 10 + w * 2,
            actualWeightKg: w,
            isCod: false,
          },
          standardIntraB2C
        );

        expect(quote.billableWeightKg).toBeGreaterThanOrEqual(prevBillable);
        expect(quote.totalAmount).toBeGreaterThanOrEqual(prevTotal);

        prevBillable = quote.billableWeightKg;
        prevTotal = quote.totalAmount;
      }
    });

    it('should satisfy divisor inverse monotonicity: higher divisor produces lower or equal volumetric weight', () => {
      const divisors = [2000, 3000, 4000, 5000, 6000, 8000, 10000];
      let prevVolWeight = Infinity;

      for (const div of divisors) {
        const volWeight = calculateVolumetricWeight(40, 30, 25, div);
        expect(volWeight).toBeLessThanOrEqual(prevVolWeight);
        prevVolWeight = volWeight;
      }
    });

    it('should satisfy all 5 core mathematical invariants over 1,000 pseudo-random property vectors', () => {
      // Deterministic PRNG seed simulation
      let seed = 42;
      function pseudoRandom() {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      }

      for (let i = 0; i < 1000; i++) {
        const length = 1 + pseudoRandom() * 200;
        const breadth = 1 + pseudoRandom() * 200;
        const height = 1 + pseudoRandom() * 200;
        const actualWeight = 0.01 + pseudoRandom() * 50;
        const divisor = 3000 + Math.floor(pseudoRandom() * 4000);
        const isCod = pseudoRandom() > 0.5;
        const codAmount = isCod ? pseudoRandom() * 10000 : 0;

        const baseRate = 20 + pseudoRandom() * 80;
        const perKgRate = 10 + pseudoRandom() * 40;
        const baseWeightKg = 0.2 + pseudoRandom() * 1.0;

        const customPricing: RateCardParameters = {
          zoneType: 'INTRA_ZONE',
          customerType: 'B2C',
          baseWeightKg,
          baseRate,
          perKgRate,
          volumetricDivisor: divisor,
          codFixedSurcharge: 10 + pseudoRandom() * 20,
          codPercentSurcharge: 1.0 + pseudoRandom() * 2.0,
          minCodSurcharge: 20 + pseudoRandom() * 30,
        };

        const result = computeRateQuote(
          {
            lengthCm: length,
            breadthCm: breadth,
            heightCm: height,
            actualWeightKg: actualWeight,
            isCod,
            codAmount,
            volumetricDivisor: divisor,
          },
          customPricing
        );

        // Invariant 1: Billable weight >= actual weight (with round2 tolerance)
        expect(result.billableWeightKg).toBeGreaterThanOrEqual(result.actualWeightKg);

        // Invariant 2: Billable weight >= volumetric weight
        expect(result.billableWeightKg).toBeGreaterThanOrEqual(result.volumetricWeightKg);

        // Invariant 3: Excess weight formula consistency
        const expectedExcess = round2(Math.max(0, result.billableWeightKg - customPricing.baseWeightKg));
        expect(result.excessWeightKg).toBe(expectedExcess);

        // Invariant 4: Weight price formula consistency
        const expectedWeightPrice = round2(expectedExcess * customPricing.perKgRate);
        expect(result.weightPrice).toBe(expectedWeightPrice);

        // Invariant 5: Additive total sum consistency
        const expectedTotal = round2(result.basePrice + result.weightPrice + result.codSurcharge);
        expect(result.totalAmount).toBe(expectedTotal);
        expect(result.totalAmount).toBeGreaterThanOrEqual(result.basePrice);
      }
    });
  });
});
