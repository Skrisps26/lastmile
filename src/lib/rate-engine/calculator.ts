// /home/skrisps/lastmile/src/lib/rate-engine/calculator.ts

import {
  RateQuoteInput,
  RateCardPricingParams,
  RateCardParameters,
  ZoneSummary,
  ZoneType,
  PureRateEngineParams,
  PureRateCalculationResult,
  RateQuoteBreakdown,
} from './types';

/**
 * Rounds a floating-point number to 2 decimal places avoiding IEEE 754 precision artifacts.
 */
export function round2(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/**
 * Computes volumetric weight in kg from physical dimensions (cm) and divisor.
 * Formula: (Length × Breadth × Height) / VolumetricDivisor
 */
export function calculateVolumetricWeight(
  lengthCm: number,
  breadthCm: number,
  heightCm: number,
  volumetricDivisor: number = 5000
): number {
  if (lengthCm <= 0 || breadthCm <= 0 || heightCm <= 0) {
    throw new Error('Package dimensions (length, breadth, height) must be strictly greater than 0');
  }
  if (volumetricDivisor <= 0) {
    throw new Error('Volumetric divisor must be strictly greater than 0');
  }

  const volume = lengthCm * breadthCm * heightCm;
  const volumetricWeight = volume / volumetricDivisor;
  return round2(volumetricWeight);
}

/**
 * Determines billable weight as max(actualWeightKg, volumetricWeightKg).
 */
export function calculateBillableWeight(
  actualWeightKg: number,
  volumetricWeightKg: number
): number {
  if (actualWeightKg <= 0) {
    throw new Error('Actual weight must be strictly greater than 0');
  }
  if (volumetricWeightKg < 0) {
    throw new Error('Volumetric weight cannot be negative');
  }

  return round2(Math.max(actualWeightKg, volumetricWeightKg));
}

/**
 * Computes excess weight above baseWeightKg threshold and resulting incremental weight price.
 * excessWeight = max(0, billableWeightKg - baseWeightKg)
 * weightPrice = excessWeight * perKgRate
 */
export function calculateWeightPrice(
  billableWeightKg: number,
  baseWeightKg: number,
  perKgRate: number
): { excessWeightKg: number; weightPrice: number } {
  if (baseWeightKg <= 0) {
    throw new Error('Base weight threshold must be strictly greater than 0');
  }
  if (perKgRate < 0) {
    throw new Error('Per-kg rate cannot be negative');
  }

  const excessWeightKg = round2(Math.max(0, billableWeightKg - baseWeightKg));
  const weightPrice = round2(excessWeightKg * perKgRate);

  return {
    excessWeightKg,
    weightPrice,
  };
}

/**
 * Computes Cash on Delivery (COD) surcharge fee:
 * - If not isCod -> 0.00
 * - If isCod -> max(fixedSurcharge + (codAmount * percentSurcharge / 100), minFloor)
 */
export function calculateCodSurcharge(
  isCod: boolean,
  codAmount: number = 0,
  codFixedSurcharge: number = 0,
  codPercentSurcharge: number = 0,
  minCodSurcharge: number = 0
): number {
  if (!isCod) {
    return 0.0;
  }

  const effectiveCodAmount = Math.max(0, codAmount);
  const calculatedPercentageFee = effectiveCodAmount * (codPercentSurcharge / 100);
  const totalCodFee = codFixedSurcharge + calculatedPercentageFee;
  const finalFee = Math.max(totalCodFee, minCodSurcharge);

  return round2(finalFee);
}

/**
 * Pure calculation engine function.
 * Given physical dimensions, weight, COD settings, and RateCard parameters,
 * computes the full itemized pricing result with zero hardcoded business values.
 */
export function calculateRate(params: PureRateEngineParams): PureRateCalculationResult {
  const {
    lengthCm,
    breadthCm,
    heightCm,
    actualWeightKg,
    isCod,
    codAmount,
    declaredValue,
    volumetricDivisor: customDivisor,
    pricing,
  } = params;

  const effectiveDivisor = customDivisor ?? pricing.volumetricDivisor ?? 5000;

  // 1. Calculate volumetric weight
  const volumetricWeightKg = calculateVolumetricWeight(
    lengthCm,
    breadthCm,
    heightCm,
    effectiveDivisor
  );

  // 2. Determine billable weight
  const billableWeightKg = calculateBillableWeight(actualWeightKg, volumetricWeightKg);

  // 3. Base rate and excess weight price
  const { excessWeightKg, weightPrice } = calculateWeightPrice(
    billableWeightKg,
    pricing.baseWeightKg,
    pricing.perKgRate
  );
  const basePrice = round2(pricing.baseRate);

  // 4. COD surcharge calculation
  const codPrincipal = codAmount !== undefined && codAmount > 0 ? codAmount : (declaredValue ?? 0);
  const codSurcharge = calculateCodSurcharge(
    isCod,
    codPrincipal,
    pricing.codFixedSurcharge,
    pricing.codPercentSurcharge,
    pricing.minCodSurcharge
  );

  // 5. Total amount
  const totalAmount = round2(basePrice + weightPrice + codSurcharge);

  return {
    actualWeightKg: round2(actualWeightKg),
    volumetricWeightKg,
    billableWeightKg,
    excessWeightKg,
    volumetricDivisor: effectiveDivisor,
    basePrice,
    weightPrice,
    codSurcharge,
    totalAmount,
  };
}

/**
 * Convenience wrapper for pure rate computation accepting flexible input objects.
 */
export function computeRateQuote(
  input: {
    lengthCm: number;
    breadthCm: number;
    heightCm: number;
    actualWeightKg: number;
    isCod?: boolean;
    codAmount?: number;
    declaredValue?: number;
    volumetricDivisor?: number;
  },
  pricing: RateCardPricingParams | RateCardParameters
): PureRateCalculationResult {
  return calculateRate({
    lengthCm: input.lengthCm,
    breadthCm: input.breadthCm,
    heightCm: input.heightCm,
    actualWeightKg: input.actualWeightKg,
    isCod: !!input.isCod,
    codAmount: input.codAmount,
    declaredValue: input.declaredValue,
    volumetricDivisor: input.volumetricDivisor,
    pricing: {
      baseWeightKg: pricing.baseWeightKg,
      baseRate: pricing.baseRate,
      perKgRate: pricing.perKgRate,
      volumetricDivisor: pricing.volumetricDivisor,
      codFixedSurcharge: pricing.codFixedSurcharge,
      codPercentSurcharge: pricing.codPercentSurcharge,
      minCodSurcharge: pricing.minCodSurcharge,
    },
  });
}

/**
 * Assembles the full RateQuoteBreakdown object by combining Zone resolution
 * with the pure rate calculation output.
 */
export function assembleRateQuoteBreakdown(
  input: RateQuoteInput,
  pickupZone: ZoneSummary,
  dropZone: ZoneSummary,
  zoneType: ZoneType,
  pricing: RateCardPricingParams
): RateQuoteBreakdown {
  const calcResult = calculateRate({
    lengthCm: input.lengthCm,
    breadthCm: input.breadthCm,
    heightCm: input.heightCm,
    actualWeightKg: input.actualWeightKg,
    isCod: input.isCod,
    codAmount: input.codAmount,
    declaredValue: input.declaredValue,
    volumetricDivisor: input.volumetricDivisor,
    pricing,
  });

  return {
    pickupZone,
    dropZone,
    zoneType,
    customerType: input.customerType,
    actualWeightKg: calcResult.actualWeightKg,
    volumetricWeightKg: calcResult.volumetricWeightKg,
    billableWeightKg: calcResult.billableWeightKg,
    volumetricDivisor: calcResult.volumetricDivisor,
    basePrice: calcResult.basePrice,
    weightPrice: calcResult.weightPrice,
    codSurcharge: calcResult.codSurcharge,
    totalAmount: calcResult.totalAmount,
  };
}
