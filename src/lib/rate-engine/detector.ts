// /home/skrisps/lastmile/src/lib/rate-engine/detector.ts

import { prisma } from '@/lib/prisma';
import { ZoneType, ZoneInfo, PincodeInfo, ZoneDetectionResult } from './types';

export class PincodeNotServiceableError extends Error {
  public readonly pincode: string;
  public readonly locationType: 'pickup' | 'drop' | 'general';
  public readonly statusCode: number = 404;

  constructor(
    pincode: string,
    locationType: 'pickup' | 'drop' | 'general' = 'general',
    customMessage?: string
  ) {
    const defaultMsg =
      locationType === 'general'
        ? `Pincode '${pincode}' is not serviceable. Please provide a supported delivery pincode.`
        : `Pincode '${pincode}' (${locationType}) is not serviceable. Please verify the ${locationType} address.`;

    super(customMessage || defaultMsg);
    this.name = 'PincodeNotServiceableError';
    this.pincode = pincode;
    this.locationType = locationType;
    Object.setPrototypeOf(this, PincodeNotServiceableError.prototype);
  }
}

/**
 * Looks up a single pincode and its mapped zone.
 * Returns null if the pincode is unmapped or mapped to an inactive zone.
 */
export async function lookupPincode(rawPincode: string): Promise<PincodeInfo | null> {
  if (!rawPincode || typeof rawPincode !== 'string') {
    return null;
  }

  const pincode = rawPincode.trim();
  if (!pincode) return null;

  const mapping = await prisma.pincodeMapping.findUnique({
    where: { pincode },
    include: {
      zone: true,
    },
  });

  if (!mapping || !mapping.zone || !mapping.zone.isActive) {
    return null;
  }

  return {
    pincode: mapping.pincode,
    areaName: mapping.areaName,
    zone: {
      id: mapping.zone.id,
      name: mapping.zone.name,
      code: mapping.zone.code,
      description: mapping.zone.description,
      isActive: mapping.zone.isActive,
    },
  };
}

/**
 * Validates serviceability for pickup and drop pincodes, resolves their zones,
 * and determines whether shipment is INTRA_ZONE or INTER_ZONE.
 * Throws PincodeNotServiceableError (404) if either pincode is unmapped or inactive.
 */
export async function detectZones(
  pickupPincode: string,
  dropPincode: string
): Promise<ZoneDetectionResult> {
  const cleanPickup = (pickupPincode || '').trim();
  const cleanDrop = (dropPincode || '').trim();

  if (!cleanPickup) {
    throw new PincodeNotServiceableError('', 'pickup', 'Pickup pincode is required');
  }
  if (!cleanDrop) {
    throw new PincodeNotServiceableError('', 'drop', 'Drop pincode is required');
  }

  const [pickupResult, dropResult] = await Promise.all([
    lookupPincode(cleanPickup),
    lookupPincode(cleanDrop),
  ]);

  if (!pickupResult) {
    throw new PincodeNotServiceableError(
      cleanPickup,
      'pickup',
      `Pickup pincode ${cleanPickup} is not serviceable`
    );
  }

  if (!dropResult) {
    throw new PincodeNotServiceableError(
      cleanDrop,
      'drop',
      `Drop pincode ${cleanDrop} is not serviceable`
    );
  }

  const zoneType: ZoneType =
    pickupResult.zone.id === dropResult.zone.id ? 'INTRA_ZONE' : 'INTER_ZONE';

  return {
    pickupZone: pickupResult.zone,
    dropZone: dropResult.zone,
    pickupPincode: pickupResult.pincode,
    dropPincode: dropResult.pincode,
    pickupAreaName: pickupResult.areaName,
    dropAreaName: dropResult.areaName,
    zoneType,
  };
}

/**
 * Non-throwing serviceability checker for pre-flight frontend validation.
 */
export async function validateServiceability(
  pincode: string
): Promise<{ serviceable: boolean; pincode: string; zone?: ZoneInfo; areaName?: string | null; error?: string }> {
  const info = await lookupPincode(pincode);
  if (!info) {
    return {
      serviceable: false,
      pincode: (pincode || '').trim(),
      error: `Pincode '${(pincode || '').trim()}' is not currently serviceable`,
    };
  }
  return {
    serviceable: true,
    pincode: info.pincode,
    zone: info.zone,
    areaName: info.areaName,
  };
}
