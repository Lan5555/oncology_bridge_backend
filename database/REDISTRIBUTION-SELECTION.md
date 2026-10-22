# Redistribution request selection

Deploy [redistribution-selection.sql](redistribution-selection.sql) after the existing marketplace and inventory-access migrations, before starting this backend. It records the selling unit on transfer requests and backfills reviewed units for existing pending requests. Historical approved transfers retain an unknown unit where none was recorded. Legacy requests with an unreviewed unit must be corrected or replaced before approval. No payload or role migration is required; transfer operations use the existing `inventory.manage` permission and active, verified facility membership, including individual stock grants.

## Named batch selection

`GET /api/inventory?page=1&limit=100` returns `{ success, data: { items, total, page, limit } }`. Facility members can read only their facility's inventory. The existing authorized network-admin list remains network-wide unless filtered by `facilityId`; network read access does not grant permission to transfer another facility's stock.

Rows include stable `id`, `medicine_id`, `medicine.generic_name`, `drug`, `batch_number`/`batchNumber`/`lot`, physical `quantity`/`qty`, `availableQuantity`, `unit`, `expiry_date`/`expiry`, `status`, and medicine deletion/availability fields. Use `availableQuantity` for the request quantity maximum; it subtracts pending requests (`PENDING` and `PENDING_APPROVAL`) and unexpired marketplace reservations. Physical `quantity` remains unchanged until approval. Pending requests are soft allocations, so later marketplace or stock changes can still prevent approval.

Load additional pages using `page`, `limit` and `total`. Display the medicine name, batch, available count, reviewed unit and expiry. The existing UI presentation filter should omit explicitly unavailable/deleted medicines, missing named batches, nonpositive available quantities, expired batches and quarantined/disposed stock. Do not remove the entire inventory list's historical or quarantine support just for this picker. Submission remains authoritative.

## Recipient selection

`GET /api/transfers/suggest?inventoryItemId=<uuid>` requires permission to manage the selected stock at the caller's facility. A successful response is `{ success: true, data: [...] }`:

```json
{
  "id": "recipient-facility-uuid",
  "facilityId": "recipient-facility-uuid",
  "name": "Recipient facility",
  "city": "Ikeja",
  "distanceKm": 12.4
}
```

The current backend policy permits active, nondeleted, named recipients within 80 km of the donor, using valid coordinates for both facilities. The donor is excluded. Missing or invalid coordinates make a recipient ineligible; creation cannot bypass this rule by posting its ID directly. Suggestions are sorted by distance, then stable ID. Only display-safe facility identity/location summaries are returned. An empty array is a successful result with no eligible recipients. Invalid IDs return 400; denied access returns 403 or an ownership-safe 404. Ineligible/unavailable batches return an error, not fabricated suggestions.

The UI must use the backend suggestions rather than the network directory or a locally assumed radius. It may normalize a direct array or arrays under `recipients`, `suggestions`, `facilities`, `items` or `data`; entries may use `id`/`facilityId` or a nested `facility`. Missing valid identity/name data is an error. Preserve empty arrays as empty results.

## Submission and approval

`POST /api/transfers` keeps exactly `{ inventoryItemId, recipientFacilityId, quantity }`. Quantity must be a positive whole number in the selected batch's reviewed unit; the client cannot supply or override that unit. The backend checks current management grants and verified membership, donor ownership/status, recipient eligibility, linked nondeleted medicine, available stock status, expiry and remaining quantity in one transaction. Batches expiring on or before the database's current date are ineligible. Requests share the marketplace workflow lock and lock the stock row before reading allocations, preventing concurrent requests from over-admitting that stock.

Approval is available only to an authorized member of the recipient facility. It rechecks eligibility, batch/medicine/facility identity, the saved unit, expiry and current availability. Stock consumption and recording the decision commit together. Rejection remains possible if the medicine or stock became ineligible. Repeated decisions cannot consume stock twice. Approval records the real reviewer and leaves the status as `APPROVED`; it does not imply delivery or completion.

Pending requests can have their quantity edited only by the donor with the same live stock checks. Changing batch or recipient requires a new request. Approved requests cannot be edited or deleted through these endpoints.

## Frontend and deployment acceptance

This repository contains the backend. The consuming dialog must clear the selected recipient on a batch change, request fresh suggestions, and ignore responses for earlier batches (abort the prior request or compare request IDs). Failures must show retry and block submission; an empty result must show no eligible recipients. Successful creation closes the form and refreshes the existing list. Approve/reject success should refresh the list and available inventory. Always display backend delivery/completion status.

Automated checks exercise real TypeORM repositories and PostgreSQL queries through PGlite, signed JWT facility sessions, named paginated inventory, denied/empty suggestions, recipient policy, concurrent admission, reservation accounting, changed stock/unit/expiry, permission revocation, approval identity and rollback. PGlite serializes transactions, so deployment acceptance still needs separate real PostgreSQL connections and actual facility accounts. Validate named batch selection, later pages, stale suggestion handling, empty/denied responses, whole quantity limits, submission/list refresh and approval refresh in the frontend. Never test by transferring live clinical stock without an appropriate test facility/batch.
