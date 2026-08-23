// /home/skrisps/lastmile/src/lib/orders/service.ts

import { prisma } from '@/lib/prisma';
import {
  OrderStatus,
  deriveCurrentStatus,
  validateTransition,
  getStatusProgressPercentage,
  getStatusLabel,
  MissingStatusReasonError,
} from './status-machine';
import {
  CreateOrderInput,
  OrderFilterParams,
  PublicTrackingDetails,
  PublicTrackingTimelineEvent,
} from './types';
import { lookupPincode, PincodeNotServiceableError } from '@/lib/rate-engine/detector';
import { computeRateQuote } from '@/lib/rate-engine/calculator';
import { type AuthSessionUser } from '@/lib/auth/jwt';
import { releaseAgentOrder } from '@/lib/agents/assignment';
import { notifyOrderStatusChange } from '@/lib/notifications/service';

export class OrderNotFoundError extends Error {
  public readonly orderId: string;
  public readonly statusCode: number = 404;

  constructor(orderId: string) {
    super(`Order with ID '${orderId}' was not found.`);
    this.name = 'OrderNotFoundError';
    this.orderId = orderId;
    Object.setPrototypeOf(this, OrderNotFoundError.prototype);
  }
}

export class OrderAccessForbiddenError extends Error {
  public readonly statusCode: number = 403;

  constructor(message: string = 'Forbidden: You do not have permission to access this order.') {
    super(message);
    this.name = 'OrderAccessForbiddenError';
    Object.setPrototypeOf(this, OrderAccessForbiddenError.prototype);
  }
}

/**
 * Generates a unique tracking number in the format: LMD-YYYYMMDD-XXXXX
 */
export function generateTrackingNumber(date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let randomSuffix = '';
  for (let i = 0; i < 5; i++) {
    randomSuffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `LMD-${yyyy}${mm}${dd}-${randomSuffix}`;
}

/**
 * Creates a new order with live dynamic rate quote calculation snapshot,
 * unique tracking number, and initial 'CREATED' audit ledger event in a single transaction.
 */
export async function createOrder(data: CreateOrderInput, customerId: string) {
  // 1. Resolve Pickup and Drop Pincodes and Zones
  const pickupInfo = await lookupPincode(data.pickupPincode);
  if (!pickupInfo) {
    throw new PincodeNotServiceableError(
      data.pickupPincode,
      'pickup',
      `Pickup pincode '${data.pickupPincode}' is not serviceable.`
    );
  }

  const dropInfo = await lookupPincode(data.dropPincode);
  if (!dropInfo) {
    throw new PincodeNotServiceableError(
      data.dropPincode,
      'drop',
      `Drop pincode '${data.dropPincode}' is not serviceable.`
    );
  }

  // 2. Determine Zone Type
  const zoneType = pickupInfo.zone.id === dropInfo.zone.id ? 'INTRA_ZONE' : 'INTER_ZONE';
  const customerType = data.customerType || 'B2C';

  // 3. Find Active Rate Card
  const rateCard = await prisma.rateCard.findFirst({
    where: {
      zoneType,
      customerType,
      isActive: true,
    },
  });

  if (!rateCard) {
    throw new Error(
      `No active rate card found for zone type '${zoneType}' and customer type '${customerType}'.`
    );
  }

  // 4. Compute Rate Quote Snapshot
  const calcResult = computeRateQuote(
    {
      lengthCm: data.packageLengthCm,
      breadthCm: data.packageBreadthCm,
      heightCm: data.packageHeightCm,
      actualWeightKg: data.actualWeightKg,
      isCod: !!data.isCod,
      codAmount: data.codAmount,
      declaredValue: data.declaredValue,
      volumetricDivisor: data.volumetricDivisor,
    },
    rateCard
  );

  // 5. Generate Unique Tracking Number
  let trackingNumber = generateTrackingNumber();
  let existing = await prisma.order.findUnique({ where: { trackingNumber } });
  while (existing) {
    trackingNumber = generateTrackingNumber();
    existing = await prisma.order.findUnique({ where: { trackingNumber } });
  }

  // 6. Execute Atomic Transaction (Order Creation + Initial Status Ledger Event)
  const scheduledDateVal = data.scheduledDate ? new Date(data.scheduledDate) : null;

  const result = await prisma.$transaction(async (tx) => {
    const createdOrder = await tx.order.create({
      data: {
        trackingNumber,
        customerId,
        customerType,
        senderName: data.senderName,
        senderPhone: data.senderPhone,
        senderStreet: data.senderStreet,
        senderCity: data.senderCity,
        senderState: data.senderState,
        pickupPincode: pickupInfo.pincode,
        pickupZoneId: pickupInfo.zone.id,
        recipientName: data.recipientName,
        recipientPhone: data.recipientPhone,
        recipientStreet: data.recipientStreet,
        recipientCity: data.recipientCity,
        recipientState: data.recipientState,
        dropPincode: dropInfo.pincode,
        dropZoneId: dropInfo.zone.id,
        packageLengthCm: data.packageLengthCm,
        packageBreadthCm: data.packageBreadthCm,
        packageHeightCm: data.packageHeightCm,
        actualWeightKg: calcResult.actualWeightKg,
        volumetricWeightKg: calcResult.volumetricWeightKg,
        billableWeightKg: calcResult.billableWeightKg,
        volumetricDivisor: calcResult.volumetricDivisor,
        zoneType,
        basePrice: calcResult.basePrice,
        weightPrice: calcResult.weightPrice,
        codSurcharge: calcResult.codSurcharge,
        totalAmount: calcResult.totalAmount,
        isCod: !!data.isCod,
        codAmount: data.isCod ? (data.codAmount ?? 0) : 0,
        declaredValue: data.declaredValue ?? 0,
        scheduledDate: scheduledDateVal,
        notes: data.notes || null,
      },
      include: {
        pickupZone: true,
        dropZone: true,
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });

    const initialHistory = await tx.orderStatusHistory.create({
      data: {
        orderId: createdOrder.id,
        status: 'CREATED',
        changedById: customerId,
        reason: null,
        notes: data.notes || 'Order booked and registered in system.',
        metadata: JSON.stringify({
          action: 'ORDER_CREATED',
          zoneType,
          billableWeightKg: calcResult.billableWeightKg,
          totalAmount: calcResult.totalAmount,
        }),
      },
      include: {
        changedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });

    return {
      ...createdOrder,
      currentStatus: 'CREATED' as OrderStatus,
      statusHistory: [initialHistory],
    };
  });

  await notifyOrderStatusChange(result.id, 'CREATED', data.notes);
  return result;
}

/**
 * Appends a new immutable status transition to the order's event ledger.
 * Validates FSM transition matrix and mandates reason on FAILED.
 */
export async function transitionOrderStatus(
  orderId: string,
  targetStatus: OrderStatus,
  changedById?: string | null,
  reason?: string | null,
  notes?: string | null,
  metadata?: Record<string, unknown> | string | null
) {
  // 1. Fetch Order and Full Event Ledger
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      statusHistory: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!order) {
    throw new OrderNotFoundError(orderId);
  }

  // 2. Project Current Status Strictly from Latest Event
  const currentStatus = deriveCurrentStatus(order.statusHistory);

  // 3. Validate Transition Against FSM Matrix
  validateTransition(currentStatus, targetStatus);

  // 4. Validate Reason Requirement for FAILED
  if (targetStatus === 'FAILED' && (!reason || reason.trim().length === 0)) {
    throw new MissingStatusReasonError(targetStatus);
  }

  const metaString =
    typeof metadata === 'object' && metadata !== null
      ? JSON.stringify(metadata)
      : metadata || null;

  // 5. Append New Event to Ledger (IMMUTABLE: strictly creates new row)
  const newHistoryRecord = await prisma.orderStatusHistory.create({
    data: {
      orderId: order.id,
      status: targetStatus,
      changedById: changedById || null,
      reason: reason ? reason.trim() : null,
      notes: notes ? notes.trim() : null,
      metadata: metaString,
    },
    include: {
      changedBy: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      },
    },
  });

  // 5.1 Release agent load if order reached terminal or failed state
  if (['DELIVERED', 'FAILED', 'CANCELLED'].includes(targetStatus) && order.assignedAgentId) {
    await releaseAgentOrder(order.id, order.assignedAgentId);
  }

  // 6. Return Full Updated Order with Projected Current Status
  const updatedOrder = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      pickupZone: true,
      dropZone: true,
      customer: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      },
      assignedAgent: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
        },
      },
      statusHistory: {
        orderBy: { createdAt: 'asc' },
        include: {
          changedBy: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
        },
      },
    },
  });

  if (!updatedOrder) {
    throw new OrderNotFoundError(orderId);
  }

  const response = {
    ...updatedOrder,
    currentStatus: deriveCurrentStatus(updatedOrder.statusHistory),
    latestEvent: newHistoryRecord,
  };

  await notifyOrderStatusChange(orderId, targetStatus, reason);
  return response;
}

/** Compatibility alias for integrations using the original service name. */
export const updateOrderStatus = transitionOrderStatus;

/**
 * Reschedules a delivery for a failed order.
 * Updates scheduledDate on Order and appends a 'RESCHEDULED' ledger event.
 */
export async function rescheduleOrder(
  orderId: string,
  newScheduledDate: string | Date,
  customerId?: string | null,
  reason?: string | null
) {
  // 1. Fetch Order and Full Event Ledger
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      statusHistory: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!order) {
    throw new OrderNotFoundError(orderId);
  }

  // 2. Project Current Status and Verify It is 'FAILED'
  const currentStatus = deriveCurrentStatus(order.statusHistory);
  if (currentStatus !== 'FAILED') {
    throw new Error(
      `Cannot reschedule order: only orders in 'FAILED' state can be rescheduled. Current status is '${currentStatus}'.`
    );
  }

  // 3. Validate Transition
  validateTransition(currentStatus, 'RESCHEDULED');

  const parsedDate = new Date(newScheduledDate);
  if (isNaN(parsedDate.getTime())) {
    throw new Error(`Invalid scheduled date provided: '${newScheduledDate}'.`);
  }

  // 4. Update Scheduled Date & Append RESCHEDULED Ledger Event
  const result = await prisma.$transaction(async (tx) => {
    const updatedOrder = await tx.order.update({
      where: { id: orderId },
      data: {
        scheduledDate: parsedDate,
      },
      include: {
        pickupZone: true,
        dropZone: true,
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
        assignedAgent: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
    });

    const newHistory = await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        status: 'RESCHEDULED',
        changedById: customerId || null,
        reason: reason || 'Customer requested delivery reschedule',
        notes: `Delivery rescheduled for ${parsedDate.toISOString()}`,
        metadata: JSON.stringify({
          previousScheduledDate: order.scheduledDate ? order.scheduledDate.toISOString() : null,
          newScheduledDate: parsedDate.toISOString(),
        }),
      },
      include: {
        changedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });

    const allHistory = await tx.orderStatusHistory.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
      include: {
        changedBy: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    });

    return {
      ...updatedOrder,
      currentStatus: 'RESCHEDULED' as OrderStatus,
      statusHistory: allHistory,
      latestEvent: newHistory,
    };
  });

  await notifyOrderStatusChange(orderId, 'RESCHEDULED', reason);
  return result;
}

/**
 * Retrieves full order details by ID with access control validation.
 */
export async function getOrderById(orderId: string, requestingUser?: AuthSessionUser | null) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      pickupZone: true,
      dropZone: true,
      customer: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          phone: true,
        },
      },
      assignedAgent: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
        },
      },
      statusHistory: {
        orderBy: { createdAt: 'asc' },
        include: {
          changedBy: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
        },
      },
    },
  });

  if (!order) {
    throw new OrderNotFoundError(orderId);
  }

  // Access Control Enforcement
  if (requestingUser) {
    if (requestingUser.role === 'CUSTOMER' && order.customerId !== requestingUser.userId) {
      throw new OrderAccessForbiddenError('You do not have permission to view this order.');
    }
  }

  const currentStatus = deriveCurrentStatus(order.statusHistory);

  return {
    ...order,
    currentStatus,
  };
}

/**
 * Public tracking details query returning sanitized timeline and progress information.
 * No sensitive pricing or financial data is exposed.
 */
export async function getOrderByTrackingNumber(trackingNumber: string): Promise<PublicTrackingDetails> {
  const cleanTrackingNumber = (trackingNumber || '').trim().toUpperCase();

  const order = await prisma.order.findUnique({
    where: { trackingNumber: cleanTrackingNumber },
    include: {
      pickupZone: true,
      dropZone: true,
      statusHistory: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!order) {
    throw new OrderNotFoundError(cleanTrackingNumber);
  }

  const currentStatus = deriveCurrentStatus(order.statusHistory);
  const currentStatusLabel = getStatusLabel(currentStatus);
  const progressPercentage = getStatusProgressPercentage(currentStatus);

  const timeline: PublicTrackingTimelineEvent[] = order.statusHistory.map((item) => {
    const status = item.status as OrderStatus;
    return {
      id: item.id,
      status,
      statusLabel: getStatusLabel(status),
      reason: item.reason,
      notes: item.notes,
      timestamp: item.createdAt,
    };
  });

  return {
    trackingNumber: order.trackingNumber,
    currentStatus,
    currentStatusLabel,
    progressPercentage,
    senderCity: order.senderCity,
    senderState: order.senderState,
    pickupPincode: order.pickupPincode,
    recipientName: order.recipientName,
    recipientCity: order.recipientCity,
    recipientState: order.recipientState,
    dropPincode: order.dropPincode,
    scheduledDate: order.scheduledDate,
    isCod: order.isCod,
    packageDimensions: {
      lengthCm: order.packageLengthCm,
      breadthCm: order.packageBreadthCm,
      heightCm: order.packageHeightCm,
      weightKg: order.billableWeightKg,
    },
    timeline,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

/**
 * Queries orders with multi-parameter filtering and pagination.
 */
export async function queryOrders(
  filters: OrderFilterParams,
  requestingUser?: AuthSessionUser | null
) {
  const page = Math.max(1, filters.page || 1);
  const limit = Math.min(100, Math.max(1, filters.limit || 20));
  const skip = (page - 1) * limit;

  // Build where conditions
  const where: any = {};

  // Customer and Agent RBAC restrictions
  if (requestingUser && requestingUser.role === 'CUSTOMER') {
    where.customerId = requestingUser.userId;
  } else if (requestingUser && requestingUser.role === 'AGENT') {
    if (filters.assignedAgentId) {
      where.assignedAgentId = filters.assignedAgentId;
    } else {
      const agentProfile = await prisma.deliveryAgentProfile.findUnique({
        where: { userId: requestingUser.userId },
      });
      if (agentProfile) {
        where.assignedAgentId = agentProfile.id;
      }
    }
  } else if (filters.customerId) {
    where.customerId = filters.customerId;
  }

  if (filters.assignedAgentId && (!requestingUser || requestingUser.role !== 'AGENT')) {
    where.assignedAgentId = filters.assignedAgentId;
  }

  if (filters.pickupZoneId) {
    where.pickupZoneId = filters.pickupZoneId;
  }

  if (filters.dropZoneId) {
    where.dropZoneId = filters.dropZoneId;
  }

  if (filters.search) {
    const s = filters.search.trim();
    where.OR = [
      { trackingNumber: { contains: s } },
      { recipientName: { contains: s } },
      { senderName: { contains: s } },
      { recipientPhone: { contains: s } },
      { senderPhone: { contains: s } },
    ];
  }

  // Fetch orders with status history
  const [totalCount, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        pickupZone: true,
        dropZone: true,
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
        assignedAgent: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        statusHistory: {
          orderBy: { createdAt: 'desc' },
          take: 1, // Only need the latest for current status projection
        },
      },
    }),
  ]);

  const ordersWithStatus = orders.map((order) => {
    const currentStatus = deriveCurrentStatus(order.statusHistory);
    return {
      ...order,
      currentStatus,
    };
  });

  // If status filter is passed, filter in-memory or by matching status
  let filteredOrders = ordersWithStatus;
  if (filters.status) {
    filteredOrders = ordersWithStatus.filter((o) => o.currentStatus === filters.status);
  }

  return {
    orders: filteredOrders,
    pagination: {
      page,
      limit,
      total: filters.status ? filteredOrders.length : totalCount,
      totalPages: Math.ceil((filters.status ? filteredOrders.length : totalCount) / limit),
    },
  };
}
