# System Design

## Rate calculation engine

Pricing is split between a database-backed orchestration layer and a pure calculator. The order service and `/api/rates/calculate` resolve serviceability and select an active `RateCard`; `src/lib/rate-engine/calculator.ts` then performs only deterministic arithmetic. This separation makes the highest-risk pricing rules unit-testable without HTTP or database state.

The calculation first chooses the card’s volumetric divisor (an explicit request override, otherwise the card value, with `5000` as the calculator fallback), then computes `round2(L × B × H / divisor)`. Billable weight is `round2(max(actualWeightKg, volumetricWeightKg))`, so a tie is billed once at that shared weight. The amount above the configured `baseWeightKg` is multiplied by `perKgRate`; the configured `baseRate` remains the base charge. COD adds `max(codFixedSurcharge + principal × codPercentSurcharge / 100, minCodSurcharge)`, where principal is positive `codAmount` or, if absent, `declaredValue`. Non-COD is zero. The total is `round2(basePrice + weightPrice + codSurcharge)`.

All values come from the selected B2B/B2C and INTRA_ZONE/INTER_ZONE card. Cards are admin-managed, and the order stores the chosen card’s resulting values as a pricing snapshot. Later configuration changes therefore affect new quotes, not historical orders.

## Zone detection approach

Zone detection deliberately uses a relational pincode/area mapping rather than geocoding. A `PincodeMapping` stores a unique pincode, optional human-readable area name, and `zoneId`; lookup joins the related `Zone` and rejects unmapped pincodes or inactive zones. Pickup and drop zone IDs are compared directly to classify a shipment as intra-zone or inter-zone. This is deterministic, inexpensive, explainable to operations staff, and fully admin-editable without a geocoding provider.

The current schema has no latitude/longitude fields. Consequently, assignment does not claim to calculate physical GPS distance: it matches an order’s drop zone to `AgentZoneMapping`. Location coordinates would be a separate concern for future live-agent telemetry and true nearest-agent routing, not a prerequisite for tariff zone classification.

## Auto-assignment logic

An administrator can assign a specific agent or trigger single/batch auto-assignment. Both paths update the order, agent load, and `ASSIGNED` status event. Auto-assignment considers agents with `AVAILABLE` status, a mapping to the order’s drop zone (falling back to pickup zone), and `activeOrdersCount < maxCapacity`. Candidates are ordered by lowest active load and then oldest `updatedAt`, providing load balancing and an idle-time tie-breaker. Capacity and status are represented explicitly on `DeliveryAgentProfile`.

The recent race fix has two layers. Within a Node process, all assignment attempts share an `all-assignments` promise lock, so concurrent orders cannot race the same capacity counter. The transaction also conditionally claims the order (`assignedAgentId` must still be null, or the previous assignment on a rescheduled order) and conditionally increments the selected agent only while it remains `AVAILABLE` and below capacity. A failed conditional claim returns an already-assigned result; a failed agent claim aborts the transaction. The database transaction therefore protects the state transition even when requests arrive concurrently, while the process lock prevents local write-lock storms. Manual assignment uses an atomic transaction to release a previous agent, update the target load, update the order, and append the event.

## Failed delivery handling

Status is not a mutable column on `Order`; it is projected from the latest `OrderStatusHistory` row. The status machine allows failure from `PICKED_UP`, `IN_TRANSIT`, or `OUT_FOR_DELIVERY`, and requires a non-empty reason for `FAILED`. The transition service inserts a new immutable row and releases the assigned agent’s active load when an order reaches `FAILED`, `DELIVERED`, or `CANCELLED`.

A customer or admin may then call reschedule, but only when the projected status is `FAILED`. The service validates the date, updates `scheduledDate`, and transactionally appends `RESCHEDULED` with the old/new date metadata. The order is eligible for auto-assignment again; a subsequent assignment appends another `ASSIGNED` row and increments a currently eligible agent. This preserves every attempt and actor in the ledger instead of overwriting the delivery history. Email notification is not yet connected to these transitions; the notification table exists for the future centralized integration.
