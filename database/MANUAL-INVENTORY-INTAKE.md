# Manual inventory intake

Deploy this backend before testing the medicine dropdown intake UI. No schema migration is required beyond the existing inventory foreign key, audit logs, catalogue ownership, soft-delete and marketplace migrations (including selling_unit).

POST /api/inventory requires an authenticated, active, verified member of an active facility with inventory.manage (including an explicit individual stock grant). The service rechecks membership and permission inside the creation transaction. Facility ownership comes from that membership; supplied facilityId and hospitalId must both match it.

Required fields: medicineId (UUID), batchNumber (trimmed, nonblank, at most 200 characters), expiry (valid YYYY-MM-DD), quantity (positive integer), unit (vial/pack/bottle/box). Optional fields: facilityId, hospitalId, serial_number. sellingUnit remains a compatibility alias for unit; conflicting aliases are rejected. A unit is required for new manual intake. Typed drug names and drugId are rejected by the intake DTO. Intake neither creates nor edits medicines. Scanning retains its existing contract; scanned/legacy batches without a reviewed selling unit cannot be listed.

A selectable medicine is not soft-deleted and is either owned by the current facility or already referenced by its inventory. This preserves the existing catalogue visibility policy, including for shared records. Intake applies the same predicate independently of dropdown selection; unknown, deleted and inaccessible IDs return HTTP 404. Medicine activity is represented by deleted_at; there is no separate active flag. Selection does not grant catalogue editing permissions.

GET /api/medicines returns success/data with items, total, page and limit, including id, generic_name, brand_name, strength, dosage_form and gtin. Operational page limits are capped at 100 and the response reports the effective limit. The UI must load further pages when total exceeds items returned.

Manual duplicate policy: the same facility + exact medicine ID + trimmed batch number returns HTTP 409, regardless of expiry or status. No quantity is added. Concurrent manual submissions serialize on the owning facility row. Batch matching is case sensitive. Different medicine IDs may use the same batch number. Existing duplicate/history rows are preserved. The scan intake pathway remains separate and can intentionally increment a batch.

Creation saves the selected medicine foreign key and an INVENTORY_CREATED audit entry atomically. The audit includes actor, facility, medicine, inventory record ID and batch number. Creation and list responses include linked medicine details plus compatible drug, gtin, lot/batchNumber, qty/quantity, unit, expiry and facility fields. Errors use the global success:false/message/data envelope.

Older rows with no resolvable medicine link remain in inventory lists with medicine:null and linkageStatus:UNLINKED. Their names are never guessed, no history is rewritten, and they are unavailable as a medicine selection. Correct historical links only through an explicit review with a known medicine ID.

Verification: focused tests use PostgreSQL via PGlite with repository adapters to verify stored foreign keys, audit entries, refresh/list queries, same-name brands and strengths, visibility, permission/membership, facility scope, duplicates and invalid input. Existing HTTP operational-read tests verify catalogue pagination, selectable fields and authentication. A deployed UI/database end-to-end check remains part of deployment.

## Selling unit review

Quantity is a count of the recorded unit. A batch with quantity 10 and unit box holds ten boxes; a listing price of 2500 refers to one box. No vial defaults, pack-size inference, or quantity conversions are performed.

For manual intake, an explicit supported unit saved by a verified facility member with inventory.manage is the staff unit review. Creation audits record the unit, quantity and reviewing actor. Marketplace listing permission remains separate.

To review a legacy batch, authorized staff submit PATCH /api/inventory/:id with {"unit":"box"}. This keeps the existing quantity unchanged and records an INVENTORY_UNIT_REVIEWED audit event with actor, facility, batch ID, previous/new unit and quantity. Confirm the physical count in that unit; if correcting the count is necessary, explicitly supply quantity too. Unit updates recheck membership and inventory.manage inside the transaction. Missing/unsupported units remain unlistable; no value is backfilled automatically.

Inventory creation, detail, update and list responses return unit from persisted selling_unit. List pagination/envelopes remain unchanged. Marketplace validates the submitted unit against that supported reviewed value, and both availableQuantity and unitPriceNaira use it. Listed batch units cannot be changed (HTTP 409), preserving existing listing and order meaning.

The PostgreSQL tests cover box intake, mismatched-unit rejection, a listing priced per box, persisted inventory and marketplace refresh reads, explicit legacy review with unchanged quantity, missing permission, foreign facility scope, invalid/conflicting unit aliases and listed-unit protection.

Medicine deletion now removes linked batches from active queries without deleting physical stock or traceability. See MEDICINE-DELETION.md and apply medicine-deletion.sql before deploying that change. Authorized inventory history is available with includeDeletedMedicines=true and includes explicit medicine deletion flags.

Inventory responses include medicine.storage_temperature verbatim from the linked catalogue medicine, including any approved Unicode, whitespace and line breaks. Missing/blank requirements are not replaced with sensor readings, generic defaults or stock notes. The listing modal submits this text unchanged; the server independently compares storage to the current approved medicine value and returns an actionable 422 if the requirement is absent or differs. Listing storage is persisted without trimming the approved text.
