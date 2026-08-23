// /home/skrisps/lastmile/tests/unit/order-status-machine.test.ts

import { describe, it, expect } from 'vitest';
import {
  ORDER_STATUSES,
  OrderStatus,
  VALID_TRANSITIONS,
  InvalidStatusTransitionError,
  MissingStatusReasonError,
  isValidOrderStatus,
  isValidTransition,
  validateTransition,
  isTerminalStatus,
  isReasonRequired,
  deriveCurrentStatus,
  getStatusProgressPercentage,
  getStatusLabel,
  StatusHistoryEvent,
} from '@/lib/orders/status-machine';

describe('Unit: Order Status Finite State Machine & Ledger Projection Suite', () => {
  describe('1. Valid FSM Status Transitions in Isolation', () => {
    it('should allow valid transitions from CREATED -> ASSIGNED, CANCELLED', () => {
      expect(isValidTransition('CREATED', 'ASSIGNED')).toBe(true);
      expect(isValidTransition('CREATED', 'CANCELLED')).toBe(true);
      expect(() => validateTransition('CREATED', 'ASSIGNED')).not.toThrow();
      expect(() => validateTransition('CREATED', 'CANCELLED')).not.toThrow();
    });

    it('should allow valid transitions from ASSIGNED -> PICKED_UP, CANCELLED', () => {
      expect(isValidTransition('ASSIGNED', 'PICKED_UP')).toBe(true);
      expect(isValidTransition('ASSIGNED', 'CANCELLED')).toBe(true);
      expect(() => validateTransition('ASSIGNED', 'PICKED_UP')).not.toThrow();
      expect(() => validateTransition('ASSIGNED', 'CANCELLED')).not.toThrow();
    });

    it('should allow valid transitions from PICKED_UP -> IN_TRANSIT, FAILED', () => {
      expect(isValidTransition('PICKED_UP', 'IN_TRANSIT')).toBe(true);
      expect(isValidTransition('PICKED_UP', 'FAILED')).toBe(true);
      expect(() => validateTransition('PICKED_UP', 'IN_TRANSIT')).not.toThrow();
      expect(() => validateTransition('PICKED_UP', 'FAILED')).not.toThrow();
    });

    it('should allow valid transitions from IN_TRANSIT -> OUT_FOR_DELIVERY, FAILED', () => {
      expect(isValidTransition('IN_TRANSIT', 'OUT_FOR_DELIVERY')).toBe(true);
      expect(isValidTransition('IN_TRANSIT', 'FAILED')).toBe(true);
      expect(() => validateTransition('IN_TRANSIT', 'OUT_FOR_DELIVERY')).not.toThrow();
      expect(() => validateTransition('IN_TRANSIT', 'FAILED')).not.toThrow();
    });

    it('should allow valid transitions from OUT_FOR_DELIVERY -> DELIVERED, FAILED', () => {
      expect(isValidTransition('OUT_FOR_DELIVERY', 'DELIVERED')).toBe(true);
      expect(isValidTransition('OUT_FOR_DELIVERY', 'FAILED')).toBe(true);
      expect(() => validateTransition('OUT_FOR_DELIVERY', 'DELIVERED')).not.toThrow();
      expect(() => validateTransition('OUT_FOR_DELIVERY', 'FAILED')).not.toThrow();
    });

    it('should allow valid transitions from FAILED -> RESCHEDULED, CANCELLED', () => {
      expect(isValidTransition('FAILED', 'RESCHEDULED')).toBe(true);
      expect(isValidTransition('FAILED', 'CANCELLED')).toBe(true);
      expect(() => validateTransition('FAILED', 'RESCHEDULED')).not.toThrow();
      expect(() => validateTransition('FAILED', 'CANCELLED')).not.toThrow();
    });

    it('should allow valid transitions from RESCHEDULED -> ASSIGNED, OUT_FOR_DELIVERY, CANCELLED', () => {
      expect(isValidTransition('RESCHEDULED', 'ASSIGNED')).toBe(true);
      expect(isValidTransition('RESCHEDULED', 'OUT_FOR_DELIVERY')).toBe(true);
      expect(isValidTransition('RESCHEDULED', 'CANCELLED')).toBe(true);
      expect(() => validateTransition('RESCHEDULED', 'ASSIGNED')).not.toThrow();
      expect(() => validateTransition('RESCHEDULED', 'OUT_FOR_DELIVERY')).not.toThrow();
      expect(() => validateTransition('RESCHEDULED', 'CANCELLED')).not.toThrow();
    });
  });

  describe('2. Comprehensive 9x9 Transition Permutation Matrix Testing', () => {
    it('should correctly accept or reject all 81 transition permutations', () => {
      for (const from of ORDER_STATUSES) {
        const allowedTargets = VALID_TRANSITIONS[from];
        for (const to of ORDER_STATUSES) {
          const isAllowed = allowedTargets.includes(to);
          expect(isValidTransition(from, to)).toBe(isAllowed);

          if (isAllowed) {
            expect(() => validateTransition(from, to)).not.toThrow();
          } else {
            expect(() => validateTransition(from, to)).toThrow(InvalidStatusTransitionError);
            try {
              validateTransition(from, to);
            } catch (err: any) {
              expect(err).toBeInstanceOf(InvalidStatusTransitionError);
              expect(err.currentStatus).toBe(from);
              expect(err.targetStatus).toBe(to);
              expect(err.statusCode).toBe(400);
              expect(err.validNextStatuses).toEqual(allowedTargets);
            }
          }
        }
      }
    });

    it('should strictly enforce that terminal states (DELIVERED, CANCELLED) have zero outgoing transitions', () => {
      expect(isTerminalStatus('DELIVERED')).toBe(true);
      expect(isTerminalStatus('CANCELLED')).toBe(true);

      for (const status of ORDER_STATUSES) {
        if (status !== 'DELIVERED' && status !== 'CANCELLED') {
          expect(isTerminalStatus(status)).toBe(false);
        }
      }

      for (const target of ORDER_STATUSES) {
        expect(isValidTransition('DELIVERED', target)).toBe(false);
        expect(() => validateTransition('DELIVERED', target)).toThrow(InvalidStatusTransitionError);
        expect(isValidTransition('CANCELLED', target)).toBe(false);
        expect(() => validateTransition('CANCELLED', target)).toThrow(InvalidStatusTransitionError);
      }
    });

    it('should reject direct backward skips and jumps (e.g. DELIVERED -> CREATED, IN_TRANSIT -> CREATED)', () => {
      expect(() => validateTransition('DELIVERED', 'CREATED')).toThrow(InvalidStatusTransitionError);
      expect(() => validateTransition('IN_TRANSIT', 'CREATED')).toThrow(InvalidStatusTransitionError);
      expect(() => validateTransition('CREATED', 'DELIVERED')).toThrow(InvalidStatusTransitionError);
      expect(() => validateTransition('CREATED', 'OUT_FOR_DELIVERY')).toThrow(InvalidStatusTransitionError);
      expect(() => validateTransition('ASSIGNED', 'DELIVERED')).toThrow(InvalidStatusTransitionError);
    });
  });

  describe('3. Reason Requirement Verification on FAILED Status', () => {
    it('should identify that reason is strictly required only for FAILED status', () => {
      expect(isReasonRequired('FAILED')).toBe(true);
      expect(isReasonRequired('CREATED')).toBe(false);
      expect(isReasonRequired('ASSIGNED')).toBe(false);
      expect(isReasonRequired('PICKED_UP')).toBe(false);
      expect(isReasonRequired('IN_TRANSIT')).toBe(false);
      expect(isReasonRequired('OUT_FOR_DELIVERY')).toBe(false);
      expect(isReasonRequired('DELIVERED')).toBe(false);
      expect(isReasonRequired('RESCHEDULED')).toBe(false);
      expect(isReasonRequired('CANCELLED')).toBe(false);
    });

    it('should properly instantiate MissingStatusReasonError with statusCode 400', () => {
      const err = new MissingStatusReasonError('FAILED');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(MissingStatusReasonError);
      expect(err.name).toBe('MissingStatusReasonError');
      expect(err.statusCode).toBe(400);
      expect(err.message).toContain("reason is strictly required when transitioning order to 'FAILED'");
    });
  });

  describe('4. Status Derivation from Arbitrary History Event Sequences', () => {
    it('should derive status from a single event', () => {
      const history: StatusHistoryEvent[] = [
        { status: 'CREATED', createdAt: new Date('2026-08-23T10:00:00Z') },
      ];
      expect(deriveCurrentStatus(history)).toBe('CREATED');
    });

    it('should derive current status from chronological multi-event ledger', () => {
      const history: StatusHistoryEvent[] = [
        { status: 'CREATED', createdAt: new Date('2026-08-23T10:00:00Z') },
        { status: 'ASSIGNED', createdAt: new Date('2026-08-23T10:30:00Z') },
        { status: 'PICKED_UP', createdAt: new Date('2026-08-23T11:00:00Z') },
        { status: 'IN_TRANSIT', createdAt: new Date('2026-08-23T11:30:00Z') },
        { status: 'OUT_FOR_DELIVERY', createdAt: new Date('2026-08-23T12:00:00Z') },
        { status: 'DELIVERED', createdAt: new Date('2026-08-23T12:30:00Z') },
      ];
      expect(deriveCurrentStatus(history)).toBe('DELIVERED');
    });

    it('should derive current status from completely unordered/scrambled history with mixed Date and ISO strings', () => {
      const history: StatusHistoryEvent[] = [
        { status: 'IN_TRANSIT', createdAt: '2026-08-23T11:30:00Z' },
        { status: 'DELIVERED', createdAt: new Date('2026-08-23T15:45:00Z') },
        { status: 'CREATED', createdAt: '2026-08-23T09:00:00Z' },
        { status: 'OUT_FOR_DELIVERY', createdAt: '2026-08-23T14:00:00Z' },
        { status: 'ASSIGNED', createdAt: new Date('2026-08-23T10:00:00Z') },
        { status: 'PICKED_UP', createdAt: '2026-08-23T11:00:00Z' },
      ];
      expect(deriveCurrentStatus(history)).toBe('DELIVERED');
    });

    it('should accurately project FAILED, RESCHEDULED, and cyclical transitions', () => {
      const cycleHistory: StatusHistoryEvent[] = [
        { status: 'CREATED', createdAt: new Date('2026-08-23T08:00:00Z') },
        { status: 'ASSIGNED', createdAt: new Date('2026-08-23T08:30:00Z') },
        { status: 'PICKED_UP', createdAt: new Date('2026-08-23T09:00:00Z') },
        { status: 'IN_TRANSIT', createdAt: new Date('2026-08-23T09:30:00Z') },
        { status: 'OUT_FOR_DELIVERY', createdAt: new Date('2026-08-23T10:00:00Z') },
        { status: 'FAILED', reason: 'Customer unavailable', createdAt: new Date('2026-08-23T11:00:00Z') },
        { status: 'RESCHEDULED', reason: 'Requested delivery tomorrow', createdAt: new Date('2026-08-23T12:00:00Z') },
        { status: 'OUT_FOR_DELIVERY', createdAt: new Date('2026-08-24T09:00:00Z') },
      ];
      expect(deriveCurrentStatus(cycleHistory)).toBe('OUT_FOR_DELIVERY');
    });

    it('should throw error when history list is empty, null, or undefined', () => {
      expect(() => deriveCurrentStatus([])).toThrow('Cannot derive order status: no status history events found.');
      expect(() => deriveCurrentStatus(null)).toThrow('Cannot derive order status: no status history events found.');
      expect(() => deriveCurrentStatus(undefined)).toThrow('Cannot derive order status: no status history events found.');
    });

    it('should throw error when history contains an unknown/corrupt status string', () => {
      const corruptHistory: StatusHistoryEvent[] = [
        { status: 'SOMETHING_INVALID', createdAt: new Date() },
      ];
      expect(() => deriveCurrentStatus(corruptHistory)).toThrow('Invalid status found in history ledger: SOMETHING_INVALID');
    });
  });

  describe('5. Status Helpers & Metadata Utilities', () => {
    it('should validate status recognized strings with isValidOrderStatus', () => {
      for (const s of ORDER_STATUSES) {
        expect(isValidOrderStatus(s)).toBe(true);
      }
      expect(isValidOrderStatus('UNKNOWN')).toBe(false);
      expect(isValidOrderStatus('')).toBe(false);
      expect(isValidOrderStatus(null)).toBe(false);
      expect(isValidOrderStatus(123)).toBe(false);
    });

    it('should provide monotonically increasing progress percentage across happy path', () => {
      const path: OrderStatus[] = ['CREATED', 'ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'];
      let prevProgress = 0;
      for (const s of path) {
        const progress = getStatusProgressPercentage(s);
        expect(progress).toBeGreaterThan(prevProgress);
        prevProgress = progress;
      }
      expect(getStatusProgressPercentage('DELIVERED')).toBe(100);
      expect(getStatusProgressPercentage('CANCELLED')).toBe(0);
    });

    it('should provide human-readable labels for all statuses', () => {
      for (const s of ORDER_STATUSES) {
        const label = getStatusLabel(s);
        expect(typeof label).toBe('string');
        expect(label.length).toBeGreaterThan(0);
      }
      expect(getStatusLabel('CREATED')).toBe('Order Placed');
      expect(getStatusLabel('OUT_FOR_DELIVERY')).toBe('Out for Delivery');
      expect(getStatusLabel('DELIVERED')).toBe('Delivered');
      expect(getStatusLabel('FAILED')).toBe('Delivery Failed');
      expect(getStatusLabel('RESCHEDULED')).toBe('Rescheduled');
    });
  });
});
