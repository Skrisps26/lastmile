# Production Architecture & Implementation Plan (`PLAN.md`)
**Project:** Last-Mile Delivery Tracker Platform  
**Target Repository:** https://github.com/Skrisps26/lastmile.git  
**Author:** Project Orchestrator & System Architecture Team  
**Date:** 2026-08-23  

---

## 1. Executive Summary & Objective

The Last-Mile Delivery Tracker platform is an enterprise-grade logistics and fulfillment management system designed to support real-time rate calculations, dynamic geographic zone management, immutable audit logging for order lifecycles, intelligent agent auto-dispatching, automated customer notifications, and dedicated role-based portals for Customers, Delivery Agents, and Admins.

This document details the complete end-to-end architecture, relational schema, API surface, agent-based task breakdown, module build order, and operational constraints prior to codebase implementation.

---

## 2. Technology Stack Selection & Justifications

| Component | Selected Technology | Version / Tool | Justification |
|---|---|---|---|
| **Framework** | Next.js (App Router) | 14+ / React 18+ | Unified full-stack architecture with React Server Components, high-performance API route handlers, and seamless client-side interactivity. |
| **Language** | TypeScript | 5.x | Strict compile-time type safety across database models, calculation engines, state machine transitions, and API contracts. |
| **Styling & UI** | Tailwind CSS + Lucide Icons | Latest | Modern, accessible, responsive interface design with minimal CSS bundle footprint across Customer, Agent, and Admin portals. |
| **ORM & Database** | Prisma ORM | 5.x+ (SQLite / PostgreSQL) | Strongly typed query builder with migrations. Zero-friction local development and automated CI testing via SQLite (`file:./dev.db`), with 100% schema compatibility for cloud PostgreSQL via `DATABASE_URL`. |
| **Authentication** | Jose (JWT) + Bcrypt.js + Cookies | Latest | Stateless, cryptographically secure JWT authentication with HTTP-only cookies and role-based access control (`CUSTOMER`, `AGENT`, `ADMIN`). |
| **Validation** | Zod | 3.x | Strict schema parsing and input sanitization for all API requests, rate calculation payloads, and state transitions. |
| **Testing Framework** | Vitest + Playwright / Fetch | Latest | Lightning-fast ESM unit and integration test runner with comprehensive assertions for mathematical rate engine edge cases, ledger immutability, and end-to-end flows. |
| **Notifications** | Pluggable Email Engine | Resend / Brevo + Mock Fallback | Centralized event-driven notification architecture with zero-dependency logging fallback for local testing and CI/CD. |
| **Version Control** | Git | 2.55+ | Feature-branch workflow (`feat/*`) with atomic Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`). |

---

## 3. Relational Database Schema Draft (Prisma / PostgreSQL Compatible)

The schema defines clear boundaries for identity, geographic partitioning, pricing configurations, immutable event ledgers, agent profiles, and notification auditing.

```prisma
datasource db {
  provider = "sqlite" // Fully portable to postgresql by toggling provider and DATABASE_URL
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

// User Identity & Role-Based Access Control
model User {
  id           String               @id @default(cuid())
  email        String               @unique
  passwordHash String
  name         String
  phone        String?
  role         String               @default("CUSTOMER") // "CUSTOMER" | "AGENT" | "ADMIN"
  createdAt    DateTime             @default(now())
  updatedAt    DateTime             @updatedAt
  
  addresses    Address[]
  orders       Order[]              @relation("CustomerOrders")
  agentProfile DeliveryAgentProfile?
  statusEvents OrderStatusHistory[] @relation("ChangedByUser")

  @@index([role])
}

// Address Book
model Address {
  id           String   @id @default(cuid())
  userId       String
  label        String?  // e.g. "Warehouse", "Headquarters", "Home"
  street       String
  city         String
  state        String
  pincode      String
  contactName  String?
  contactPhone String
  isDefault    Boolean  @default(false)
  createdAt    DateTime @default(now())
  
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([pincode])
}

// Dynamic Geographic Zones
model Zone {
  id          String           @id @default(cuid())
  name        String           @unique // e.g. "North Metro", "South Suburban", "Western Outskirts"
  code        String           @unique // e.g. "ZONE_NORTH", "ZONE_SOUTH"
  description String?
  isActive    Boolean          @default(true)
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt
  
  pincodes    PincodeMapping[]
  pickupOrders Order[]         @relation("PickupZone")
  dropOrders   Order[]         @relation("DropZone")
  agentZones  AgentZoneMapping[]
}

// Pincode to Zone Mappings
model PincodeMapping {
  id        String   @id @default(cuid())
  pincode   String   @unique
  areaName  String?
  zoneId    String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  zone      Zone     @relation(fields: [zoneId], references: [id], onDelete: Cascade)
  @@index([pincode])
  @@index([zoneId])
}

// Dynamic Rate Cards (Zero Hardcoded Pricing)
model RateCard {
  id                 String   @id @default(cuid())
  zoneType           String   // "INTRA_ZONE" | "INTER_ZONE"
  customerType       String   // "B2B" | "B2C"
  baseWeightKg       Float    @default(0.5)
  baseRate           Float    // Fixed price for weight <= baseWeightKg
  perKgRate          Float    // Additional price per additional kg / fraction
  volumetricDivisor  Float    @default(5000) // Standard divisor (L*B*H)/divisor
  codFixedSurcharge  Float    @default(0.0)
  codPercentSurcharge Float   @default(0.0) // Percentage of declared value
  minCodSurcharge    Float    @default(0.0) // Minimum floor for COD fee
  isActive           Boolean  @default(true)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@unique([zoneType, customerType, isActive])
  @@index([zoneType, customerType])
}

// Order Entity (Snapshot of Invoiced Pricing & Dimension Details)
model Order {
  id                  String               @id @default(cuid())
  trackingNumber      String               @unique // e.g. "LMD-20260823-XYZ89"
  customerId          String
  customerType        String               @default("B2C") // "B2B" | "B2C"
  
  // Sender & Receiver Details
  senderName          String
  senderPhone         String
  senderStreet        String
  senderCity          String
  senderState         String
  pickupPincode       String
  pickupZoneId        String
  
  recipientName       String
  recipientPhone      String
  recipientStreet     String
  recipientCity       String
  recipientState      String
  dropPincode         String
  dropZoneId          String
  
  // Package Dimensions & Weight Calculations
  packageLengthCm     Float
  packageBreadthCm    Float
  packageHeightCm     Float
  actualWeightKg      Float
  volumetricWeightKg  Float
  billableWeightKg    Float
  volumetricDivisor   Float                @default(5000)
  
  // Pricing Breakdown (Itemized Snapshot)
  zoneType            String               // "INTRA_ZONE" | "INTER_ZONE"
  basePrice           Float
  weightPrice         Float
  codSurcharge        Float                @default(0.0)
  totalAmount         Float
  
  // Payment Details
  isCod               Boolean              @default(false)
  codAmount           Float                @default(0.0)
  declaredValue       Float                @default(0.0)
  
  // Assignment & Scheduling
  assignedAgentId     String?
  scheduledDate       DateTime?
  notes               String?
  
  createdAt           DateTime             @default(now())
  updatedAt           DateTime             @updatedAt
  
  customer            User                 @relation("CustomerOrders", fields: [customerId], references: [id])
  pickupZone          Zone                 @relation("PickupZone", fields: [pickupZoneId], references: [id])
  dropZone            Zone                 @relation("DropZone", fields: [dropZoneId], references: [id])
  assignedAgent       DeliveryAgentProfile? @relation(fields: [assignedAgentId], references: [id])
  
  statusHistory       OrderStatusHistory[]
  notifications       NotificationLog[]

  @@index([trackingNumber])
  @@index([customerId])
  @@index([assignedAgentId])
  @@index([pickupZoneId])
  @@index([dropZoneId])
}

// Append-Only Order Status Audit Ledger
model OrderStatusHistory {
  id          String   @id @default(cuid())
  orderId     String
  status      String   // "CREATED" | "ASSIGNED" | "PICKED_UP" | "IN_TRANSIT" | "OUT_FOR_DELIVERY" | "DELIVERED" | "FAILED" | "RESCHEDULED" | "CANCELLED"
  changedById String?
  reason      String?  // Mandatory on FAILED, optional on others
  notes       String?
  metadata    String?  // Optional JSON string for extra contextual telemetry
  createdAt   DateTime @default(now())
  
  order       Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  changedBy   User?    @relation("ChangedByUser", fields: [changedById], references: [id])

  @@index([orderId, createdAt])
  @@index([status])
}

// Delivery Agent Profiles & Operational Boundaries
model DeliveryAgentProfile {
  id                String             @id @default(cuid())
  userId            String             @unique
  status            String             @default("OFFLINE") // "AVAILABLE" | "OFFLINE" | "ON_DELIVERY"
  vehicleType       String?            // "BIKE" | "VAN" | "TRUCK"
  vehicleNumber     String?
  maxCapacity       Int                @default(10)
  activeOrdersCount Int                @default(0)
  createdAt         DateTime           @default(now())
  updatedAt         DateTime           @updatedAt
  
  user              User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  operationalZones  AgentZoneMapping[]
  assignedOrders    Order[]

  @@index([status])
}

// Many-to-Many Agent to Operational Zone Mappings
model AgentZoneMapping {
  id        String   @id @default(cuid())
  agentId   String
  zoneId    String
  createdAt DateTime @default(now())
  
  agent     DeliveryAgentProfile @relation(fields: [agentId], references: [id], onDelete: Cascade)
  zone      Zone                 @relation(fields: [zoneId], references: [id], onDelete: Cascade)

  @@unique([agentId, zoneId])
  @@index([agentId])
  @@index([zoneId])
}

// Centralized Notification Audit Log
model NotificationLog {
  id             String   @id @default(cuid())
  orderId        String
  recipientEmail String
  event          String   // e.g. "STATUS_CREATED", "STATUS_OUT_FOR_DELIVERY", "STATUS_FAILED"
  subject        String
  provider       String   // "RESEND" | "BREVO" | "MOCK_LOGGER"
  status         String   // "SENT" | "FAILED"
  errorMessage   String?
  payload        String?  // JSON serialized email body/context
  sentAt         DateTime @default(now())
  
  order          Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@index([orderId])
  @@index([recipientEmail])
}
```

---

## 4. API Surface Draft

### 4.1 Authentication & Profile (`/api/auth/*`)
- `POST /api/auth/register` — Register customer, agent, or admin account.
- `POST /api/auth/login` — Authenticate and return secure HTTP-only JWT session cookie.
- `POST /api/auth/logout` — Invalidate session and clear auth cookie.
- `GET /api/auth/me` — Return authenticated user profile and roles.

### 4.2 Dynamic Zones & Mappings (`/api/zones`, `/api/pincodes`)
- `GET /api/zones` — List all active zones with associated pincode count.
- `POST /api/zones` — Create new geographic zone (Admin only).
- `PUT /api/zones/:id` — Update zone attributes or toggle active status.
- `DELETE /api/zones/:id` — Soft-delete / deactivate zone.
- `GET /api/pincodes` — List all pincode-to-zone mappings.
- `POST /api/pincodes` — Create or bulk-import pincode mappings.
- `GET /api/pincodes/:pincode/zone` — Lookup zone for a given pincode.

### 4.3 Rate Cards & Upfront Quotation Engine (`/api/rates/*`)
- `GET /api/rates/cards` — List all rate card rules (Intra/Inter-zone, B2B/B2C).
- `POST /api/rates/cards` — Create or update rate card parameters (Admin only).
- `POST /api/rates/calculate` — **Upfront Price Quotation Engine**:
  - **Request Body**:
    ```json
    {
      "pickupPincode": "560001",
      "dropPincode": "560038",
      "customerType": "B2C",
      "lengthCm": 30.0,
      "breadthCm": 20.0,
      "heightCm": 10.0,
      "actualWeightKg": 2.5,
      "isCod": true,
      "codAmount": 1500.0,
      "declaredValue": 1500.0
    }
    ```
  - **Response**: Itemized breakdown including `pickupZone`, `dropZone`, `zoneType` (`INTRA_ZONE` vs `INTER_ZONE`), `volumetricWeightKg`, `billableWeightKg`, `basePrice`, `weightPrice`, `codSurcharge`, and `totalAmount`.

### 4.4 Order Booking & Status Management (`/api/orders/*`)
- `POST /api/orders` — Create new order with snapshot quotation and write initial `CREATED` status to `order_status_history`.
- `GET /api/orders` — List orders with multi-parameter filtering (`status`, `zoneId`, `agentId`, `customerType`, `search`, pagination).
- `GET /api/orders/:id` — Detailed order view with projected current status and full immutable event ledger.
- `GET /api/orders/track/:trackingNumber` — Public tracking endpoint returning timeline and delivery details.
- `POST /api/orders/:id/status` — **State Transition Endpoint**:
  - Validates forward progression: `CREATED` $\to$ `ASSIGNED` $\to$ `PICKED_UP` $\to$ `IN_TRANSIT` $\to$ `OUT_FOR_DELIVERY` $\to$ `DELIVERED` / `FAILED`.
  - Appends new row to `order_status_history`.
  - Triggers email notification pipeline.
- `POST /api/orders/:id/reschedule` — Customer reschedule endpoint for failed orders (sets new date and logs `RESCHEDULED`).

### 4.5 Delivery Agent Management & Dispatch (`/api/agents/*`)
- `GET /api/agents` — List agents with operational zones, status, and active load counts.
- `PUT /api/agents/:id/status` — Toggle agent status (`AVAILABLE`, `OFFLINE`, `ON_DELIVERY`).
- `PUT /api/agents/:id/zones` — Update agent operational zone assignments.
- `POST /api/orders/:id/assign` — Manual agent assignment by Admin.
- `POST /api/orders/auto-assign` — Zone-based auto-assignment algorithm matching unassigned orders to available zone agents with load-balancing.

---

## 5. Domain Engine Algorithms & Business Logic

### 5.1 Rate Engine Mathematical Equations
1. **Volumetric Weight Calculation**:
   $$W_{\text{vol}} = \frac{L \times B \times H}{D_{\text{vol}}}$$
   Where $D_{\text{vol}}$ defaults to $5000 \text{ cm}^3/\text{kg}$.
2. **Billable Weight Determination**:
   $$W_{\text{billable}} = \max(W_{\text{actual}}, W_{\text{vol}})$$
3. **Weight Price Calculation**:
   $$\Delta W = \max(0, W_{\text{billable}} - W_{\text{base}})$$
   $$\text{WeightPrice} = \Delta W \times R_{\text{perKg}}$$
4. **COD Surcharge Calculation**:
   $$\text{CodFee} = \begin{cases} 0 & \text{if } \neg\text{isCod} \\ \max(F_{\text{fixed}} + (\text{CodAmount} \times P_{\text{pct}}), M_{\text{min}}) & \text{if } \text{isCod} \end{cases}$$
5. **Total Invoiced Quote**:
   $$\text{TotalQuote} = R_{\text{base}} + \text{WeightPrice} + \text{CodFee}$$

### 5.2 Event Ledger & Status Projection
- Current order status is computed dynamically at query time:
  $$\text{CurrentStatus}(O) = \text{status of } \arg\max_{t} (\text{OrderStatusHistory}(O, t))$$
- No direct mutations or updates are performed on past event records.

### 5.3 Auto-Assignment Matching Algorithm
- For an order $O$ with pickup zone $Z_{\text{pickup}}$ and drop zone $Z_{\text{drop}}$:
  1. Target Zone $Z = Z_{\text{drop}}$ (or $Z_{\text{pickup}}$ for first-mile pickup).
  2. Candidate Pool:
     $$\mathcal{C} = \{ A \mid A.\text{status} = \text{AVAILABLE} \land Z \in A.\text{operationalZones} \land A.\text{activeOrdersCount} < A.\text{maxCapacity} \}$$
  3. Selection: Rank candidates by `activeOrdersCount` ascending, then by least recently assigned.
  4. Assign selected agent, increment `activeOrdersCount`, and append `ASSIGNED` to `order_status_history`.

---

## 6. Multi-Agent Task Breakdown & Inter-Agent Dependencies

```
[Orchestrator]
      │
      ├── [Milestone M1: Setup, Database & Auth]
      │         │
      │         ▼
      ├── [Milestone M2: Dynamic Zones & Rate Engine (R1)] ──┐
      │         │                                             │
      │         ▼                                             │
      ├── [Milestone M3: Order Lifecycle & Ledger (R2)] ──────┼──► [E2E Testing Track]
      │         │                                             │    (Test Runner,
      │         ▼                                             │     Tiers 1-4 Suites)
      ├── [Milestone M4: Agent Management & Dispatch (R3)] ───┤
      │         │                                             │
      │         ▼                                             │
      ├── [Milestone M5: Notification Pipeline (R4)] ─────────┘
      │         │
      │         ▼
      ├── [Milestone M6: Full-Stack User Portals (R5)]
      │         │
      │         ▼
      └── [Final Milestone: 100% E2E Pass + Adversarial Tier 5 + Docs]
```

### Agent Roles & Work Breakdown

| Milestone / Module | Primary Subagent Role | Branch | Inputs & Prerequisites | Core Responsibilities & Output Artifacts |
|---|---|---|---|---|
| **M1: Core Infra & Auth** | `teamwork_preview_worker` | `feat/auth` | `PLAN.md`, `ORIGINAL_REQUEST.md` | Initialize Git repo & remote, Next.js app, Prisma schema, DB migration/seed script with default zones, rate cards, and test accounts (`admin@lastmile.local`, `agent@lastmile.local`, `customer@lastmile.local`), JWT auth endpoints. |
| **M2: Rate & Zone Engine** | `teamwork_preview_worker` | `feat/rate-engine` | M1 Schema & Database | Isolated mathematical rate calculation engine, runtime zone & pincode management, dynamic rate card CRUD, quotation API `/api/rates/calculate`, unit tests for all edge cases. |
| **M3: Order Lifecycle** | `teamwork_preview_worker` | `feat/order-lifecycle` | M1 Auth, M2 Rate Engine | Order creation with quote snapshot, append-only `order_status_history`, derived status projection, FSM transition validator, failed delivery & rescheduling API. |
| **M4: Agent Auto-Dispatch**| `teamwork_preview_worker` | `feat/assignment-engine`| M1 Auth, M3 Order Lifecycle | Agent operational profiles, status toggles, zone matching, manual assignment API, load-balanced auto-assignment engine. |
| **M5: Notifications** | `teamwork_preview_worker` | `feat/notifications` | M3 Order Lifecycle | Centralized notification service, status event listeners, Resend/Brevo client with mock logger fallback, notification history audit logging. |
| **M6: Full-Stack Portals** | `teamwork_preview_worker` | `feat/frontend` | M1-M5 APIs | Customer Portal (quote preview, booking, timeline, reschedule), Agent Portal (delivery queue, 1-click status), Admin Portal (order oversight, filtering, overrides, zone/rate editors). |
| **E2E Testing Track** | `teamwork_preview_test_writer` | `feat/testing` | `PLAN.md`, `ORIGINAL_REQUEST.md` | Test harness runner, Tiers 1-4 test suites (Category-Partition, Boundary Values, Pairwise, Real-world workloads). Publishes `TEST_READY.md`. |
| **Final Verification** | `teamwork_preview_worker` / `teamwork_preview_auditor` | `main` | All Milestones, `TEST_READY.md` | 100% E2E test execution pass, Tier 5 adversarial stress testing, `README.md`, `SYSTEM_DESIGN.md` ($\le 800$ words), Forensic Integrity Audit verification. |

---

## 7. Build Order & Module Integration Phases

1. **Phase 1 — Foundation & Git Initialization**:
   - Initialize git repository, configure remote `https://github.com/Skrisps26/lastmile.git`, setup `.gitignore`.
   - Scaffold Next.js TypeScript project, Tailwind CSS, Prisma ORM, and Vitest test runner.
   - Run initial migration and database seeder with realistic zones (Metro, Suburban, Regional), pincode mappings, B2B/B2C rate cards, and mock users.
2. **Phase 2 — Core Calculation & Domain Engines (Parallel Tracks)**:
   - *Implementation*: Build isolated Rate Calculation Engine and runtime Zone configuration with 100% unit test coverage.
   - *Testing Track*: Build E2E test runner and Tier 1 & 2 test suites.
3. **Phase 3 — Order Lifecycle, State Machine & Dispatching**:
   - Implement append-only event ledger and state transition validator.
   - Implement Agent profile management and auto-dispatch matching algorithm.
   - Integrate notification pipeline hooks into state transition events.
4. **Phase 4 — User Portals & UI Integration**:
   - Build Customer, Agent, and Admin dashboards with responsive Tailwind UI, real-time tracking timeline, and interactive forms.
5. **Phase 5 — End-to-End Verification & Documentation**:
   - Execute full test suite (Tiers 1-4) until 100% passing.
   - Execute Tier 5 adversarial stress testing.
   - Write comprehensive `README.md`, `.env.example`, and `SYSTEM_DESIGN.md` ($\le 800$ words).
   - Forensic Auditor integrity review.

---

## 8. Clarified Assumptions & Constraints

1. **Integrity & Authenticity**: Zero tolerance for dummy implementations or hardcoded pricing. All rate calculations and state projections must be computed dynamically through the database and math engine.
2. **Volumetric Divisor**: Standard $5000 \text{ cm}^3/\text{kg}$ as specified in R1, with dynamic support for custom divisors stored on the `RateCard` record.
3. **Pincode Format**: Standard 6-digit postal codes mapped to designated operational zones.
4. **Rescheduling Window**: Failed deliveries can be rescheduled for future calendar dates, preserving the complete immutable audit trail of the previous failure attempt.
5. **Email Transport**: Graceful fallback to `MockLoggingEmailProvider` when external API credentials are not set in `.env`.

---
*End of PLAN.md*
