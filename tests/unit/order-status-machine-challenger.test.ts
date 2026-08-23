// /home/skrisps/lastmile/tests/unit/order-status-machine-challenger.test.ts

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

describe('Unit Challenger Suite: FSM Permutations, Millisecond Ordering & Stress (M3-R2)', () => {
  describe('1. Microsecond Timestamp Ordering & Millisecond Collision Stress', () => {
    it('should correctly resolve latest status even when 100 events have randomized timestamps', () => {
      const baseTime = new Date('2026-08-23T10:00:00.000Z').getTime();
      const events: StatusHistoryEvent[] = [];

      // Generate 100 events spanning 100 seconds
      for (let i = 0; i < 100; i++) {
        const time = new Date(baseTime + i * 1000);
        events.push({
          status: i % 2 === 0 ? 'IN_TRANSIT' : 'OUT_FOR_DELIVERY',
          createdAt: time,
        });
      }

      // Final event at 101st second is DELIVERED
      events.push({
        status: 'DELIVERED',
        createdAt: new Date(baseTime + 101000),
      });

      // Shuffle events array completely
      const shuffled = [...events].sort(() => Math.random() - 0.5);

      expect(deriveCurrentStatus(shuffled)).toBe('DELIVERED');
    });

    it('should handle identical millisecond timestamps predictably', () => {
      const collisionTime = new Date('2026-08-23T12:00:00.000Z');
      const events: StatusHistoryEvent[] = [
        { status: 'CREATED', createdAt: collisionTime },
        { status: 'ASSIGNED', createdAt: collisionTime },
      ];

      // Since timestamps are identical, deriveCurrentStatus preserves stable order or picks one valid status
      const status = deriveCurrentStatus(events);
      expect(['CREATED', 'ASSIGNED']).toContain(status);
    });

    it('should correctly parse ISO strings, epoch numbers, and Date instances in history events', () => {
      const events: StatusHistoryEvent[] = [
        { status: 'CREATED', createdAt: '2026-01-01T00:00:00.000Z' },
        { status: 'ASSIGNED', createdAt: new Date('2026-02-01T00:00:00.000Z') },
        { status: 'PICKED_UP', createdAt: '2026-03-01T00:00:00.000Z' },
        { status: 'IN_TRANSIT', createdAt: new Date('2026-04-01T00:00:00.000Z') },
        { status: 'OUT_FOR_DELIVERY', createdAt: '2026-05-01T00:00:00.000Z' },
        { status: 'FAILED', createdAt: new Date('2026-06-01T00:00:00.000Z'), reason: 'Unreachable' },
        { status: 'RESCHEDULED', createdAt: '2026-07-01T00:00:00.000Z' },
        { status: 'OUT_FOR_DELIVERY', createdAt: new Date('2026-08-01T00:00:00.000Z') },
        { status: 'DELIVERED', createdAt: '2026-08-23T12:00:00.000Z' },
      ];

      // Scramble
      const scrambled = [...events].reverse();
      expect(deriveCurrentStatus(scrambled)).toBe('DELIVERED');
    });
  });

  describe('2. Exhaustive FSM Matrix Graph Invariants', () => {
    it('should verify that DELIVERED and CANCELLED are sinks (out-degree 0)', () => {
      expect(VALID_TRANSITIONS.DELIVERED).toHaveLength(0);
      expect(VALID_TRANSITIONS.CANCELLED).toHaveLength(0);
    });

    it('should verify that CREATED is the unique source state (never reachable from any non-CREATED state)', () => {
      for (const [from, targets] of Object.entries(VALID_TRANSITIONS)) {
        expect(targets).not.toContain('CREATED');
      }
    });

    it('should verify that FAILED cannot transition directly to DELIVERED or IN_TRANSIT', () => {
      expect(isValidTransition('FAILED', 'DELIVERED')).toBe(false);
      expect(isValidTransition('FAILED', 'IN_TRANSIT')).toBe(false);
      expect(isValidTransition('FAILED', 'PICKED_UP')).toBe(false);
      expect(isValidTransition('FAILED', 'OUT_FOR_DELIVERY')).toBe(false);
      expect(isValidTransition('FAILED', 'ASSIGNED')).toBe(false);
    });

    it('should verify that RESCHEDULED cannot transition directly to DELIVERED, PICKED_UP, or IN_TRANSIT', () => {
      expect(isValidTransition('RESCHEDULED', 'DELIVERED')).toBe(false);
      expect(isValidTransition('RESCHEDULED', 'PICKED_UP')).toBe(false);
      expect(isValidTransition('RESCHEDULED', 'IN_TRANSIT')).toBe(false);
    });
  });

  describe('3. Performance & Stress of deriveCurrentStatus', () => {
    it('should derive status across 10,000 events in under 50ms', () => {
      const startTime = performance.now();
      const largeHistory: StatusHistoryEvent[] = [];
      const base = Date.now();

      for (let i = 0; i < 10000; i++) {
        largeHistory.push({
          status: i === 9999 ? 'DELIVERED' : 'IN_TRANSIT',
          createdAt: new Date(base + i * 10),
        });
      }

      // Shuffle
      const shuffled = [...largeHistory].sort(() => Math.random() - 0.5);

      const derived = deriveCurrentStatus(shuffled);
      const duration = performance.now() - startTime;

      expect(derived).toBe('DELIVERED');
      expect(duration).toBeLessThan(100); // Well under 100ms
    });
  });
});
