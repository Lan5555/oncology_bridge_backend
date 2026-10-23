The frontend origin must be included in the comma-separated `CORS_ORIGIN` list in production. The API uses `synchronize: false`:

Admin operational list routes, read grants, pagination, privacy rules and the required migration are documented in [database/ADMIN-OPERATIONAL-READS.md](database/ADMIN-OPERATIONAL-READS.md). The automated facility licence lookup and separate manual evidence contracts are documented in [database/FACILITY-LICENSE-LOOKUP.md](database/FACILITY-LICENSE-LOOKUP.md).

Medicine marketplace deployment, Cloudinary configuration, Paystack setup, and validation are documented in [database/MARKETPLACE.md](database/MARKETPLACE.md). Apply its migration before starting this version of the API.

Brevo email setup, event coverage, password recovery and queue operations are documented in [database/EMAIL.md](database/EMAIL.md). Apply [database/email-service.sql](database/email-service.sql) before deploying this version, and configure the server values in `.env.example` to enable delivery.

## Request conventions

Explicit business input, null/zero semantics, cold-chain evidence and public-statistics definitions are documented in [database/BUSINESS-VALUES.md](database/BUSINESS-VALUES.md). Apply [database/business-values.sql](database/business-values.sql) before deploying this version.

- Send and receive JSON. IDs are UUIDs except role IDs, which are integers.
- Protected routes expect `Authorization: Bearer <token>`.
- Access tokens expire after 15 minutes. Use the refresh endpoint to obtain a replacement.
- Errors use `{ "success": false, "message": "...", "data": null }`.
- Many established services return `{ "success": true, "message": "...", "data": ... }`. A few newer endpoints return their data directly. For frontend parsing, accept either an envelope or a direct result and unwrap `data` only when it exists.
- Validation rejects unknown DTO properties. Use the field names shown below.
- The global validation pipe transforms query parameters only when a handler explicitly converts them; send numeric query values as strings as usual in URLs.

Example request helper:

````ts


## Routes

### Auth and account

| Method  | Route                           | Auth                             | Payload / response                                                                                                                                           |
| ------- | ------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST`  | `/auth/api/login`               | Public                           | `{ "email": "...", "password": "..." }`; response data contains `{ user, token, refreshToken }`. Store `token` for API calls and `refreshToken` for renewal. |
| `POST`  | `/auth/api/refresh`             | Public, refresh token required   | `{ "refreshToken": "..." }`; returns new `{ token, refreshToken, expiresIn }`.                                                                               |
| `GET`   | `/auth/api/log-out/:id`         | Bearer; ID must match token user | Revokes that user's refresh session.                                                                                                                         |
| `GET`   | `/auth/api/ping-server`         | Public                           | Health check.                                                                                                                                                |
| `POST`  | `/auth/api/forgot-password`     | Public                           | `{ "email": "..." }`. Queues a Brevo reset link when configured; always acknowledges known/unknown accounts identically and never returns a token. |
| `POST`  | `/auth/api/reset-password`      | Public                           | `{ "token": "...", "password": "at-least-8-chars" }`.                                                                                                        |
| `GET`   | `/api/me`                       | Bearer                           | Current user.                                                                                                                                                |
| `PATCH` | `/api/me`                       | Bearer                           | Update current user fields accepted by the user service.                                                                                                     |
| `POST`  | `/api/me/verification/resubmit` | Bearer                           | Returns `MANUAL_REVIEW` / `UNAVAILABLE` until registry integration is configured.                                                                            |

### Registration, facilities, network, license check

| Method   | Route                                     | Auth   | Payload / notes                                                                                                                                                                                                                                |
| -------- | ----------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/hospital/api/register-facility`         | Public | Creates a pending facility, inactive initial admin, verification application, and audit rows atomically. The response is `{data:{facility,admin}}` and does not issue a token. Client verification fields are ignored; registry is currently unavailable, so applications enter `MANUAL_REVIEW`. |
| `POST`   | `/api/verify-license`                     | Public | `{ "licenseNumber": "...", "registry": "MDCN", "lastName": "..." }`. Currently returns the manual-review/unavailable result.                                                                                                                   |
| `POST`   | `/api/facility-membership-requests/:requestId/license-check` | Facility Admin | `{ "result": "MATCH"|"NO_MATCH"|"UNAVAILABLE"|"INCONCLUSIVE", "evidence": "..." }`. Records immutable, facility-scoped evidence and an audit event. Reviewer and facility are derived from the authenticated token. This evidence-only action does not change the authoritative licence status or activate the account. |
| `GET`    | `/api/facilities?status=&q=&page=&limit=` | Network Admin (Role C) | Facility listing, counts, device summary, IP whitelist, and last activity.                                                                                                                                                                     |
| `GET`    | `/api/facilities/:id`                     | Network Admin (Role C) | Facility detail.                                                                                                                                                                                                                               |
| `PATCH`  | `/api/facilities/:id`                     | Network Admin (Role C) | Update facility fields, status, `ip_whitelist`, and admin `details`; activation requires an active verified user.                                                                                                                                                                                        |
| `DELETE` | `/api/facilities/:id`                     | Network Admin (Role C) | Audited soft delete.                                                                                                                                                                                                                           |
| `GET`    | `/api/network`                            | Network Admin (Role C) | Facility network view.                                                                                                                                                                                                                         |

Legacy facility aliases are also available under `/hospital/api/find-all-facilities`, `/hospital/api/find-one-facility/:id`, `/hospital/api/update-one-facility/:id`, and `/hospital/api/delete-one-facility/:id`.

Admin review is available at `GET /admin/api/verifications?status=ALL&page=1&limit=50&q=`, `POST /admin/api/verifications/:id/recheck`, and `POST /admin/api/verifications/:id/approve|reject`. Decisions derive the reviewer from the token and atomically update application, user, facility, notification, and audit state. Recheck currently records `UNAVAILABLE` and keeps manual review.

Integration administration routes require `ADMIN` or `SUPERADMIN` with their matching backend permission: `GET /admin/api/integrations/health` (`integration.read`), `GET|PUT /admin/api/integrations/:integrationKey/configuration` and `POST .../:integrationKey/test` (`integration.manage`), and `POST .../:integrationKey/sync` (`integration.sync`). Configuration schemas are server-owned; secret values are held in HashiCorp Vault KV v2 (`VAULT_ADDR`, `VAULT_TOKEN`, optional `INTEGRATION_VAULT_MOUNT`, default `secret`). Non-secret configuration and sync job metadata are stored in the database. Test and sync responses and audit entries redact credentials.

Inventory intake and mutations require active verified facility membership and explicit `inventory.manage`, supplied by a role or an individual facility-bound grant. Network administrators with `admin.access` and `user.update` can assign individual grants using `PUT /api/users/:id/stock-access` with `{ "enabled": true }`; clients must refresh the affected session to reload navigation. Team-management permission does not imply stock permission. See [stock access setup](database/MARKETPLACE.md#stock-intake-and-staff-authorization).

Catalogue mutations accept `inventory.manage` or the corresponding `medicine.create`, `medicine.update` or `medicine.delete` grant. Facility staff may mutate only facility-owned records; network administrators with the corresponding permission manage shared records. `PATCH /api/medicines/:id` accepts only `generic_name`, `brand`, `strength`, and a valid GTIN-14; deletion is audited and preserves inventory references. Apply `database/inventory-access.sql` before starting the API.

### Dashboard and reports

| Method | Route                    | Auth   | Payload / notes                                                                                                                                                             |
| ------ | ------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/dashboard/summary` | Network Admin (Role C) | Computed network, inventory, expiry, and transfer totals. Some UI metrics return `null` until their source integration/data exists.                                         |
| `GET`  | `/api/dashboard/charts`  | Bearer | Chart series derived from scans, stock, and transfers.                                                                                                                      |
| `GET`  | `/api/public/stats`      | Public | Aggregated public network figures.                                                                                                                                          |
| `POST` | `/api/reports/export`    | Bearer + `report.export` | `{ "type": "CSV", "from": "2026-01-01", "to": "2026-12-31" }`. Real CSV/PDF/XLSX files return `data.fileName`, `mimeType`, and `contentBase64`; CSV also retains `data.csv`. Facility scope is derived from the session. |

### Inventory, stock search, expiry

| Method   | Route                                                        | Auth   | Payload / notes                                                              |
| -------- | ------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------- |
| `GET`    | `/api/inventory?category=all&facilityId=&q=&page=1&limit=25` | Bearer | Inventory rows and summary stats.                                            |
| `POST`   | `/api/inventory`                                             | Bearer | Uses `CreateInventoryDto` (see `src/inventory/dto/create-inventory.dto.ts`). |
| `GET`    | `/api/inventory/:id`                                         | Bearer | One stock item.                                                              |
| `PATCH`  | `/api/inventory/:id`                                         | Bearer | Uses `UpdateInventoryDto`.                                                   |
| `DELETE` | `/api/inventory/:id`                                         | Bearer | Remove an inventory row.                                                     |
| `POST`   | `/api/inventory/:id/quarantine`                              | Bearer | Mark stock quarantined.                                                      |
| `POST`   | `/api/inventory/:id/dispose`                                 | Bearer | Mark stock disposed.                                                         |
| `GET`    | `/api/inventory/export.csv`                                  | Bearer | CSV export response.                                                         |
| `GET`    | `/api/inventory/near-expiry?limit=7`                         | Bearer | Expiry watchlist.                                                            |
| `GET`    | `/api/expiry?withinDays=60`                                  | Bearer | Expiring inventory and urgency data.                                         |
| `GET`    | `/api/stock/search?q=&location=`                             | Public | Stock search for landing and prescription flows.                             |

### Scans and medicines

| Method | Route                       | Auth                     | Payload / notes                                                                                                                                 |
| ------ | --------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/scans/decode`         | Bearer                   | `multipart/form-data`: `image` (JPEG/PNG, max 10 MB), `facilityId`, `action`, optional `notes`, `clientUuid`, and `clientTs`.                      |
| `POST` | `/api/scans`                | Bearer                   | Uses `CreateScanLogDto` (see `src/scan_log/dto/create-scan_log.dto.ts`). Supports scan logging and client idempotency data defined in that DTO. |
| `POST` | `/api/scans/batch`          | Bearer                   | JSON array of scan payloads, or `{ "scans": [...] }`; returns per-item processing results.                                                      |
| `GET`  | `/api/scans/recent?limit=5` | Bearer                   | Recent scans.                                                                                                                                   |
| `GET`  | `/api/scans/monthly`        | Bearer                   | Monthly scan counts.                                                                                                                            |
| `GET`  | `/api/gs1/lookup?gtin=`     | Public                   | Find a medicine by GTIN.                                                                                                                        |
| `GET`  | `/api/medicines`            | Existing medicine routes | List medicines. Create/update/delete routes use `/api/medicines` and `/api/medicines/:id`; lookup by GTIN is `/api/medicines/gtin/:gtin`.       |

#### Camera decode request

`POST /api/scans/decode` decodes the captured image in memory and does not create scan, inventory, or audit rows. Its success `data` contains `identifiers` (`gtin`, `lot`, `expiry` as `YYYY-MM-DD`, `serial`), `validation` (`valid`, `status`, `messages`), and a public medicine summary or `null`. A readable but invalid code returns the decoded values with validation messages so the operator can correct them.

#### Confirmed scan request

`POST /api/scans` JSON body (the authenticated user is derived from the bearer token; do not send `userId`):

```json
{
  "gtin": "09506000134352",
  "lot": "LOT-2407A",
  "expiry": "2027-07-31",
  "serial": "8472901",
  "facilityId": "<facility-uuid>",
  "action": "NEW",
  "notes": "Received from supplier",
  "clientUuid": "<client-uuid>",
  "clientTs": "2026-10-14T10:30:00.000Z"
}
````

`quantity` is optional and defaults to `1`. The facility must belong to the authenticated user unless the user has the Network Admin role. Scan writes update inventory and append a `GS1_SCAN` audit record. A repeated serial is returned as `FLAGGED`; retrying the same `clientUuid` returns the original result. Offline sync accepts a raw array or `{ "scans": [...] }` and processes each item independently.

Recent scans are facility-scoped for ordinary users; Network Admin can see network-wide results. The API returns display-safe fields. Monthly totals are real counts and can be empty. `/api/gs1/lookup?gtin=...` is public and returns non-sensitive product identity; an unknown GTIN returns `data: null`.

### Transfers

The named-batch redistribution contract, recipient eligibility, available quantities and required migration are documented in [database/REDISTRIBUTION-SELECTION.md](database/REDISTRIBUTION-SELECTION.md). Apply `database/redistribution-selection.sql` before deploying this version.

The complete transfer list and `POST /api/transfers/:id/dispatch` / `deliver` custody actions also require `database/frontend-contract.sql`; see [FRONTEND-CONTRACT.md](database/FRONTEND-CONTRACT.md). Approval is not physical dispatch or receipt. Active-order timelines now contain recorded transfer timestamps only.

| Method | Route                                         | Auth   | Payload / notes                                                                                                                                          |
| ------ | --------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/transfers?status=`                      | Bearer | List transfers; status is optional.                                                                                                                      |
| `POST` | `/api/transfers`                              | Bearer | `{ "inventoryItemId": "uuid", "recipientFacilityId": "uuid", "quantity": 1 }`. Checks stock, donor/recipient, and 80 km when facility coordinates exist. |
| `GET`  | `/api/transfers/stats`                        | Bearer | Pending and delivery counts.                                                                                                                             |
| `GET`  | `/api/transfers/active-order`                 | Bearer | Timeline derived from transfer data; event timestamps are not fully recorded.                                                                            |
| `GET`  | `/api/transfers/suggest?inventoryItemId=uuid` | Bearer | Nearby active facilities.                                                                                                                                |
| `POST` | `/api/transfers/:id/approve`                  | Bearer | Approves and reserves quantity.                                                                                                                          |
| `POST` | `/api/transfers/:id/reject`                   | Bearer | Rejects a pending request.                                                                                                                               |
| `GET`  | `/api/transfers/:id`                          | Bearer | Transfer details.                                                                                                                                        |

### Prescriptions and invoices

| Method  | Route                           | Auth     | Payload / notes                                                                                                                                                                                                                                                          |
| ------- | ------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST`  | `/api/prescriptions`            | Bearer   | `{ "patient_ref": "pseudonymous-ref", "icd10": "C50.9", "tnm_stage": "...", "drug_id": "uuid", "qty": 1, "insurer": "...", "pharmacy_facility_id": "uuid", "prescriber_id": "uuid" }`. `icd10` must match `Cdd` or `Cdd.d[d]`. Patient reference should be pseudonymous. |
| `GET`   | `/api/prescriptions?tab=active  | awaiting | completed`                                                                                                                                                                                                                                                               | Bearer | Returns `{ prescriptions, counts }`. |
| `PATCH` | `/api/prescriptions/:id`        | Bearer   | Updates prescription fields.                                                                                                                                                                                                                                             |
| `GET`   | `/api/prescriptions/:id/events` | Bearer   | Order timeline events.                                                                                                                                                                                                                                                   |
| `POST`  | `/api/invoices`                 | Bearer   | Creates invoice record. Current endpoint expects invoice fields (`order_id`, `pharmacy_facility_id`, `total_naira`; optional `reference`).                                                                                                                               |
| `GET`   | `/api/invoices/:reference`      | Public   | PII-minimized invoice lookup with item details and `isDemo: true`.                                                                                                                                                                                                       |
| `GET`   | `/api/settlements/summary`      | Network Admin (Role C)   | Aggregated settlement values.                                                                                                                                                                                                                                            |

Paystack checkout, payment verification, settlement creation from completed payments, and insurer authorization webhooks are not implemented yet. The frontend should present payment as unavailable/demo until those integrations are added.

### Cold chain

| Method           | Route                                                              | Auth          | Payload / notes                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`            | `/api/storage-units`                                               | Bearer        | Facility-scoped real units with latest `currentC` (nullable), target range, `readingState` (`NOMINAL`, `BREACH`, `OFFLINE`), and last-seen time.                        |
| `POST` / `PATCH` | `/api/storage-units[/:id]`                                         | Network Admin | Create/update unit metadata and temperature limits.                                                                                                                     |
| `GET`            | `/api/cold-chain-events?unitId=&status=&from=&to=&page=1&limit=25` | Bearer        | Facility-scoped, paginated persisted events; status is `OPEN` or `RESOLVED`.                                                                                            |
| `GET`            | `/api/coldchain/history?hours=24&unitId=`                          | Bearer        | Ascending persisted reading series for the caller's facility. `hours` is clamped to 1–720.                                                                              |
| `GET`            | `/api/coldchain/stream`                                            | Bearer        | Authenticated SSE stream. Send `Last-Event-ID` on reconnect; events are scoped and replayed from the transactional outbox.                                              |
| `POST`           | `/iot/readings`                                                    | Signed device | HMAC-authenticated batch; success is HTTP 202. Body: `{ "readings": [{ "unitId": "uuid", "celsius": 5.2, "recordedAt": "2026-10-14T10:30:00.000Z", "sequence": 1 }] }`. |
| `GET` / `POST`   | `/api/iot/devices`                                                 | Network Admin | List safe device metadata or provision a device with `{ deviceId, facilityId, secretRef, unitIds, expectedIntervalSeconds, sensorMinCelsius, sensorMaxCelsius }`.       |
| `GET`            | `/api/iot/devices/metrics`                                         | Network Admin | Process-local ingest counters for accepted/rejected/duplicate/delayed readings, breach/offline transitions, and outbox failures.                                        |
| `POST`           | `/api/iot/devices/:id/rotate`                                      | Network Admin | `{ "secretRef": "ENV_SECRET_NAME" }`; only the reference and fingerprint are stored.                                                                                    |
| `POST`           | `/api/iot/devices/:id/revoke`                                      | Network Admin | Revoke a device credential.                                                                                                                                             |

Device credentials are configured on the API server as `IOT_DEVICE_KEYS={"ENV_SECRET_NAME":"long-random-secret"}` (or individual environment variables named by `secretRef`). Never send secret values in provisioning requests. The signature is lowercase hex HMAC-SHA256 over `timestamp.nonce.` followed by the exact raw JSON request bytes. Required headers are `X-Device-Id`, `X-Request-Timestamp` (Unix seconds/milliseconds or ISO timestamp), `X-Request-Nonce` (unique random value, 16–160 allowed characters), and `X-Request-Signature` (`sha256=<hex>` or `<hex>`). Timestamps are accepted within five minutes; nonce reuse is rejected. Device assignments and each reading's unit/facility are checked before persistence. The batch is validated as a whole, duplicate device sequence numbers are idempotently counted, and new readings, open/resolve events, inventory quarantine/recovery, and outbox rows are committed transactionally. In production behind a TLS reverse proxy, set `TRUST_PROXY=1` and prevent direct public access to the Nest process so the HTTPS check trusts only the configured proxy.

Apply [`database/cold-chain-hardening.sql`](database/cold-chain-hardening.sql) after [`database/oncosourz-new-entities.sql`](database/oncosourz-new-entities.sql). The application uses `synchronize: false`; migration is required before enabling the new modules. Provisioning steps: configure a unique secret reference and secret in the deployment environment, create storage units, assign inventory by setting `storage_unit_id`, provision the device through the admin route, then have the sensor send signed requests over HTTPS. Configure TLS termination and `CORS_ORIGIN` for browser clients; device ingest is server-to-server and does not use bearer tokens. The outbox worker retries failed audit/notification work, and `/api/iot/devices/metrics` exposes process-local counters for accepted/rejected/duplicate/delayed readings, breach/offline transitions, and outbox failures. No automated raw-reading purge is enabled. Archive readings to encrypted, access-controlled storage after 24 months, retain them longer when linked to an unresolved breach or active investigation, and retain event/audit evidence under the organization's records policy; confirm applicable legal retention requirements before enabling archival automation.

### Notifications, settings, audit

| Method        | Route                                     | Auth   | Payload / notes                                                                                       |
| ------------- | ----------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| `GET`         | `/api/notifications?userId=`              | Bearer | List notifications.                                                                                   |
| `PATCH`       | `/api/notifications/:id/read`             | Bearer | Mark notification as read.                                                                            |
| `GET` / `PUT` | `/api/settings`                           | Bearer | Read or upsert settings as a JSON object keyed by setting name.                                       |
| `GET`         | `/api/audit?type=&actor=&from=&to=&page=` | Bearer | Audit list filters depend on existing audit service fields.                                           |
| `GET`         | `/api/audit/export.csv`                   | Bearer | CSV export.                                                                                           |
| `GET`         | `/api/audit/verify`                       | Bearer | Verification status; hash-chain verification needs the existing audit schema to contain chain hashes. |

### Users, roles, verification, research

| Method  | Route                                                 | Auth                 | Payload / notes                                                                                                 |
| ------- | ----------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------- |
| `GET`   | `/api/users?take=50&skip=0&roleId=&facilityId=`       | Network Admin (Role C) | Paginated user list.                                                                                            |
| `GET`   | `/api/users/:id`                                      | Bearer               | User detail.                                                                                                    |
| `PATCH` | `/users/api/update-one-user/:id`                      | Existing route       | Update a user.                                                                                                  |
| `GET`   | `/api/roles`                                          | Network Admin (Role C) | Role listing includes permissions and user counts. Create/update/delete at `/api/roles` and `/api/roles/:id`; `GET/PUT /api/roles/:id/permissions` reads or sets permission keys. |
| `GET`   | `/api/verification-applications?status=MANUAL_REVIEW` | Network Admin (Role C) | Legacy review listing. Use `/admin/api/verifications` for the paginated applicant/facility queue and decisions. |
| `POST`  | `/api/research/inquiries`                             | Public               | `{ "name": "...", "organisation": "...", "email": "...", "message": "..." }`.                                   |
| `GET`   | `/api/research/stats`                                 | Public               | Aggregated inquiry count.                                                                                       |

Brevo delivers account, password-recovery and notification emails when configured; see [database/EMAIL.md](database/EMAIL.md). Registration verification decisions update the applicant and facility, and persist an in-app notification and email atomically. CAPTCHA/rate limiting and automatic email replies for public inquiry forms are not configured.

## Frontend mapping

Admin overview counts and the protected prescription authorization queue are documented in [database/PRESCRIPTION-REVIEW.md](database/PRESCRIPTION-REVIEW.md). Apply [database/prescription-review.sql](database/prescription-review.sql) before deploying the updated prescription routes and entity.

In-transit temperature monitoring is prepared with an explicitly pending provider adapter. Apply [database/shipment-temperature.sql](database/shipment-temperature.sql) before deploying it; API routes, frontend status handling, and provider integration steps are in [database/SHIPMENT-TEMPERATURE.md](database/SHIPMENT-TEMPERATURE.md).

Buyer/admin marketplace purchase order tracking and fulfillment are documented in [database/PURCHASE-ORDERS.md](database/PURCHASE-ORDERS.md). Apply its migration before deploying the order routes and updated checkout worker.

The managed choices, pharmacy directory, transfer custody workflow, and real report downloads require [database/frontend-contract.sql](database/frontend-contract.sql). Deployment order, option provisioning, permission grants, and API shapes are in [database/FRONTEND-CONTRACT.md](database/FRONTEND-CONTRACT.md).

- Auth screens: `/auth/api/login`, `/auth/api/refresh`, `/hospital/api/register-facility`.
- Dashboard: `/api/dashboard/summary`, `/api/dashboard/charts`, `/api/notifications`.
- Inventory and scan screens: `/api/inventory`, `/api/expiry`, `/api/scans`, `/api/gs1/lookup`.
- Transfer screen: `/api/transfers` routes.
- Prescription and payment screens: `/api/prescriptions`, `/api/invoices`; payment actions remain external integration work.
- Cold chain: `/api/storage-units`, `/api/cold-chain-events`, `/api/coldchain/history`, and `/api/coldchain/stream`; data comes from configured storage units and signed sensor readings.
- Settings and profile: `/api/settings`, `/api/me`.
- Research forms: `/api/research/inquiries`.

## Scanner database change

The API uses `synchronize: false`. Apply [database/gs1-scanner.sql](database/gs1-scanner.sql) once to add persisted idempotency, facility scope, action, and audit metadata to the existing `scan_logs` table before using the scanner routes.

## Facility registration and admin portal database change

After applying the base schema (including `verification_applications`, `audit_logs`, and `role_permissions`), apply [database/facility-registration.sql](database/facility-registration.sql) to add registration verification fields, facility soft-delete/IP metadata, review timestamps, structured audit metadata, the least-privilege `FACILITY_ADMIN` role, and initial permission grants for deployed `ADMIN`/`SUPERADMIN` roles. `synchronize` is disabled, so the migration is required before deploying these routes.
