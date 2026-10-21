# Dashboard access and calculations

Deploy the backend and apply `database/dashboard-access.sql` after the existing facility, inventory, GS1 and cold-chain migrations. The migration adds only `dashboard.read` to the intended existing facility workspace roles (FACILITY_ADMIN, PHARMACIST, PHARMACY_STORE, DOCTOR, ONCOLOGIST). It does not create roles or grant network administration. For a custom role, deliberately assign `dashboard.read` through the role permission API. Existing login, refresh and `/api/me` serializers return assigned permissions; refresh the affected user session to update navigation. This migration has not been applied to a live database by Codex.

The frontend paths remain:

- `GET /api/dashboard/summary`
- `GET /api/dashboard/charts`
- `GET /api/inventory/near-expiry?limit=7`

Use the facility `userSession` bearer token for facility requests. Each request checks current account activity, active undeleted facility membership, VERIFIED user status, latest verification application (when present), and the current database `dashboard.read` grant. The dashboard guard overrides any stale token facility claims using persisted membership. Caller-supplied facility query parameters do not widen scope. Unauthorized accounts receive 401/403, not empty successful data.

Only ADMIN/SUPERADMIN identities receive network dashboard scope, with `admin.access`, `dashboard.read` and configured MFA checks. Near-expiry retains the network `inventory.read` permission requirement. Use the explicitly selected `adminSession` token for these requests. The backend never selects a token from another signed-in session. Responses have `Cache-Control: private, no-store`.

Both dashboard endpoints retain `{ success, message, data }`. `data.scope` is `{type:"facility",facilityId}` or `{type:"network"}`. `asOf` is the database snapshot timestamp. Every dashboard response reads committed persisted data inside a fresh repeatable-read transaction; there is no aggregate cache, worker or intentional aggregation delay. Inventory edits/intake, scans, medicine deletion, transfers, payments and cold-chain changes are therefore reflected by the next request after their database transaction commits. Summary and charts requested separately can have different timestamps if a mutation commits between requests. Database failures propagate as errors. Near-expiry also queries current inventory and returns an `asOf` generation timestamp.

## Stock and units

Eligible availability requires an active undeleted facility, an undeleted medicine, positive quantity, AVAILABLE/NEAR_EXPIRY status, and expiry today or later. Disposed, quarantined, expired and deleted stock does not contribute to availability. Medicine inactivity is represented by `deleted_at`; there is no separate activity flag in this schema.

- `nodes`: active undeleted facilities within the authorized scope (one for a facility dashboard).
- `totalVials`: eligible quantity explicitly reviewed as `selling_unit='vial'`.
- `quantitiesByUnit`: eligible quantities separated into vial/box/pack/bottle/unknown. No package-to-vial conversion is guessed.
- `gs1AuthenticatedVials`: distinct CLEAN GS1 `(gtin, serial)` identities linked to eligible vial inventory, capped by its remaining quantity. Only scanner records with a client UUID, recognized action and matching medicine GTIN, batch and expiry qualify. Flagged/replayed serials and manual intake alone do not add authenticated stock. A scan proves one serial, not an arbitrary submitted quantity. Legacy/unreviewed units remain unknown until staff reviews the unit through inventory editing; a barcode alone cannot establish whether its package is a vial or a box. Scan intake also accepts optional `unit`/`sellingUnit` (vial, pack, bottle, box) reviewed by the authorized scanner operator. If both are supplied they must match. It only merges stock having the same reviewed unit, expiry and available status; omitted units merge only with unknown-unit batches, so a scan cannot silently add an unknown package to a box/vial batch. Without per-serial depletion records, this is a capped serial-evidence measure, not exact serial-level custody accounting.
- `stockOutRiskPct`: percentage of distinct medicines represented by non-disposed inventory in scope that have no eligible available stock. This is current stock unavailability, not a demand forecast; an empty tracked set returns zero.
- `nearExpiry`: eligible batch count expiring within 60 days. The watchlist uses the same eligibility, ordered by expiry, with the requested item limit.

`therapeuticStock` returns `{drug,unit,qty}` grouped by medicine and unit. `drugSplit` returns `{drug,unit,pct}`, with each percentage calculated within its unit, so the frontend must separate units. It must not render boxes and vials as a single share denominator. `inventoryOverTime` returns `{label,vials,quantitiesByUnit}` for current remaining eligible stock grouped by intake month, with `inventoryOverTimeBasis="current_available_stock_by_intake_month"`. Label this **Current available stock by intake month**. The database has no complete inventory movement ledger from which to reconstruct historical balances; these points are not past month-end snapshots. Edits and removals change the corresponding intake cohort. Empty stock produces empty arrays.

## Transfers and cold chain

`redistributionEfficiency` contains only persisted DELIVERED transfer records touching the facility (or all delivered transfers for network scope). Rows have `{id,label,quantity,unit,days:null}`; `unit` comes from the linked source inventory or is unknown. Label the view **Completed redistributions**. The existing transfer schema has an approval timestamp but no delivery timestamp; `redistributionTimingAvailable=false` explicitly signals that delivery duration is unavailable. Do not render approval duration as delivery efficiency. Quantities retain the transfer's source units and must not be summed as vials without source unit review.

`chainIntegrityPct` is the percentage of registered storage units in scope that are ONLINE, have a recent heartbeat within their configured offline threshold, and have no OPEN cold-chain event. No registered units returns numeric zero; `monitoredStorageUnits` distinguishes no monitoring from observed failure. Label this **Storage units currently healthy (%)**, not lifetime temperature compliance. Cold-chain events/heartbeats affect it; prescriptions, orders and listings do not. Resolving an event restores health only if connectivity/heartbeat conditions also hold.

`velocityPct`, `stockOutDeltaPct` and `valueRecoveredNaira` remain explicitly unavailable (`null`); no demand history or recovered-value calculation is invented. Payments and order/prescription/listing changes alone do not increase physical inventory, facility counts or cold-chain health. A payment that actually decrements persisted inventory changes stock on the next read.

## Verification

`src/dashboard/dashboard.spec.ts` exercises real bearer JWT verification and PostgreSQL aggregate queries with simultaneous facility, ADMIN and SUPERADMIN sessions, forged scope claims, permission/verification/activity/MFA denials, inventory baselines/edits, mixed units, qualifying versus flagged scans, medicine deletion/disposal, completed transfers, cold-chain events, empty data and source failures. Run alongside the inventory/auth/operational-read regression suites. Live deployment acceptance still requires applying the migration and repeating the baseline/mutation/refresh checks using the deployment's real facility and admin logins.
