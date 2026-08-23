# LastMile Logistics Platform

LastMile is a delivery-management application for booking, pricing, dispatching, and tracking parcel orders. Customers can create and track shipments, admins configure service zones and rate cards, and delivery agents receive assigned work and advance its status through the delivery lifecycle. The application is currently a single Next.js application containing the web portals and API routes, backed by Supabase PostgreSQL through Prisma.

## Tech stack

- Next.js 14 App Router and React 18
- TypeScript, Tailwind CSS, Radix UI primitives, and Lucide icons
- Next.js Route Handlers for the backend API
- Prisma 5 with PostgreSQL on Supabase
- JWT session tokens stored in an HTTP-only cookie
- `bcryptjs` for password hashing and `zod` for request validation
- Vitest for unit and integration tests
- Optional Resend dependency/configuration is present, but notification delivery is not wired into the status service yet

## Prerequisites

- Node.js 20.x is the supported development runtime (`@types/node` is 20.x; Node 18+ may work with this dependency set).
- npm (the repository includes `package-lock.json`).
- A Supabase project with PostgreSQL access. Prisma needs both the pooled application URL and the direct migration URL.

## Setup

### 1. Clone and install

```bash
git clone https://github.com/Skrisps26/lastmile.git
cd lastmile
npm install
```

### 2. Configure environment variables

Copy the checked-in template and fill in the values:

```bash
cp .env.example .env
```

`.env.example` is the source of truth for the current variables:

- `DATABASE_URL`: Supabase pooler URL for application traffic, normally port `6543` with `pgbouncer=true`.
- `DIRECT_URL`: Supabase direct PostgreSQL URL, normally port `5432`; Prisma uses this for migrations.
- `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`: optional client configuration. The current backend uses Prisma/JWT rather than the Supabase Auth client.
- `JWT_SECRET` and `NEXTAUTH_SECRET`: secrets for local session signing/configuration; use long, unique production secrets.
- `NODE_ENV`, `PORT`, and `NEXT_PUBLIC_APP_URL`.
- `NOTIFICATION_PROVIDER`, `RESEND_API_KEY`, and `NOTIFICATION_FROM_EMAIL`: reserved notification configuration. The current default is `mock`, but no centralized sender is connected yet.

Never commit `.env` or real database credentials.

### 3. Apply the database migration and seed data

The repository contains a PostgreSQL migration at `prisma/migrations/20260823140000_init_postgresql/migration.sql`. For a fresh clone or deployment database, run the reproducible migration and then the idempotent seed:

```bash
npx prisma generate
npx prisma migrate deploy
npm run db:seed
```

Use `npm run db:migrate` (`prisma migrate dev`) only when developing a schema change locally and creating a new migration. `npm run db:push` is available for experimentation but is not the reproducible setup path.

The seed creates four active zones, 16 Bengaluru pincode/area mappings, four active rate cards (B2B/B2C × intra/inter-zone), two agent accounts with zone mappings, an admin account, and demo customer accounts/addresses. All seeded demo accounts use `Password123!`:

| Role | Email |
| --- | --- |
| Admin | `admin@lastmile.local` |
| Agent | `agent1@lastmile.local`, `agent2@lastmile.local` |
| Customer | `customer@lastmile.local` |

### 4. Run the application

Start the Next.js server, which serves both the API and the frontend:

```bash
npm run dev
```

Open `http://localhost:3000/login`. The role portals are `/customer`, `/agent`, and `/admin`; middleware checks the JWT role before allowing access.

For a production build:

```bash
npm run build
npm start
```

### 5. Run tests

```bash
npm test
```

The suite includes pure rate-engine, pincode detector, auth, status-machine, assignment, API integration, schema, and concurrency stress coverage. Most integration tests are destructive and require an isolated, reachable Supabase database/project. Run `npm test` after configuring that database. The current test setup file still assigns `DATABASE_URL=file:./dev.db`, which is incompatible with the PostgreSQL Prisma schema; until that test-environment override is corrected, database-backed tests will fail during Prisma initialization rather than exercising the remote database. In the current checkout, pure arithmetic/status tests pass, but a fully green `npm test` run should not be claimed without fixing that setup and ensuring Supabase connectivity. Other useful commands are `npm run test:watch`, `npm run test:coverage`, and `npm run db:studio`.

## API

All protected endpoints accept the JWT session cookie set by login. JSON errors use `{ "error": string }`; validation errors additionally include `{ "details": { field: string[] } }`. Dates are ISO strings when serialized by Next.js/Prisma. IDs are Prisma CUIDs unless a route also accepts a code, pincode, or user ID as documented.

### Authentication

| Method and path | Auth | Request | Response |
| --- | --- | --- | --- |
| `POST /api/auth/register` | Public | `{ name, email, password, phone?, role?, vehicleType?, vehicleNumber? }`; role is `CUSTOMER`, `AGENT`, or `ADMIN` and defaults to `CUSTOMER`. | `201 { message, user, token }`; an AGENT also gets a newly created `agentProfile` with `AVAILABLE` status. |
| `POST /api/auth/login` | Public | `{ email, password }` | `200 { message, user, token }`; also sets the HTTP-only auth cookie. |
| `POST /api/auth/logout` | Public/session optional | No body | `200 { message, success: true }`; clears the auth cookie. |
| `GET /api/auth/me` | Authenticated | None | `200 { user }` with fresh profile data, agent zones/profile, and addresses. |

### Customers

| Method and path | Auth | Request | Response |
| --- | --- | --- | --- |
| `GET /api/customers` | ADMIN | None | `200 { customers: [{ id, name, email, phone }] }`. |

This endpoint exists so an admin can create an order for a selected customer.

### Orders and tracking

`POST /api/orders` accepts an authenticated customer or admin. The request body is:

```json
{
  "customerId": "admin-only-optional-cuid",
  "senderName": "string",
  "senderPhone": "string",
  "senderStreet": "string",
  "senderCity": "string",
  "senderState": "string",
  "pickupPincode": "560092",
  "recipientName": "string",
  "recipientPhone": "string",
  "recipientStreet": "string",
  "recipientCity": "string",
  "recipientState": "string",
  "dropPincode": "560034",
  "packageLengthCm": 20,
  "packageBreadthCm": 15,
  "packageHeightCm": 10,
  "actualWeightKg": 1.2,
  "isCod": false,
  "codAmount": 0,
  "declaredValue": 1000,
  "customerType": "B2C",
  "volumetricDivisor": 5000,
  "scheduledDate": "2026-08-25",
  "notes": "optional"
}
```

`customerId` is used only when the authenticated caller is ADMIN; otherwise the authenticated user's ID owns the order. A successful response is `201` with the created order, pickup/drop zones, a pricing snapshot, `currentStatus: "CREATED"`, a generated `trackingNumber` (`LMD-YYYYMMDD-XXXXX`), and the initial `statusHistory` event.

| Method and path | Auth | Request/query | Response |
| --- | --- | --- | --- |
| `GET /api/orders` | Authenticated | Query: `status?`, `customerId?`, `assignedAgentId?`, `pickupZoneId?`, `dropZoneId?`, `search?`, `page?`, `limit?` (max 100). Customers are restricted to their own orders; agents see assigned orders; admins can filter system-wide. | `200 { orders: [...], pagination: { page, limit, total, totalPages } }`; each order includes `currentStatus` projected from its latest history event. |
| `GET /api/orders/:id` | Authenticated | None | `200` full order with zones, customer, assigned agent, complete ascending `statusHistory`, and `currentStatus`; customer access is owner-only. |
| `GET /api/orders/track/:trackingNumber` | Public | None | `200` sanitized tracking details with `trackingNumber`, zones, progress/current status, and timeline; `404` if not found. |
| `POST /api/orders/:id/status` | AGENT (assigned order) or ADMIN | `{ status, reason?, notes?, metadata? }`; `reason` is required for `FAILED`. Valid statuses: `CREATED`, `ASSIGNED`, `PICKED_UP`, `IN_TRANSIT`, `OUT_FOR_DELIVERY`, `DELIVERED`, `FAILED`, `RESCHEDULED`, `CANCELLED`. | `200` updated order, projected `currentStatus`, and `latestEvent`. Every successful transition inserts a new status-history row. |
| `POST /api/orders/:id/reschedule` | CUSTOMER (owner) or ADMIN | `{ scheduledDate, reason? }`; only a currently `FAILED` order may be rescheduled. | `200` updated order with new `scheduledDate`, `currentStatus: "RESCHEDULED"`, full history, and `latestEvent`. |
| `POST /api/orders/:id/assign` | ADMIN | `{ agentId }` (agent profile ID or agent user ID) | `200 { success, order, assignedAgent }`; updates agent load and appends `ASSIGNED`. |
| `POST /api/orders/:id/auto-assign` | ADMIN | None | `200 { success, reason?, assignedAgent?, order? }`; selects a capacity-eligible available agent mapped to the drop zone. |
| `POST /api/orders/auto-assign` | ADMIN | None | `200 { totalChecked, assignedCount, unassignedCount, results[] }` for all unassigned `CREATED`/`RESCHEDULED` orders. |

### Agents

| Method and path | Auth | Request/query | Response |
| --- | --- | --- | --- |
| `GET /api/agents` | ADMIN or AGENT | Query: `status?`, `zoneId?`, `availableOnly=true|false` | `200 { agents: [{ id, userId, status, vehicleType, vehicleNumber, maxCapacity, activeOrdersCount, availableCapacity, user, operationalZones }] }`. |
| `PUT /api/agents/:id/status` | AGENT (own profile) or ADMIN | `{ status: "AVAILABLE" | "OFFLINE" | "ON_DELIVERY" }` | `200` updated agent profile summary. |
| `PUT /api/agents/:id/zones` | ADMIN | `{ zoneIds: string[] }` | `200` updated agent profile with `operationalZones`; replacement is atomic. |

### Zones and pincode mappings

| Method and path | Auth | Request/query | Response |
| --- | --- | --- | --- |
| `GET /api/zones` | Public/auth optional | Query: `includeInactive=true` (admin only), `search?` | `200 { zones: [...] }` with pincode/agent mapping counts. Non-admin callers see active zones only. |
| `POST /api/zones` | ADMIN | `{ name, code, description?, isActive? }` | `201 { zone }`. |
| `GET /api/zones/:id` | Public/auth optional | `:id` may be zone ID or code | `200 { zone }` with pincodes and order/agent counts. |
| `PUT /api/zones/:id` | ADMIN | Any subset of `{ name?, code?, description?, isActive? }` | `200 { zone }`. |
| `DELETE /api/zones/:id` | ADMIN | None | `200 { message, id }`; zones referenced by orders are deactivated instead of deleted and include `softDeleted: true`. |
| `GET /api/pincodes` | Public/auth optional | Query: `zoneId?`, `search?`, `page?`, `limit?` | `200 { pincodes: [{ id, pincode, areaName, zone }], pagination }`. |
| `POST /api/pincodes` | ADMIN | `{ pincode, areaName?, zoneId }` | `201 { pincodeMapping }`. |
| `GET /api/pincodes/:id` | Public/auth optional | `:id` may be mapping ID or pincode | `200 { pincodeMapping }`. |
| `PUT /api/pincodes/:id` | ADMIN | `{ areaName?, zoneId? }` | `200 { pincodeMapping }`. |
| `DELETE /api/pincodes/:id` | ADMIN | None | `200 { message, id, pincode }`. |
| `POST /api/pincodes/bulk` | ADMIN | `{ items: [{ pincode, areaName?, zoneId }] }`, 1–500 items | `201 { success: true, count, message }`; all upserts run in one transaction. |
| `GET /api/pincodes/:id/zone` | Public | None | `200 { serviceable: true, pincode, areaName, zone }`; `404` returns `serviceable: false` for an unmapped/inactive pincode. |

### Rate cards and quotes

| Method and path | Auth | Request/query | Response |
| --- | --- | --- | --- |
| `POST /api/rates/calculate` | Public | `{ pickupPincode, dropPincode, customerType?, lengthCm, breadthCm, heightCm, actualWeightKg, isCod?, codAmount?, declaredValue?, volumetricDivisor? }` | `200` itemized quote: zones, `zoneType`, weights, configured card parameters, `basePrice`, `weightPrice`, `codSurcharge`, `totalAmount`, `rateCardId`, and `breakdown`. |
| `GET /api/rates/cards` | Public/auth optional | Query: `zoneType?`, `customerType?`, `isActive?` | `200 { rateCards: [...] }`; non-admin callers default to active cards. |
| `POST /api/rates/cards` | ADMIN | `{ zoneType, customerType, baseWeightKg?, baseRate, perKgRate, volumetricDivisor?, codFixedSurcharge?, codPercentSurcharge?, minCodSurcharge?, isActive? }` | `201 { rateCard }`; activating a card deactivates the prior active card for that combination. |
| `GET /api/rates/cards/:id` | Public/auth optional | None | `200 { rateCard }`. |
| `PUT /api/rates/cards/:id` | ADMIN | Any subset of the rate-card fields above | `200 { rateCard }`; active-card uniqueness is maintained for the target zone/customer combination. |
| `DELETE /api/rates/cards/:id` | ADMIN | None | `200 { message, id }`. |

## Database schema

The PostgreSQL Prisma schema contains these tables/models:

- `User`: identity, bcrypt password hash, role, and profile fields. One user has many `Address`, customer-owned `Order`, and changed-by `OrderStatusHistory` records; an agent user has one `DeliveryAgentProfile`.
- `Address`: customer address book entries; many-to-one to `User`, deleted with the user.
- `Zone`: active/inactive operational zone. It has many `PincodeMapping`, pickup `Order`, drop `Order`, and `AgentZoneMapping` records.
- `PincodeMapping`: unique pincode plus optional area name and required `zoneId`; many-to-one to `Zone`.
- `RateCard`: versioned pricing configuration keyed by `zoneType` (`INTRA_ZONE`/`INTER_ZONE`) and `customerType` (`B2B`/`B2C`), including weight and COD parameters.
- `Order`: shipment details, sender/recipient addresses, zone IDs, dimensions, actual/volumetric/billable weights, pricing snapshot, payment fields, schedule, customer, and optional assigned agent.
- `OrderStatusHistory`: append-only order event ledger with status, actor, reason, notes, metadata, and timestamp. It belongs to an `Order` and optionally a `User`.
- `DeliveryAgentProfile`: one-to-one with `User`; stores availability, vehicle, capacity, and active load. It has many assigned `Order` records and `AgentZoneMapping` records.
- `AgentZoneMapping`: join table between agents and zones with a unique `(agentId, zoneId)` pair.
- `NotificationLog`: per-order notification audit record with recipient, event, provider, delivery status, error, payload, and timestamp. It is currently schema-only; no status service writes to it.

Foreign keys use cascading deletion for user-owned addresses, agent mappings, and order history/notifications where appropriate; order zone/customer references are retained with restrictive or `SET NULL` behavior to preserve operational history.

## Rate calculation logic

The API and order service first trim each pincode and look it up in `PincodeMapping`. A mapping is serviceable only when its related `Zone.isActive` is true. The two resolved zone IDs determine `zoneType`: equal IDs produce `INTRA_ZONE`; different IDs produce `INTER_ZONE`. The service then selects the active `RateCard` matching that zone type and the requested `customerType` (`B2B` or `B2C`). No business rates are hardcoded in the calculator.

The pure calculator uses the card's `volumetricDivisor` (or an explicitly supplied divisor, defaulting to `5000`) and computes:

```text
volumetricWeightKg = round2(lengthCm × breadthCm × heightCm / volumetricDivisor)
billableWeightKg   = round2(max(actualWeightKg, volumetricWeightKg))
excessWeightKg     = round2(max(0, billableWeightKg - baseWeightKg))
weightPrice        = round2(excessWeightKg × perKgRate)
```

`basePrice` is the configured `baseRate`. For COD, the principal is positive `codAmount` when supplied, otherwise `declaredValue`; the surcharge is `max(codFixedSurcharge + principal × codPercentSurcharge / 100, minCodSurcharge)`. Non-COD orders have zero surcharge. Finally, `totalAmount = round2(basePrice + weightPrice + codSurcharge)`. Equal actual and volumetric weights naturally bill once at that shared value. The order stores this result as a pricing snapshot so later card changes do not rewrite historical invoices.

## Not yet implemented / limitations

- The three role-separated frontend portals are implemented in the Next.js app and use the current API for login, order creation/listing, agent status updates, and admin order creation/export. Some secondary profile/settings/help and advanced dashboard controls remain presentational placeholders.
- Centralized email notifications are not implemented. `NotificationLog`, notification environment variables, and the `resend` dependency exist, but status transitions, assignment, and rescheduling do not currently call an email sender or write notification records.
- Auto-assignment is zone/capacity/load based. The schema has no latitude/longitude fields, so it does not compute geographic distance or GPS-nearest agents.
- Deployment configuration and a hosted application URL are not included in this repository.
