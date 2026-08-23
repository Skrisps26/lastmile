// /home/skrisps/lastmile/src/lib/orders/schemas.ts

import { z } from 'zod';
import { ORDER_STATUSES, OrderStatus } from './status-machine';

const pincodeRegex = /^\d{6}$/;

export const createOrderSchema = z.object({
  // Sender Details
  senderName: z.string().trim().min(2, 'Sender name must be at least 2 characters').max(100),
  senderPhone: z.string().trim().min(7, 'Sender phone must be at least 7 digits').max(20),
  senderStreet: z.string().trim().min(3, 'Sender street address is required').max(255),
  senderCity: z.string().trim().min(2, 'Sender city is required').max(100),
  senderState: z.string().trim().min(2, 'Sender state is required').max(100),
  pickupPincode: z.string().trim().regex(pincodeRegex, 'Pickup pincode must be a 6-digit numeric string'),

  // Recipient Details
  recipientName: z.string().trim().min(2, 'Recipient name must be at least 2 characters').max(100),
  recipientPhone: z.string().trim().min(7, 'Recipient phone must be at least 7 digits').max(20),
  recipientStreet: z.string().trim().min(3, 'Recipient street address is required').max(255),
  recipientCity: z.string().trim().min(2, 'Recipient city is required').max(100),
  recipientState: z.string().trim().min(2, 'Recipient state is required').max(100),
  dropPincode: z.string().trim().regex(pincodeRegex, 'Drop pincode must be a 6-digit numeric string'),

  // Package Measurements
  packageLengthCm: z.number().positive('Package length must be greater than 0'),
  packageBreadthCm: z.number().positive('Package breadth must be greater than 0'),
  packageHeightCm: z.number().positive('Package height must be greater than 0'),
  actualWeightKg: z.number().positive('Actual weight must be greater than 0'),

  // Payment & Options
  isCod: z.boolean().default(false),
  codAmount: z.number().nonnegative('COD amount cannot be negative').optional().default(0),
  declaredValue: z.number().nonnegative('Declared value cannot be negative').optional().default(0),
  customerType: z.enum(['B2B', 'B2C']).default('B2C'),
  volumetricDivisor: z.number().positive('Volumetric divisor must be positive').optional().default(5000),

  // Scheduling & Notes
  scheduledDate: z.union([z.string().datetime(), z.string().date(), z.string()]).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export const transitionStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES as unknown as [OrderStatus, ...OrderStatus[]], {
    errorMap: () => ({ message: `Invalid status. Must be one of: ${ORDER_STATUSES.join(', ')}` }),
  }),
  reason: z.string().trim().max(500).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  metadata: z.union([z.record(z.unknown()), z.string()]).optional().nullable(),
}).refine(
  (data) => {
    if (data.status === 'FAILED') {
      return !!data.reason && data.reason.trim().length > 0;
    }
    return true;
  },
  {
    message: "A valid non-empty 'reason' is strictly required when transitioning order to 'FAILED'",
    path: ['reason'],
  }
);

export const rescheduleOrderSchema = z.object({
  scheduledDate: z.string().min(1, 'Scheduled date is required'),
  reason: z.string().trim().max(500).optional().nullable(),
});

export const orderQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES as unknown as [OrderStatus, ...OrderStatus[]]).optional(),
  customerId: z.string().optional(),
  assignedAgentId: z.string().optional(),
  pickupZoneId: z.string().optional(),
  dropZoneId: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type CreateOrderDTO = z.infer<typeof createOrderSchema>;
export type TransitionStatusDTO = z.infer<typeof transitionStatusSchema>;
export type RescheduleOrderDTO = z.infer<typeof rescheduleOrderSchema>;
export type OrderQueryDTO = z.infer<typeof orderQuerySchema>;
