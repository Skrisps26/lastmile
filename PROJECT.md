# Project: Last-Mile Delivery Tracker Platform

## Architecture
Full-stack TypeScript application built with Next.js (App Router), Prisma ORM, SQLite/PostgreSQL, Tailwind CSS, and Vitest.
Data flow:
1. **Quotation & Booking Flow**: Customer enters addresses/dimensions -> Zone Detection -> Dynamic Rate Engine -> Upfront Quote -> Order Creation with snapshot pricing -> `order_status_history` append `CREATED` -> Email Notification.
2. **Dispatch & Assignment Flow**: Unassigned Orders -> Auto-Assignment Engine / Admin Manual Dispatch -> Agent Match (Zone + Availability + Load) -> `order_status_history` append `ASSIGNED` -> Agent active order increment.
3. **Execution & Lifecycle Flow**: Agent views Queue -> Picked Up -> In Transit -> Out for Delivery -> Delivered OR Failed. Each step appends to `order_status_history` and triggers email notifications.
4. **Reschedule Flow**: On Failed -> Customer views tracking/reschedule page -> Submits new delivery date -> `order_status_history` append `RESCHEDULED` -> Re-dispatched to zone agent.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Pincode to Zone Detection | Maps pickup and drop pincodes to geographic Zones dynamically | M2 | R1 |
| 2 | Volumetric Weight Engine | Computes `(L * B * H) / 5000` with configurable divisors | M2 | R1 |
| 3 | Billable Weight Calculation | Evaluates `max(actual_weight, volumetric_weight)` | M2 | R1 |
| 4 | Dynamic Rate Card Calculation | Calculates base price + excess weight rate for B2B/B2C, intra/inter-zone | M2 | R1 |
| 5 | COD Surcharge Logic | Evaluates fixed + percentage COD fees with floor minimum | M2 | R1 |
| 6 | Upfront Price Quotation API | Endpoint `/api/rates/calculate` returning itemized cost breakdown | M2 | R1 |
| 7 | Zero Hardcoded Admin Config | Admin APIs for runtime Zone, PincodeMapping, and RateCard CRUD | M2 | R1 |
| 8 | RBAC Authentication | Secure JWT auth for Customer, Agent, Admin roles | M1 | R2 |
| 9 | Append-Only Event Ledger | `order_status_history` recording status, author, reason, and timestamp | M3 | R2 |
| 10 | Derived Order Status Projection | Projected current status strictly from `latest(order_status_history)` | M3 | R2 |
| 11 | FSM State Transition Validator | Enforces valid status transitions: Created->Assigned->PickedUp->InTransit->OutForDelivery->Delivered/Failed | M3 | R2 |
| 12 | Failed Delivery & Reschedule Flow | Records failure, notifies customer, allows date reschedule & reassignment | M3 | R2 |
| 13 | Delivery Agent Profiles | Manages status (`AVAILABLE`, `OFFLINE`, `ON_DELIVERY`), vehicle, capacity | M4 | R3 |
| 14 | Operational Zone Mapping | Associates delivery agents with one or more operational zones | M4 | R3 |
| 15 | Manual Agent Assignment | Admin interface and API to assign specific agents to orders | M4 | R3 |
| 16 | Auto-Assignment Engine | Intelligent algorithm matching zone, availability, and active load | M4 | R3 |
| 17 | Centralized Notification Service | Event hook on every order status transition sending customer emails | M5 | R4 |
| 18 | Email Service Integration | Resend/Brevo integration with mock/logging fallback for dev/test | M5 | R4 |
| 19 | Customer Portal | Order booking with live quote preview, tracking timeline, reschedule UI | M6 | R5 |
| 20 | Delivery Agent Portal | Active delivery queue, parcel details, 1-click status transition buttons | M6 | R5 |
| 21 | Admin Dashboard | System oversight, multi-filter orders, status overrides, zone/rate editors | M6 | R5 |
| 22 | Automated Test Suites | Unit tests (rate engine), integration tests (lifecycle, assignment, reschedule) | Testing Track | R6 |
| 23 | E2E Verification & Hardening | Complete 100% test suite pass + Tier 5 adversarial stress testing | Final | R6 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Core Setup, Database & Auth | Project initialization, Git setup, Prisma schema, DB migrations & seed, JWT auth & RBAC | none | PLANNED |
| M2 | Dynamic Zones & Rate Engine (R1) | Pincode-to-zone lookup, rate cards, volumetric calculation, quotation API, unit tests | M1 | PLANNED |
| M3 | Order Lifecycle & History Ledger (R2) | Order booking, append-only history ledger, state transition validation, failed reschedule | M1, M2 | PLANNED |
| M4 | Agent Management & Auto-Dispatch (R3) | Agent profiles, zone mappings, availability toggle, auto-assignment algorithm | M1, M3 | PLANNED |
| M5 | Centralized Notification Pipeline (R4)| Transition event hooks, email templating, Resend/Brevo client & mock logger | M3 | PLANNED |
| M6 | Full-Stack User Portals (R5) | Customer booking/timeline UI, Agent queue UI, Admin management dashboard | M1-M5 | PLANNED |
| E2E | E2E Testing Track (R6) | Independent opaque-box test runner, Tiers 1-4 test suites | M1 (contracts) | PLANNED |
| M7 | Final E2E Pass, Hardening & Docs | 100% E2E test pass, Tier 5 adversarial coverage, README & SYSTEM_DESIGN.md | M6, E2E | PLANNED |

## Interface Contracts

### Rate Engine Contract (`lib/rate-engine/calculator.ts`)
```typescript
export interface RateQuoteInput {
  pickupPincode: string;
  dropPincode: string;
  customerType: 'B2B' | 'B2C';
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
  actualWeightKg: number;
  isCod: boolean;
  codAmount?: number;
  declaredValue?: number;
}

export interface RateQuoteBreakdown {
  pickupZone: { id: string; name: string; code: string };
  dropZone: { id: string; name: string; code: string };
  zoneType: 'INTRA_ZONE' | 'INTER_ZONE';
  customerType: 'B2B' | 'B2C';
  actualWeightKg: number;
  volumetricWeightKg: number;
  billableWeightKg: number;
  volumetricDivisor: number;
  basePrice: number;
  weightPrice: number;
  codSurcharge: number;
  totalAmount: number;
}
```

### Order Ledger Contract (`lib/orders/status-machine.ts`)
```typescript
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

export const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  CREATED: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['PICKED_UP', 'CANCELLED'],
  PICKED_UP: ['IN_TRANSIT', 'FAILED'],
  IN_TRANSIT: ['OUT_FOR_DELIVERY', 'FAILED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'FAILED'],
  FAILED: ['RESCHEDULED', 'CANCELLED'],
  RESCHEDULED: ['ASSIGNED', 'OUT_FOR_DELIVERY', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: []
};
```

### Assignment Engine Contract (`lib/agents/assignment.ts`)
```typescript
export interface AssignmentResult {
  success: boolean;
  assignedAgent?: {
    id: string;
    userId: string;
    name: string;
    activeOrdersCount: number;
  };
  reason?: string;
}
```

### Notification Contract (`lib/notifications/service.ts`)
```typescript
export interface NotificationPayload {
  orderId: string;
  trackingNumber: string;
  recipientEmail: string;
  recipientName: string;
  status: OrderStatus;
  notes?: string;
  scheduledDate?: string;
}
```

## Code Layout
```
/home/skrisps/lastmile/
├── .agents/                 # Coordination metadata only (plans, handoffs, logs)
├── prisma/
│   ├── schema.prisma        # Prisma relational database schema
│   ├── migrations/          # SQL migrations
│   └── seed.ts              # Initial database seeder (zones, rate cards, accounts)
├── src/
│   ├── app/                 # Next.js App Router
│   │   ├── api/             # API routes (auth, zones, rates, orders, agents, notifications)
│   │   ├── (auth)/          # Login & registration pages
│   │   ├── customer/        # Customer portal (booking, tracking, reschedule)
│   │   ├── agent/           # Delivery agent portal (queue, status updates)
│   │   ├── admin/           # Admin dashboard (oversight, rate/zone editor, agents)
│   │   ├── track/           # Public order tracking page
│   │   ├── layout.tsx
│   │   └── page.tsx         # Landing page / portal selector
│   ├── components/          # Reusable UI components (Navbar, Modal, Timeline, Table)
│   └── lib/                 # Core domain logic & utilities
│       ├── prisma.ts        # Prisma client singleton
│       ├── auth/            # JWT token & password hashing utilities
│       ├── rate-engine/     # Isolated Rate Calculation Engine & zone detection
│       ├── orders/          # Event ledger management & state transition validator
│       ├── agents/          # Agent management & auto-assignment algorithm
│       └── notifications/   # Centralized notification pipeline & mock fallback
├── tests/
│   ├── unit/                # Unit tests for rate engine & algorithms
│   ├── integration/         # API integration tests for lifecycle, ledger, dispatch
│   └── e2e/                 # Opaque-box E2E test suites (Tiers 1-5)
├── PLAN.md                  # Comprehensive written architecture and implementation plan
├── PROJECT.md               # Global project index, milestones, and contracts
├── README.md                # System documentation & setup guide
├── SYSTEM_DESIGN.md         # System design write-up (max 800 words)
├── package.json
└── tsconfig.json
```
