// /home/skrisps/lastmile/src/lib/rate-engine/types.ts

export type CustomerType = 'B2B' | 'B2C';
export type ZoneType = 'INTRA_ZONE' | 'INTER_ZONE';

export interface RateQuoteInput {
  pickupPincode: string;
  dropPincode: string;
  customerType: CustomerType;
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
  actualWeightKg: number;
  isCod: boolean;
  codAmount?: number;
  declaredValue?: number;
  volumetricDivisor?: number;
}

export interface RateCardPricingParams {
  baseWeightKg: number;
  baseRate: number;
  perKgRate: number;
  volumetricDivisor: number;
  codFixedSurcharge: number;
  codPercentSurcharge: number;
  minCodSurcharge: number;
}

export interface RateCardParameters extends RateCardPricingParams {
  id?: string;
  zoneType: ZoneType;
  customerType: CustomerType;
  isActive?: boolean;
}

export interface ZoneSummary {
  id: string;
  name: string;
  code: string;
}

export interface ZoneInfo {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  isActive: boolean;
}

export interface PincodeInfo {
  pincode: string;
  areaName?: string | null;
  zone: ZoneInfo;
}

export interface ZoneDetectionResult {
  pickupZone: ZoneInfo;
  dropZone: ZoneInfo;
  pickupPincode: string;
  dropPincode: string;
  pickupAreaName?: string | null;
  dropAreaName?: string | null;
  zoneType: ZoneType;
}

export interface PureRateEngineParams {
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
  actualWeightKg: number;
  isCod: boolean;
  codAmount?: number;
  declaredValue?: number;
  volumetricDivisor?: number;
  pricing: RateCardPricingParams;
}

export interface PureRateCalculationResult {
  actualWeightKg: number;
  volumetricWeightKg: number;
  billableWeightKg: number;
  excessWeightKg: number;
  volumetricDivisor: number;
  basePrice: number;
  weightPrice: number;
  codSurcharge: number;
  totalAmount: number;
}

export interface RateCalculationBreakdown {
  basePrice: number;
  weightPrice: number;
  codSurcharge: number;
  totalAmount: number;
}

export interface RateQuoteBreakdown {
  pickupZone: ZoneSummary;
  dropZone: ZoneSummary;
  zoneType: ZoneType;
  customerType: CustomerType;
  actualWeightKg: number;
  volumetricWeightKg: number;
  billableWeightKg: number;
  volumetricDivisor: number;
  basePrice: number;
  weightPrice: number;
  codSurcharge: number;
  totalAmount: number;
}

export interface CalculateRateResponse {
  pickupZone: ZoneSummary;
  dropZone: ZoneSummary;
  zoneType: ZoneType;
  customerType: CustomerType;
  actualWeightKg: number;
  volumetricWeightKg: number;
  billableWeightKg: number;
  volumetricDivisor: number;
  baseWeightKg: number;
  baseRate: number;
  perKgRate: number;
  excessWeightKg: number;
  basePrice: number;
  weightPrice: number;
  codSurcharge: number;
  totalAmount: number;
  rateCardId: string;
  breakdown: RateCalculationBreakdown;
}
