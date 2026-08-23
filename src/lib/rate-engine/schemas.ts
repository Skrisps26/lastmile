// /home/skrisps/lastmile/src/lib/rate-engine/schemas.ts

import { z } from 'zod';

export const CustomerTypeEnum = z.enum(['B2B', 'B2C'] as const, {
  errorMap: () => ({ message: "customerType must be either 'B2B' or 'B2C'" }),
});

export const ZoneTypeEnum = z.enum(['INTRA_ZONE', 'INTER_ZONE'] as const, {
  errorMap: () => ({ message: "zoneType must be either 'INTRA_ZONE' or 'INTER_ZONE'" }),
});

export const rateQuoteInputSchema = z.object({
  pickupPincode: z
    .string()
    .trim()
    .min(1, 'Pickup pincode is required')
    .max(10, 'Pickup pincode is too long'),
  dropPincode: z
    .string()
    .trim()
    .min(1, 'Drop pincode is required')
    .max(10, 'Drop pincode is too long'),
  customerType: CustomerTypeEnum.default('B2C'),
  lengthCm: z
    .number({ invalid_type_error: 'lengthCm must be a number' })
    .positive('lengthCm must be strictly greater than 0')
    .max(1000, 'lengthCm cannot exceed 1000 cm'),
  breadthCm: z
    .number({ invalid_type_error: 'breadthCm must be a number' })
    .positive('breadthCm must be strictly greater than 0')
    .max(1000, 'breadthCm cannot exceed 1000 cm'),
  heightCm: z
    .number({ invalid_type_error: 'heightCm must be a number' })
    .positive('heightCm must be strictly greater than 0')
    .max(1000, 'heightCm cannot exceed 1000 cm'),
  actualWeightKg: z
    .number({ invalid_type_error: 'actualWeightKg must be a number' })
    .positive('actualWeightKg must be strictly greater than 0')
    .max(10000, 'actualWeightKg cannot exceed 10000 kg'),
  isCod: z.boolean({ invalid_type_error: 'isCod must be a boolean' }).default(false),
  codAmount: z
    .number({ invalid_type_error: 'codAmount must be a number' })
    .nonnegative('codAmount cannot be negative')
    .optional()
    .default(0),
  declaredValue: z
    .number({ invalid_type_error: 'declaredValue must be a number' })
    .nonnegative('declaredValue cannot be negative')
    .optional()
    .default(0),
  volumetricDivisor: z
    .number({ invalid_type_error: 'volumetricDivisor must be a number' })
    .positive('volumetricDivisor must be strictly greater than 0')
    .optional(),
});

export const calculateRateRequestSchema = rateQuoteInputSchema;

export const rateCardPricingSchema = z.object({
  baseWeightKg: z.number().positive('baseWeightKg must be strictly greater than 0'),
  baseRate: z.number().nonnegative('baseRate cannot be negative'),
  perKgRate: z.number().nonnegative('perKgRate cannot be negative'),
  volumetricDivisor: z.number().positive('volumetricDivisor must be strictly greater than 0'),
  codFixedSurcharge: z.number().nonnegative('codFixedSurcharge cannot be negative'),
  codPercentSurcharge: z.number().nonnegative('codPercentSurcharge cannot be negative'),
  minCodSurcharge: z.number().nonnegative('minCodSurcharge cannot be negative'),
});

// ==========================================
// Zone Validation Schemas
// ==========================================
export const createZoneSchema = z.object({
  name: z.string().trim().min(2, 'Zone name must be at least 2 characters').max(100),
  code: z
    .string()
    .trim()
    .min(2, 'Zone code must be at least 2 characters')
    .max(50)
    .regex(/^[A-Z0-9_-]+$/, 'Zone code must contain only uppercase letters, numbers, underscores, or hyphens'),
  description: z.string().trim().max(500).optional().nullable(),
  isActive: z.boolean().optional().default(true),
});

export const updateZoneSchema = z.object({
  name: z.string().trim().min(2, 'Zone name must be at least 2 characters').max(100).optional(),
  code: z
    .string()
    .trim()
    .min(2, 'Zone code must be at least 2 characters')
    .max(50)
    .regex(/^[A-Z0-9_-]+$/, 'Zone code must contain only uppercase letters, numbers, underscores, or hyphens')
    .optional(),
  description: z.string().trim().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
});

// ==========================================
// Pincode Validation Schemas
// ==========================================
export const createPincodeSchema = z.object({
  pincode: z
    .string()
    .trim()
    .min(3, 'Pincode must be at least 3 characters')
    .max(10, 'Pincode must be at most 10 characters'),
  areaName: z.string().trim().max(200).optional().nullable(),
  zoneId: z.string().trim().min(1, 'zoneId is required'),
});

export const bulkCreatePincodeSchema = z.object({
  items: z
    .array(createPincodeSchema)
    .min(1, 'At least one pincode item must be provided')
    .max(500, 'Maximum 500 items per bulk upload request'),
});

export const updatePincodeSchema = z.object({
  areaName: z.string().trim().max(200).optional().nullable(),
  zoneId: z.string().trim().min(1, 'zoneId must not be empty').optional(),
});

// ==========================================
// Rate Card Validation Schemas
// ==========================================
export const createRateCardSchema = z.object({
  zoneType: ZoneTypeEnum,
  customerType: CustomerTypeEnum,
  baseWeightKg: z.number().positive('Base weight must be strictly greater than 0').default(0.5),
  baseRate: z.number().nonnegative('Base rate cannot be negative'),
  perKgRate: z.number().nonnegative('Per kg rate cannot be negative'),
  volumetricDivisor: z.number().positive('Volumetric divisor must be strictly greater than 0').default(5000),
  codFixedSurcharge: z.number().nonnegative('COD fixed surcharge cannot be negative').default(0.0),
  codPercentSurcharge: z.number().nonnegative('COD percent surcharge cannot be negative').default(0.0),
  minCodSurcharge: z.number().nonnegative('Minimum COD surcharge cannot be negative').default(0.0),
  isActive: z.boolean().optional().default(true),
});

export const updateRateCardSchema = z.object({
  zoneType: ZoneTypeEnum.optional(),
  customerType: CustomerTypeEnum.optional(),
  baseWeightKg: z.number().positive('Base weight must be strictly greater than 0').optional(),
  baseRate: z.number().nonnegative('Base rate cannot be negative').optional(),
  perKgRate: z.number().nonnegative('Per kg rate cannot be negative').optional(),
  volumetricDivisor: z.number().positive('Volumetric divisor must be strictly greater than 0').optional(),
  codFixedSurcharge: z.number().nonnegative('COD fixed surcharge cannot be negative').optional(),
  codPercentSurcharge: z.number().nonnegative('COD percent surcharge cannot be negative').optional(),
  minCodSurcharge: z.number().nonnegative('Minimum COD surcharge cannot be negative').optional(),
  isActive: z.boolean().optional(),
});
