// /home/skrisps/lastmile/src/lib/prisma.ts

import { PrismaClient } from '@prisma/client';

// ==========================================
// Domain Type Definitions (SQLite & Postgres Portable)
// ==========================================

export type UserRole = 'CUSTOMER' | 'AGENT' | 'ADMIN';

export type CustomerType = 'B2B' | 'B2C';

export type ZoneType = 'INTRA_ZONE' | 'INTER_ZONE';

export type AgentStatus = 'AVAILABLE' | 'OFFLINE' | 'ON_DELIVERY';

export type VehicleType = 'BIKE' | 'VAN' | 'TRUCK';

export type NotificationProvider = 'RESEND' | 'BREVO' | 'MOCK_LOGGER';

export type NotificationStatus = 'SENT' | 'FAILED';

export type OrderStatus =
  | 'CREATED'
  | 'ASSIGNED'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'FAILED'
  | 'RESCHEDULED'
  | 'CANCELLED';

// ==========================================
// Global Singleton Instantiation
// ==========================================

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['error', 'warn']
        : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
