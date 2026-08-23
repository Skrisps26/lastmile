import { z } from 'zod';
import { ALL_ROLES } from './constants';

export const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters long').max(100),
  email: z.string().email('Please enter a valid email address').toLowerCase().trim(),
  password: z
    .string()
    .min(6, 'Password must be at least 6 characters long')
    .max(128, 'Password must not exceed 128 characters'),
  phone: z.string().optional().nullable(),
  role: z.enum(['CUSTOMER', 'AGENT', 'ADMIN'] as const).default('CUSTOMER'),
  // Delivery agent profile optional parameters
  vehicleType: z.enum(['BIKE', 'VAN', 'TRUCK']).optional(),
  vehicleNumber: z.string().optional().nullable(),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address').toLowerCase().trim(),
  password: z.string().min(1, 'Password is required'),
});

export type LoginInput = z.infer<typeof loginSchema>;
