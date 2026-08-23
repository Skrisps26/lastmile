// /home/skrisps/lastmile/src/lib/orders/status-machine.ts

export const ORDER_STATUSES = [
  'CREATED',
  'ASSIGNED',
  'PICKED_UP',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'FAILED',
  'RESCHEDULED',
  'CANCELLED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const VALID_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  CREATED: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['PICKED_UP', 'CANCELLED'],
  PICKED_UP: ['IN_TRANSIT', 'FAILED'],
  IN_TRANSIT: ['OUT_FOR_DELIVERY', 'FAILED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'FAILED'],
  FAILED: ['RESCHEDULED', 'CANCELLED'],
  RESCHEDULED: ['ASSIGNED', 'OUT_FOR_DELIVERY', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
} as const;

export class InvalidStatusTransitionError extends Error {
  public readonly currentStatus: OrderStatus;
  public readonly targetStatus: OrderStatus;
  public readonly validNextStatuses: readonly OrderStatus[];
  public readonly statusCode: number = 400;

  constructor(currentStatus: OrderStatus, targetStatus: OrderStatus) {
    const valid = VALID_TRANSITIONS[currentStatus] || [];
    const validMsg =
      valid.length > 0
        ? `Allowed transitions from '${currentStatus}' are: [${valid.join(', ')}]`
        : `'${currentStatus}' is a terminal state with no forward transitions.`;

    super(`Invalid status transition from '${currentStatus}' to '${targetStatus}'. ${validMsg}`);
    this.name = 'InvalidStatusTransitionError';
    this.currentStatus = currentStatus;
    this.targetStatus = targetStatus;
    this.validNextStatuses = valid;
    Object.setPrototypeOf(this, InvalidStatusTransitionError.prototype);
  }
}

export class MissingStatusReasonError extends Error {
  public readonly status: OrderStatus;
  public readonly statusCode: number = 400;

  constructor(status: OrderStatus) {
    super(`A valid reason is strictly required when transitioning order to '${status}'.`);
    this.name = 'MissingStatusReasonError';
    this.status = status;
    Object.setPrototypeOf(this, MissingStatusReasonError.prototype);
  }
}

/**
 * Validates whether a given string is a valid recognized OrderStatus.
 */
export function isValidOrderStatus(status: unknown): status is OrderStatus {
  return typeof status === 'string' && ORDER_STATUSES.includes(status as OrderStatus);
}

/**
 * Checks if transition between two statuses is allowed.
 */
export function isValidTransition(currentStatus: OrderStatus, targetStatus: OrderStatus): boolean {
  if (!VALID_TRANSITIONS[currentStatus]) {
    return false;
  }
  return VALID_TRANSITIONS[currentStatus].includes(targetStatus);
}

/**
 * Validates a transition and throws InvalidStatusTransitionError if not allowed.
 */
export function validateTransition(currentStatus: OrderStatus, targetStatus: OrderStatus): void {
  if (!isValidTransition(currentStatus, targetStatus)) {
    throw new InvalidStatusTransitionError(currentStatus, targetStatus);
  }
}

/**
 * Checks if a status is a terminal state (no transitions allowed).
 */
export function isTerminalStatus(status: OrderStatus): boolean {
  return (VALID_TRANSITIONS[status] || []).length === 0;
}

/**
 * Checks if a reason is required for the target status (e.g. FAILED).
 */
export function isReasonRequired(targetStatus: OrderStatus): boolean {
  return targetStatus === 'FAILED';
}

export interface StatusHistoryEvent {
  status: string;
  createdAt: Date | string;
  id?: string;
  reason?: string | null;
  notes?: string | null;
  metadata?: string | null;
  changedById?: string | null;
}

/**
 * Derives current order status strictly from the latest ledger event ordered by createdAt descending.
 * Throws an Error if the history list is empty.
 */
export function deriveCurrentStatus(historyList: StatusHistoryEvent[] | null | undefined): OrderStatus {
  if (!historyList || historyList.length === 0) {
    throw new Error('Cannot derive order status: no status history events found.');
  }

  // Sort events descending by createdAt
  const sorted = [...historyList].sort((a, b) => {
    const timeA = new Date(a.createdAt).getTime();
    const timeB = new Date(b.createdAt).getTime();
    return timeB - timeA;
  });

  const latest = sorted[0];
  if (!isValidOrderStatus(latest.status)) {
    throw new Error(`Invalid status found in history ledger: ${latest.status}`);
  }

  return latest.status;
}

/**
 * Calculates delivery progress percentage (0-100) for a status.
 */
export function getStatusProgressPercentage(status: OrderStatus): number {
  switch (status) {
    case 'CREATED':
      return 15;
    case 'ASSIGNED':
      return 30;
    case 'PICKED_UP':
      return 50;
    case 'IN_TRANSIT':
      return 70;
    case 'OUT_FOR_DELIVERY':
      return 85;
    case 'DELIVERED':
      return 100;
    case 'FAILED':
      return 60;
    case 'RESCHEDULED':
      return 30;
    case 'CANCELLED':
      return 0;
    default:
      return 0;
  }
}

/**
 * Friendly label for public tracking UI and emails.
 */
export function getStatusLabel(status: OrderStatus): string {
  switch (status) {
    case 'CREATED':
      return 'Order Placed';
    case 'ASSIGNED':
      return 'Agent Assigned';
    case 'PICKED_UP':
      return 'Picked Up';
    case 'IN_TRANSIT':
      return 'In Transit';
    case 'OUT_FOR_DELIVERY':
      return 'Out for Delivery';
    case 'DELIVERED':
      return 'Delivered';
    case 'FAILED':
      return 'Delivery Failed';
    case 'RESCHEDULED':
      return 'Rescheduled';
    case 'CANCELLED':
      return 'Cancelled';
  }
}
