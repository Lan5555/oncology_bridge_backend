# Shipment temperature monitoring

Shipment monitoring supports marketplace purchase orders and redistribution courier assignments as separate source types. Storage-unit telemetry is unchanged. The production provider adapter is deliberately pending: no provider URL, credentials, mock data, public ingestion endpoint, or assumed authentication protocol is introduced.



Grant `admin.access` plus `coldchain.manage` to authorized network operators for creating, correcting and synchronizing monitoring. Network readers need `admin.access` and `coldchain.read`. Existing network-admin MFA checks apply to administrative routes. No permissions are granted automatically. Buyer and participating facility reads are scoped to the authenticated identity; unrelated shipment IDs return 404. Facility administrators never obtain network scope just by receiving cold-chain permission keys.

## Routes and frontend behavior

All routes require the caller's bearer access token and use `{success,message,data}`.

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/api/shipments?page=1&limit=20` | Authorized persisted monitoring records (maximum limit 100). |
| GET | `/api/shipments/:id/temperature` | Status, limits, courier/device link, latest actual reading, and excursion count. |
| GET | `/api/shipments/:id/temperature/history?page=1&limit=20` | Actual readings ordered newest first. |
| GET | `/api/shipments/:id/temperature/events?page=1&limit=20` | Persisted temperature excursion events, newest first. |
| POST | `/admin/api/shipments` | Create monitoring for one source. |
| PATCH | `/admin/api/shipments/:id/monitoring` | Correct all settings with `expectedVersion`, only before readings exist and while the shipment is active. |
| POST | `/admin/api/shipments/:id/temperature/sync` | Attempt authenticated provider synchronization; HTTP 503 while the provider integration is pending. |

Creation for a marketplace purchase needs `orderId`, `courierId`, and these settings: `provider` (supplier identifier), `deviceId` (actual sensor identifier), `minCelsius`, `maxCelsius`, and `staleAfterSeconds` (30–86400). The temperature range must be reviewed for the shipment; there is no default medication temperature range. The purchase must be paid, stock consumed, and eligible for fulfillment. For a redistribution shipment, send `courierAssignmentId` instead of `orderId` and omit `courierId`; the existing assignment supplies the courier. The assignment and transfer must both be active. Exactly one source is required. Monitoring setup does not dispatch, deliver, or pay for a shipment.

Only one monitor per source is allowed. The same provider/device cannot be assigned to two active shipments. Terminal sources permit later reuse of that device. Settings corrections are versioned and audited; readings/events and historical source/threshold identity cannot be rewritten after data collection. Source cancellation/rejection and delivery end monitoring.

The production default is `providerConfigured: false`, `monitoringStatus: "PENDING_INTEGRATION"`, `temperatureStatus: "NO_DATA"`, and `latestReading: null`. An empty history is real absence of data, accompanied by that pending status. Do not show a healthy temperature, a live badge, or a simulated chart. If no monitor has been configured, the list simply contains no record; the UI should show monitoring not configured. Reads never infer values from carrier tracking or GPS.

Once connected, statuses are `AWAITING_DATA`, `RECEIVING`, `STALE`, or `ENDED`. The temperature status describes the latest actual sample (`NO_DATA`, `IN_RANGE`, `OUT_OF_RANGE`); it does not certify product suitability. Display the sample's `recordedAt` and stale status together. Keep earlier excursions visible even after a later in-range sample. Out-of-range samples append events and deduplicated in-app notifications for active verified buyers/participating facility users. No automated clinical release, stock quarantine/release, disposal, SMS or email decision is added.

The frontend can refresh the list/detail/history/events every `pollAfterSeconds` (currently 30) while visible, pausing configuration form refresh during edits. This backend repository contains no frontend implementation. Unknown delivery/location fields are not manufactured.

## Connecting the provider later

Replace the `PendingShipmentProvider` binding at `SHIPMENT_TEMPERATURE_PROVIDER` in `src/shipments/shipments.module.ts` with an adapter implementing `ShipmentProvider`. Obtain the supplier's documentation first: authentication, device mapping, Celsius/Fahrenheit units, timestamps/timezone, stable reading IDs, polling/webhook support, rate limits and pagination/backfill behavior. Keep credentials in private server configuration. `configured()` must remain false until a supported connection is actually configured. This implementation supports authenticated polling; a future webhook route requires the documented signature/replay checks before reaching the persistence layer. No client can submit arbitrary temperature samples now.

The adapter returns at most 500 normalized readings per pull: `{eventId,deviceId,celsius,recordedAt}`. Use timezone-qualified ISO timestamps and a stable event ID. Authenticate the provider, enforce request timeouts, paginate/cursor correctly, and retain enough overlap to handle delayed readings. The current pull context includes the monitoring start, so the adapter must deliberately manage large histories rather than repeatedly return only the earliest page. Background polling starts only for a configured adapter and retries active monitors every 30 seconds (up to 20 per pass). Multiple replicas may pull the same source; database locks and unique reading IDs prevent duplicate effects.

Persistence rejects a mismatched device, invalid/future timestamps, samples preceding monitoring setup, non-finite temperatures, oversized batches, and event IDs reused with changed values. It rechecks monitoring version and terminal source status under database locks after fetching. Valid out-of-order samples stay in history without replacing the newest measurement. Readings, excursion events, and notifications commit together. Provider failures never fabricate successful synchronization or new readings; existing samples become stale based on their observation time. Source history and monitoring thresholds remain immutable after the first reading.

## Verification

`shipments.spec.ts` uses PGlite and real HTTP bearer/permission guards with test-only provider data. It covers pending behavior, scope restrictions, source links, required range validation, unique device assignment, optimistic edits, duplicate samples, out-of-order measurements, stale/ended monitoring, excursions, and invalid batch rollback. Real provider connectivity, sensor timing and separate-connection PostgreSQL contention remain deployment checks after the supplier API is available. No environment files are read by these tests.
