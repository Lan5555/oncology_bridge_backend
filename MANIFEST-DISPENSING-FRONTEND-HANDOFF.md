# Pharmacy manifests and GS1 dispensing

This workflow uses the pharmacy's uploaded manifest as the comparison source. It does not call openFDA or NAFDAC. Existing product-record verification and inventory intake endpoints remain available; they do not perform this dispensing check.

## Deployment

Apply `database/pharmacy-manifests.sql` before deploying this backend. The script creates manifest, serialized-pack and dispensing-event tables. No production database migration has been run as part of this source change.

All routes require the existing authenticated user session and active, verified facility membership with `inventory.manage`. The backend derives the facility from the authenticated user; do not submit a facility ID. Manifests are visible only within that facility. Duplicate dispensing checks cover all facilities using this database without exposing another facility's records.

## Upload a manifest

`POST /api/manifests` accepts JSON. Alternatively, `POST /api/manifests/upload` accepts multipart field `manifest` containing the same JSON as a file (maximum 1 MiB). CSV, Excel and PDF files are not accepted by these endpoints.

Pharmacy staff can continue to use manual entry and the frontend CSV editor. Native CSV/.xlsx upload uses the separate preview endpoint below; saving reviewed rows still uses `POST /api/manifests`.

### Spreadsheet templates and preview

`GET /api/manifests/import/template?format=xlsx` downloads a blank Excel template. Use `format=csv` for a CSV template. Both contain instructions and the user-facing columns **Barcode (GTIN)**, **Batch number**, **Serial number**, and **Expiry date**, with no sample pack rows. Excel identifier columns are formatted as Text; instructions are attached to the header cells. The CSV carries instructions as an initial `# ` comment record.

`POST /api/manifests/import/preview` accepts multipart `file` (UTF-8 CSV or .xlsx, at most 5 MiB) and `reference` (1–120 characters). Submit no facility ID. It returns HTTP 200 with `{ success: true, message: "Delivery spreadsheet reviewed.", data: { reference, canImport, totalRows, validRows, packs, issues } }` for a readable spreadsheet, including one that contains validation issues. This operation saves nothing.

Header names accept the four template labels or `gtin`, `lot`, `serial`, `expiry`, in any order and without case sensitivity. Identifier content remains unchanged. Numeric Excel identifiers, formulas (including cached results), ambiguous date text, duplicate/missing/extra columns, missing serials and batch-only lists cannot be imported. Spreadsheet date text must be ISO `YYYY-MM-DD`; actual Excel date cells use the workbook's declared 1900/1904 date system. Excel's fictitious 1900-02-29 is rejected. CSV numeric-looking identifiers remain text; scientific notation is rejected because lost digits cannot be recovered.

Only one nonempty worksheet is accepted, including hidden worksheets in that check. Blank sheets are allowed. To keep parsing bounded, imports allow at most 256 ZIP entries, 16 MiB total expanded data, 8 MiB per entry, 12,000 worksheet cells, 10,000 physical rows and 32 columns. ZIP64/encrypted files, macros, embedded objects, merged cells and named ranges require a simpler delivery-only workbook. These limits are checked before ExcelJS loads the workbook. The delivery itself may contain at most 1,000 nonempty pack rows; larger readable lists return `ROW_LIMIT_EXCEEDED` and cannot import.

`issues` contains `{ row, field, code, message }` entries. Preview row numbers are physical file/worksheet rows including the header (and CSV instruction lines); `row: 0` identifies a delivery-level issue such as an existing reference or row limit. `validRows` counts reviewed pack rows with no row issues; column errors make it zero. A delivery-level issue can prevent import even when all reviewed pack rows are valid. For over-limit lists, only the first 1,000 pack rows are reviewed, while `totalRows` counts every nonempty pack row within the file parsing limits.

`packs` contains all normalized `{ gtin, lot, serial, expiry }` rows only when `canImport` is true, with no extra fields. Otherwise it is empty. Never offer a partial import. For a valid preview, `issues` is empty and `validRows === totalRows`.

Issue codes include `COLUMN_REQUIRED`, `COLUMN_AMBIGUOUS`, `COLUMN_UNEXPECTED`, `IDENTIFIER_MUST_BE_TEXT`, `FORMULA_NOT_ALLOWED`, `INVALID_GTIN`, `BATCH_REQUIRED`, `SERIAL_REQUIRED`, `INVALID_EXPIRY`, `DUPLICATE_PACK_IN_FILE`, `PACK_ALREADY_IMPORTED`, `REFERENCE_ALREADY_EXISTS`, and `ROW_LIMIT_EXCEEDED`. Reference and existing-pack checks use only the authenticated pharmacy's records.

Unreadable/malformed files return 400; oversize uploads return 413; unsupported formats return 415; authentication/authorization retain 401/403. PDF/OCR and older .xls files are unsupported. Errors contain actionable messages without SQL, stack traces or other pharmacies' details.

### Save reviewed deliveries and handle uncertainty

After preview and correction, send the entire reviewed delivery to the existing `POST /api/manifests`. Successful responses retain `data.id`, `data.reference`, and `data.packCount`. Save revalidates permissions, all pack fields, duplicate identities and existing conflicts within the transaction. Concurrent saves at the same pharmacy are serialized, and database uniqueness constraints remain in force. Preview is advisory and reserves no packs or reference.

Creation errors now include `data.issues` for invalid requests (400) and conflicts (409), retaining the existing `{ success: false, message, data }` envelope and status semantics. For manually submitted rows, row 1 is the first pack card; map spreadsheet row numbers in the frontend before saving. Unknown fields, including a submitted facility ID, are rejected.

On a network/timeout uncertainty, check `GET /api/manifests?reference=<URL-encoded-reference>` before retrying. It returns the existing list shape with exact-reference matches only at the authenticated pharmacy; zero matches means none were found at the time of that read. A timeout does not prove rollback, and a still-running save can complete later. A retry that conflicts must reconcile with the saved delivery rather than claim the earlier save failed.

Spreadsheet preview and template routes do not call product-record verification, change inventory, or create dispensing events. Existing dispensing UUID/replay and duplicate checks are unchanged.

```json
{
  "reference": "PHARMACY-DELIVERY-2026-001",
  "packs": [
    {
      "gtin": "09506000134352",
      "lot": "BATCH-A",
      "serial": "VIAL-0001",
      "expiry": "2027-12-31"
    }
  ]
}
```

Use actual pharmacy data; the values above are examples. Each row represents exactly one serialized pack/vial. A batch-only manifest cannot support vial-level matching and is rejected. There is no quantity field. Keep GTINs and serials as strings, including leading zeros and letter case. GTIN must be 14 digits with a valid check digit. Batch and serial must contain 1–20 printable characters without spaces. Expiry accepts an ISO date or GS1 YYMMDD (day 00 means month end). Import supports 1–1000 rows and is atomic.

Duplicate GTIN+serial pairs within a file return 400. A previously uploaded reference or pack identity at the same pharmacy returns 409 and saves no rows. Different pharmacies may upload the same identity, for example after a transfer; the dispensing identity is still unique across the database. Upload does not confirm the pharmacy's source data is authentic.

`GET /api/manifests` returns the latest 100 manifests at the user's facility. `GET /api/manifests/:id` returns the manifest and its packs. Display the manifest reference to users rather than asking them to type IDs.

## Scan and preview

Hardware or browser scanners should submit the complete decoded barcode string, preserving ASCII group separator `\u001d`. Supported identifiers are AI 01 (GTIN), 10 (lot), 17 (expiry), and 21 (serial), all required for this workflow. GS1 element strings and parenthesized human-readable forms are supported. Unknown or repeated identifiers and malformed values are rejected; unsupported formats require review.

For a JPEG/PNG photo, use existing `POST /api/scans/decode`, multipart `image` with its existing required `facilityId`, `clientUuid`, `clientTs`, and `action=NEW` fields. This route checks the supplied facility against the authenticated user's membership. Its `data.rawBarcode` can be used below. Decode alone creates no stock or dispensing event.

`POST /api/scans/manifest-check`:

```json
{ "rawBarcode": "(01)09506000134352(17)271231(10)BATCH-A(21)VIAL-0001" }
```

The response envelope is `{ success, message, data }`. Read the decision from `data.canDispense`. The assessment contains:

- `identifiers`: interpreted GTIN, lot, serial and ISO expiry.
- `manifestId`, `manifestMatch`: `MATCH`, `NOT_FOUND`, or `MISMATCH`.
- `mismatches`: field names (`lot`, `expiry`) that differ from the manifest.
- `duplicate`, `suspectedCounterfeit`: true when GTIN+serial has already been accepted for dispensing.
- `reasons`: any of `PACK_NOT_IN_MANIFEST`, `MANIFEST_MISMATCH`, `PACK_EXPIRED`, `SERIAL_ALREADY_DISPENSED`.
- `authenticity`: always `UNVERIFIED`.

Preview is read-only. Repeated previews do not consume the pack or create duplicate alerts. A preview is advisory: another request may dispense the pack before confirmation.

## Confirm dispensing

`POST /api/scans/dispense`:

```json
{
  "rawBarcode": "(01)09506000134352(17)271231(10)BATCH-A(21)VIAL-0001",
  "clientUuid": "bd9d8d89-e680-4981-a0e0-5a7719272a36"
}
```

Generate one UUID for each intentional dispensing operation. Persist it with the exact body before sending. If the response is lost, retry with the same UUID/body. A replay returns the original stored assessment, the same event `id`, and `replay: true`; it does not create another dispensing or alert. A different body or user with the same facility-scoped UUID returns 409. After resolving a blocked attempt (such as uploading a missing manifest), use a new UUID to request a fresh assessment.

Dispensing rechecks the manifest, expiry and prior dispensing inside a transaction. Requests for the same GTIN+serial are serialized across facilities. A database unique index additionally allows only one accepted dispensing event for that identity. Accepted and blocked attempts, and their audit records, commit together. A different UUID for an already accepted pack is blocked with `SERIAL_ALREADY_DISPENSED`, `duplicate: true`, and `suspectedCounterfeit: true`.

HTTP 201 with `success: true` means the assessment was recorded, including a blocked assessment. It does **not** mean dispensing was allowed. Continue only when `data.canDispense === true`. On a replay, show that the existing operation was already recorded; do not trigger a second physical handoff.

Display duplicate alerts as **“Suspected duplicate pack — dispensing blocked. Review with the pharmacist.”** Matching data does not prove physical authenticity, and a repeated attempt could be the same vial scanned again. The system cannot identify two physical vials from identical barcode contents alone, or identify which pack is fake. Serial reuse across different GTINs is not a duplicate identity. Expired, missing and mismatched records must also block dispensing but are not by themselves counterfeit findings.

These endpoints record a pack's dispensing identity and block its reuse. They do not decrement inventory, issue a prescription, verify manufacturer serial issuance, support returns/reversals, or import legacy scan history as dispensed packs. The frontend must call this endpoint at the point of dispensing to enforce this workflow. Physical camera behavior and separate-connection PostgreSQL contention still need deployment testing.
