// /home/skrisps/lastmile/tests/unit/detector.test.ts

import { describe, it, expect } from 'vitest';
import {
  lookupPincode,
  detectZones,
  validateServiceability,
  PincodeNotServiceableError,
} from '@/lib/rate-engine/detector';

describe('Unit: Zone & Pincode Detector Suite (M2-R1)', () => {
  describe('1. PincodeNotServiceableError Class', () => {
    it('should initialize with correct metadata and 404 status code', () => {
      const err = new PincodeNotServiceableError('999999', 'pickup');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(PincodeNotServiceableError);
      expect(err.pincode).toBe('999999');
      expect(err.locationType).toBe('pickup');
      expect(err.statusCode).toBe(404);
      expect(err.message).toMatch(/pincode '999999' \(pickup\) is not serviceable/i);
    });

    it('should support custom error messages', () => {
      const customErr = new PincodeNotServiceableError('888888', 'drop', 'Custom drop unserviceable error');
      expect(customErr.message).toBe('Custom drop unserviceable error');
    });
  });

  describe('2. lookupPincode Function', () => {
    it('should return ZoneInfo and areaName for a seeded valid pincode', async () => {
      const info = await lookupPincode('560001');
      expect(info).not.toBeNull();
      expect(info!.pincode).toBe('560001');
      expect(info!.zone.code).toBe('ZONE_NORTH');
      expect(info!.zone.isActive).toBe(true);
      expect(info!.areaName).toContain('Bangalore GPO');
    });

    it('should return null for an unmapped pincode', async () => {
      const info = await lookupPincode('999999');
      expect(info).toBeNull();
    });

    it('should trim surrounding whitespace in pincodes', async () => {
      const info = await lookupPincode('  560001  ');
      expect(info).not.toBeNull();
      expect(info!.pincode).toBe('560001');
    });

    it('should return null for empty or non-string inputs', async () => {
      expect(await lookupPincode('')).toBeNull();
      expect(await lookupPincode('   ')).toBeNull();
      // @ts-expect-error test invalid type
      expect(await lookupPincode(null)).toBeNull();
    });
  });

  describe('3. detectZones Function', () => {
    it('should classify shipments within the same zone as INTRA_ZONE', async () => {
      // 560001 (GPO) and 560024 (Hebbal) are both in ZONE_NORTH
      const result = await detectZones('560001', '560024');

      expect(result.zoneType).toBe('INTRA_ZONE');
      expect(result.pickupZone.code).toBe('ZONE_NORTH');
      expect(result.dropZone.code).toBe('ZONE_NORTH');
      expect(result.pickupZone.id).toBe(result.dropZone.id);
    });

    it('should classify shipments across different zones as INTER_ZONE', async () => {
      // 560001 (ZONE_NORTH) and 560034 (ZONE_SOUTH)
      const result = await detectZones('560001', '560034');

      expect(result.zoneType).toBe('INTER_ZONE');
      expect(result.pickupZone.code).toBe('ZONE_NORTH');
      expect(result.dropZone.code).toBe('ZONE_SOUTH');
      expect(result.pickupZone.id).not.toBe(result.dropZone.id);
    });

    it('should throw PincodeNotServiceableError when pickup pincode is unmapped', async () => {
      await expect(detectZones('999999', '560001')).rejects.toThrow(PincodeNotServiceableError);
      try {
        await detectZones('999999', '560001');
      } catch (err: any) {
        expect(err.statusCode).toBe(404);
        expect(err.locationType).toBe('pickup');
        expect(err.pincode).toBe('999999');
      }
    });

    it('should throw PincodeNotServiceableError when drop pincode is unmapped', async () => {
      await expect(detectZones('560001', '888888')).rejects.toThrow(PincodeNotServiceableError);
      try {
        await detectZones('560001', '888888');
      } catch (err: any) {
        expect(err.statusCode).toBe(404);
        expect(err.locationType).toBe('drop');
        expect(err.pincode).toBe('888888');
      }
    });

    it('should throw error when pickup or drop pincode is empty', async () => {
      await expect(detectZones('', '560001')).rejects.toThrow(PincodeNotServiceableError);
      await expect(detectZones('560001', '')).rejects.toThrow(PincodeNotServiceableError);
    });
  });

  describe('4. validateServiceability Function', () => {
    it('should return serviceable: true for mapped pincodes', async () => {
      const res = await validateServiceability('560001');
      expect(res.serviceable).toBe(true);
      expect(res.pincode).toBe('560001');
      expect(res.zone).toBeDefined();
      expect(res.zone!.code).toBe('ZONE_NORTH');
    });

    it('should return serviceable: false with error message for unmapped pincodes', async () => {
      const res = await validateServiceability('999999');
      expect(res.serviceable).toBe(false);
      expect(res.pincode).toBe('999999');
      expect(res.error).toBeDefined();
    });
  });
});
