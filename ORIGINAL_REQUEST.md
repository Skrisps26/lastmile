# Original User Request

## 2026-08-23T10:07:15Z

Build a production-quality Last-Mile Delivery Tracker platform where customers and admins create orders with auto-calculated charges, agents are assigned intelligently, and customers are notified at every step of the delivery journey.

Working directory: /home/skrisps/lastmile
Integrity mode: development

Repository: https://github.com/Skrisps26/lastmile.git

## Execution Process & Deliverables

1. **Plan First Deliverable:**
   Before writing application code, create a comprehensive written architecture and implementation plan (`PLAN.md`) detailing:
   - Task breakdown per specialized agent role with explicit inter-agent dependencies.
   - Build order and module integration phases.
   - Relational database schema draft (PostgreSQL / Prisma).
   - API surface draft (auth, zones, rate cards, orders, assignments, status tracking).
   - Technology stack selections and justifications.
   - Clarified assumptions and constraints.

2. **Git Workflow & Incremental Commits:**
   - Work inside the `/home/skrisps/lastmile` repository.
   - Create feature branches per module (e.g. `feat/rate-engine`, `feat/auth`, `feat/assignment-engine`, `feat/frontend`).
   - Push regular, atomic commits using Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`) leaving the build in a working state.

3. **Final Deliverables:**
   - Full-stack application source code in the repository.
   - `README.md` with setup guide, `.env.example`, API documentation, DB schema, and plain-English rate calculation explanation.
   - System design write-up (max 800 words) covering the rate calculation engine, pincode-to-zone detection, agent assignment logic, and failed-delivery handling.

## Requirements

### R1. Dynamic Zone Management & Rate Calculation Engine
- Provide runtime admin configuration for geographic zones, pincode/area-to-zone mappings, intra-zone and inter-zone rate cards (differentiated for B2B and B2C), and COD surcharges with zero hardcoded rates, divisors, or surcharges.
- Implement an isolated, independently testable rate calculation engine:
  - Detect pickup and drop zones from pincode/area mappings.
  - Compute volumetric weight as `(Length × Breadth × Height) / 5000`.
  - Determine billable weight as `max(actual_weight, volumetric_weight)`.
  - Lookup and apply corresponding rate card (intra-zone vs inter-zone, B2B vs B2C).
  - Add COD surcharge when payment type is Cash on Delivery.
- Provide an upfront price quotation API returning an itemized cost breakdown before order placement.

### R2. Role-Based Order Lifecycle & Immutable Tracking History
- Implement role-based authentication and authorization for `Customer`, `Delivery Agent`, and `Admin`.
- Implement order tracking via an append-only event ledger (`order_status_history`: `order_id`, `status`, `changed_by`, `changed_at`, `notes/reason`) where current order status is strictly derived from the latest ledger event.
- Support valid status transitions: `Created` → `Assigned` → `Picked Up` → `In Transit` → `Out for Delivery` → `Delivered` / `Failed`.
- Handle failed deliveries: flag failed attempt, notify customer, allow customer to reschedule for a new date, and reassign the agent.

### R3. Delivery Agent Management & Auto-Assignment Engine
- Manage delivery agent operational profiles, active status toggles (Available, Offline, On Delivery), and assigned operational zones.
- Support manual admin agent assignment and auto-assignment matching new orders to available agents operating within the pickup/delivery zone.

### R4. Centralized Notification Pipeline
- Hook email notifications into the status lifecycle service so that every status transition triggers an email notification to the customer.
- Integrate with an email delivery service (e.g. Resend or Brevo) with a mock/logging fallback for local development and test environments.

### R5. Full-Stack Applications & Portals
- **Customer Portal:** Registration/login, address management, order booking with live rate quote preview, real-time tracking timeline, and reschedule interface for failed deliveries.
- **Agent Portal:** Active delivery queue, customer/address details, and one-click status transitions.
- **Admin Dashboard:** System-wide order oversight with multi-parameter filtering (status, zone, agent), manual status override capabilities, runtime rate card and zone editor, and agent roster management.

### R6. Automated Test Suites & Verification
- Unit test suite for the rate calculation engine covering all edge cases (actual vs volumetric weight ties, intra-zone vs inter-zone, B2B vs B2C, COD vs prepaid).
- Integration test suite validating order lifecycle state transitions and immutability of the audit ledger.
- Integration tests for auto-assignment and failed-delivery rescheduling.

## Acceptance Criteria

### Rate Engine & Zones
- [ ] Rate engine is independently unit-tested across all edge cases (weight ties, intra/inter-zone, B2B/B2C, COD).
- [ ] Pincode/area-to-zone mappings, rate cards, and COD surcharges can be updated dynamically at runtime via admin API/UI without restarts.
- [ ] Volumetric weight is calculated using `(L × B × H) / 5000` and billed against `max(actual, volumetric)`.

### Order Lifecycle & Immutability
- [ ] Status updates append new records to `order_status_history` without mutating past records or the parent status column directly.
- [ ] Current order status is accurately projected from the latest ledger record.
- [ ] Failed delivery creates a fail record, triggers a notification, enables customer rescheduling, and correctly reassigns the order.

### Assignment & Dispatch
- [ ] Admin can manually assign any available agent to an unassigned order.
- [ ] Auto-assignment correctly selects an available agent matching the order zone.

### User Portals & Features
- [ ] Customers can view real-time tracking timeline with status timestamps and notes.
- [ ] Admins can filter orders by status, zone, and assigned agent, and execute status overrides.
- [ ] Delivery agents can view assigned orders and transition statuses sequentially.

### Verification & Deliverables
- [ ] Complete automated test suite passes with zero failures.
- [ ] README contains setup guide, `.env.example`, API docs, DB schema, and plain-English rate calculation explanation.
- [ ] System design write-up (max 800 words) covers rate engine, zone detection, auto-assignment, and failed delivery handling.
