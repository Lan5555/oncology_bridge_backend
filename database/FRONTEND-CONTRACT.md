# Frontend API contract deployment

Apply `frontend-contract.sql` after `redistribution-selection.sql`, `business-values.sql`, the existing audit/verification/inventory-access migrations, and `email-service.sql`. SQL is rerunnable and is not applied automatically (`synchronize=false`). No production database or email provider is contacted by the automated tests.

## Managed choices

`GET /api/form-options?context=prescription|marketplace|settings|reports` returns `{success,message,data:{context,options}}`. The respective groups are `insurers`, `categories`, `currencies`, and `reportFormats`, containing `{value,label}` pairs. Responses use `Cache-Control: private, no-store`.

Operators provision reviewed rows in `form_options(context,value,label,active,position)` through the normal database change process. Values are identifiers accepted by the existing fields, not frontend labels to translate. There are no sample insurers, category seeds, currency defaults, or automatic options inferred from historical records. Keep values trimmed and NFC-normalized; currency values must be uppercase ISO 4217 codes supported by Node's ICU data. Category identifiers are limited to 100 characters, insurer identifiers to 120. Set `active=false` to withdraw a choice; existing records are preserved. Empty groups are valid and require configuration before the corresponding required choice can be submitted.

### Adding an insurer or payment method

If the frontend displays **No choices were returned for this field**, check the database used by the running API. The **Insurer / payment method** field reads active rows with `context='prescription'`; it is returned under `data.options.insurers`. There is no separate `payment_methods` context. Applying the migration alone does not add choices.

For example, **only if your deployment supports self-payment**, run this in that database after applying `frontend-contract.sql`:

```sql
INSERT INTO form_options (context, value, label, active, position)
VALUES ('prescription', 'SELF_PAY', 'Self-pay', true, 0)
ON CONFLICT (context, value) DO UPDATE
SET label = EXCLUDED.label, active = true, position = EXCLUDED.position;
```

Use the same statement with your reviewed insurer/payment identifiers and display labels to add other choices. This is a manual configuration example, not an automatically applied seed. `value` is the exact string submitted as prescription `insurer`; `label` is what the user sees.

Check the configured rows:

```sql
SELECT value, label, active, position
FROM form_options
WHERE context = 'prescription'
ORDER BY position, label, value;
```

Then reload the form, or retry authenticated `GET /api/form-options?context=prescription`. The example returns `data.options.insurers: [{"value":"SELF_PAY","label":"Self-pay"}]`. A backend restart is unnecessary: choices are read from the database on each request. If the API still returns an empty array, confirm the SQL was run in the same database configured for the deployed API and that the rows have `active=true`.

Listing creation rechecks the category in both validation and final save transactions. Category searches also require a current option. Prescription create/update rechecks insurer choices. Currency updates check current managed values in the save transaction; blank/null still clears the preference. Money explicitly denominated in NGN is unaffected. Report formats are derived from the implemented CSV, PDF, and XLSX exporters.

Facility accounts require current verified membership. Prescription metadata and the pharmacy directory require a doctor account; marketplace metadata uses existing supported marketplace account types. Network administrators require `admin.access` plus the relevant `prescription.read`, `marketplace.read`, `settings.read`, or `report.export` permission. Reports require `report.export` for facility users too. These last two permission keys are now assignable in the role catalogue; this migration grants no new access automatically.

## Prescriptions

`GET /api/prescriptions/pharmacies?page=1&limit=100` returns `{items,pagination:{page,limit,total}}` inside `data`. Eligibility means an explicitly ACTIVE, nondeleted PHARMACY facility with an active, verified pharmacist/store member whose latest licence review has not been denied or left pending. There is no `network.read` dependency or inferred active status. Results have stable name/id ordering and pagination counts share a snapshot.

Creation retains `{patient_ref,icd10,tnm_stage?,insurer,drug_id,qty,pharmacy_facility_id,prescriber_id?}`. The chosen pharmacy is retained; the caller's facility is never substituted. Only a doctor may prescribe, and any supplied prescriber must match the signed-in doctor. A current medicine, eligible pharmacy, positive whole quantity, non-empty ICD-10 value (maximum 200 characters), and current insurer choice are required. ICD-10 values are trimmed and uppercased on creation and update, with no cancer-code prefix or regex restriction; this is input validation, not a registry lookup. Creation and its first event are atomic. Clinical fields are not sent by email. Prescribers can read their own prescriptions alongside their facility's dispensing records.

Prescription creation and list responses include the saved `insurer`, `pharmacy` object (`id`, `name`, `city`, `status`), and `pharmacy_name` display string; the list pharmacy also includes `state`. The existing `facility` field remains an alias of the selected pharmacy. Render the insurer from `insurer` and the pharmacy from `pharmacy.name` (or `pharmacy_name`). New prescriptions start with `auth_status: "Pending"` and `order_stage: "Waiting"`; creation does not approve authorization or create a marketplace purchase. `patient_ref` is the submitted pseudonymous reference, not a generated patient name.

## Transfers and custody

`GET /api/transfers` returns the **complete matching scoped list**, including when legacy page/limit parameters are supplied. `data` contains `items` and `total`. Supported canonical progression is `PENDING_APPROVAL -> APPROVED -> IN_TRANSIT -> DELIVERED`; legacy `PENDING` is presented as `PENDING_APPROVAL`. `COMPLETED` is not a transfer state. Rejected/cancelled records retain their recorded statuses.

Each item includes drug, quantity, unit, lot, donorFacility, recipientFacility, status, dispatchedAt, deliveredAt, and allowedActions. Missing recorded fields remain null. Actions require current `inventory.manage` access and verified facility membership: approve/reject belong to the recipient while pending, dispatch to the donor after approval, and deliver to the recipient in transit. Network read privileges do not confer custody authority. Mutations recheck state, permission, identity, medicine eligibility, expiry, units, and recipient policy.

`POST /api/transfers/:id/dispatch` and `/deliver` accept `{}` and return `data.transfer` using the same presentation. Approval already deducts the allocation from donor stock under the existing implementation. Dispatch records physical departure without deducting it again; delivery atomically adds that allocation to the recipient's matching available batch or creates a new batch. Available stock held for approval is not consumed twice. Conflicting recipient units, expiry, duplicate batches, invalid quantities or quarantine states block receipt with a conflict. Delivery does not silently make quarantined/expired stock available.

Transfer, stock, actor/timestamp, audit, and notification writes share one transaction and the existing stock-workflow advisory lock. The email subscriber sees notifications through this transaction's EntityManager; rollback leaves no email to send. Repeated successful transitions return the persisted transfer without duplicate stock, audit, or notifications. Wrong-state transitions return HTTP 409; wrong custody returns 403. Same-state handling still checks current permissions.

New transfers snapshot batch and expiry as well as units. Migration only backfills pending snapshots. **Older approved/in-transit transfers without reviewed provenance need operator reconciliation** before these endpoints can move stock. Do not guess their source batch or create completion timestamps from approval dates. The active-order timeline uses recorded transfer timestamps only.

## Reports

`POST /api/reports/export` accepts `{type,from?,to?}`. Types are exactly the values in report metadata. The response is `{success,message,data:{fileName,mimeType,contentBase64,type,csv?}}`; CSV also retains the legacy `csv` field. PDFKit and ExcelJS generate actual PDF/XLSX bytes. No fake job is returned.

Reports contain recorded inventory rows joined to current medicines and facilities, with quantity and unit kept separate. Facility sessions can export only their own stock. Network exports require both `admin.access` and `report.export`. Date filters select inventory creation dates; ISO dates and timestamps with explicit timezones are accepted, and a date-only `to` includes that whole UTC day. Reversed/invalid ranges fail with 422. Up to 10,000 rows are supported per export; narrower ranges are required beyond that. Each successful export records an audit containing format, scope, date bounds, and row count. CSV cells escape quotes and neutralize formula text; XLSX quantities retain numeric zero and missing values remain empty. Download filenames contain no user-supplied path components. Responses are private/no-store.

## Verification

Automated tests use real signed JWT requests, TypeORM repositories, and PGlite PostgreSQL storage. They cover empty metadata, bad contexts, current grants, pharmacy paging/activity, stale options, prescriber impersonation, atomic prescription events, transfer custody and state conflicts, idempotent receipt, transaction rollback, full-list scoping, real report bytes, XLSX reopening, and facility/network export boundaries. Existing team invitations remain on `POST /api/users` with their existing constrained roles, facility scoping, and email subscriber.

Before deployment acceptance, apply the migrations, provision actual business choices and reviewed permission grants, then test using real facility sessions. Separate PostgreSQL connections are still needed to verify deployment lock contention, and real Brevo credentials/delivery plus browser download behavior must be checked in that environment.
