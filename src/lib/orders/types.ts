// /home/skrisps/lastmile/src/lib/orders/types.ts

import { OrderStatus } from './status-machine';

export interface CreateOrderInput {
  senderName: string;
  senderPhone: string;
  senderStreet: string;
  senderCity: string;
  senderState: string;
  pickupPincode: string;
  
  recipientName: string;
  recipientPhone: string;
  recipientStreet: string;
  recipientCity: string;
  recipientState: string;
  dropPincode: string;
  
  packageLengthCm: number;
  packageBreadthCm: number;
  packageHeightCm: number;
  actualWeightKg: number;
  
  isCod?: boolean;
  codAmount?: number;
  declaredValue?: number;
  customerType?: 'B2B' | 'B2C';
  volumetricDivisor?: number;
  
  scheduledDate?: Date | string | null;
  notes?: string | null;
}

export interface TransitionStatusInput {
  status: OrderStatus;
  reason?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown> | string | null;
}

export interface RescheduleOrderInput {
  scheduledDate: string | Date;
  reason?: string | null;
}

export interface OrderFilterParams {
  status?: OrderStatus;
  customerId?: string;
  assignedAgentId?: string;
  pickupZoneId?: string;
  dropZoneId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface PublicTrackingTimelineEvent {
  id: string;
  status: OrderStatus;
  statusLabel: string;
  reason: string | null;
  notes: string | null;
  timestamp: Date;
}

export interface PublicTrackingDetails {
  trackingNumber: string;
  currentStatus: OrderStatus;
  currentStatusLabel: string;
  progressPercentage: number;
  senderCity: string;
  senderState: string;
  pickupPincode: string;
  recipientName: string;
  recipientCity: string;
  recipientState: string;
  dropPincode: string;
  scheduledDate: Date | null;
  isCod: boolean;
  packageDimensions: {
    lengthCm: number;
    breadthCm: number;
    heightCm: number;
    weightKg: number;
  };
  timeline: PublicTrackingTimelineEvent[];
  createdAt: Date;
  updatedAt: Date;
}
