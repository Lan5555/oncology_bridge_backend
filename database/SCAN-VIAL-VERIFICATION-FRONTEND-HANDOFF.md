# Scan Vial: medicine verification frontend handoff

## Text to send to the frontend developer

Use `data.validation.status` for the combined result badge: `VALID` or `WARNING`. Label it "Product record check". Display `validation.reason` and every entry in `validation.reasons` (`code`, `message`). `VALID` requires an exact barcode-linked openFDA label, exactly one active Greenbook registration, matching product name and manufacturer across those sources, and no detected packaging mismatch, provider data-quality issue, or expired pack/registration. Product names are compared with openFDA brand names; a generic name alone cannot establish product identity. Text matches normalize Unicode, case and whitespace only; other differences require review. Missing barcode/NAFDAC number, provider failure, ambiguous results and missing identity fields produce warnings. A NAFDAC-only check therefore produces `WARNING` for the combined check even if its registration is found.

The openFDA source is drug labeling data, not a clinical-trial or pack-authentication service. FDA `productNdcs` expose manufacturer/labeler and product codes for review. The Greenbook adapter has no equivalent NDC/GTIN field, so those codes are not equated with NAFDAC registration numbers. `registrationLookup.recordLink` reports `PRODUCT_AND_MANUFACTURER_MATCH` only when the two source identity comparisons match; inspect `crossSourceComparisons` for the evidence. This is a text-based record association, not an authoritative barcode registration or physical-pack authentication. A `VALID` result is not medical clearance or recall clearance.

Update Scan Vial to check Nigerian medicine registration through our backend, alongside the existing US label lookup. Add a field for the NAFDAC registration number printed on the package. A GS1 barcode does not reliably contain this number; do not derive it from the GTIN, lot or serial. Users can check a NAFDAC number even without a barcode.

Use authenticated `POST /api/scans/verify` for JSON requests. Submit `nafdacNumber` with optional `productName`, `manufacturer` and `strength` copied from the packaging. To include a barcode assessment, also send exactly one of `rawBarcode` or `gtin`. For a photo, use `POST /api/scans/verify-image`, multipart field `image` (JPEG/PNG, maximum 10 MB), and the same optional text fields. Remove automatic inventory submission from this screen. These verification endpoints do not create stock or scan-history records.

Display Nigerian registration results from `data.registrationLookup` separately from US label information in `data.productLookup`. Identify the Nigerian source as "NAFDAC Greenbook data via Apify (third-party service)". Show the product name, registration number, Active/Inactive registration status, manufacturer, applicant, ingredients, strength, dosage form, pack size, registration dates, source link and evidence retrieval timestamp. Registration expiry is not the medicine pack's expiry. Display missing values as unavailable.

Show each returned comparison as Match, Mismatch, Not provided or Unavailable. Comparisons are simple case/spacing-normalized exact text checks; spelling or formatting differences need review. When multiple records share a registration number, show all candidates and ask the user to compare them with the packaging. Do not automatically select one or imply they all describe the scanned barcode.

Always keep "Pack authenticity unverified" visible. A registration match, an Active status or matching label does not prove that this physical medicine is genuine or safe. `registrationLookup.barcodeLink` is `NOT_ESTABLISHED`: the returned registration has not been independently linked to the scanned GTIN. For inactive registrations, recorded registration expiry, mismatches, ambiguity or data-quality notes, prompt pharmacist/manufacturer review. No exact match is inconclusive, not a counterfeit verdict. Preserve the barcode expiry warning independently.

Show a loading state: an uncached Nigerian check may take about 50 seconds and can take up to 95 seconds. Allow roughly 110 seconds for the client request and configure hosting timeouts accordingly. Do not automatically retry; an upstream run may still be finishing after a timeout. The user may retry deliberately. Cache and availability outcomes must be displayed honestly.

Keep deliberate stock intake as a separate workflow. Never use `CLEAN`, `FLAGGED`, `gs1Verified` or the dashboard's historical `gs1AuthenticatedVials` as external authenticity evidence. The frontend calls our backend only and holds no provider tokens.

## JSON endpoint

`POST /api/scans/verify`, existing user bearer token, `Content-Type: application/json`:

```json
{
  "nafdacNumber": "A4-1234",
  "productName": "Text printed on the package",
  "manufacturer": "Manufacturer printed on the package",
  "strength": "20 mg"
}
```

This number and the text above illustrate the request only; no real product match is implied.

Optional barcode fields:

```json
{
  "nafdacNumber": "A4-1234",
  "rawBarcode": "(01)09506000134352(17)271231(10)LOT1(21)SERIAL1",
  "productName": "Text printed on the package",
  "manufacturer": "Manufacturer printed on the package",
  "strength": "20 mg",
  "brandName": "US brand name printed on the package",
  "genericName": "US generic name printed on the package"
}
```

At least one of `nafdacNumber`, `rawBarcode`, or `gtin` is required. `rawBarcode` and `gtin` cannot be combined. NAFDAC numbers are trimmed and uppercased, 2-50 characters, letters/numbers/spaces/slashes/hyphens only. Comparison strings are optional, maximum 200 characters. `productName` and `strength` are used for Nigerian comparisons, `brandName` and `genericName` for US comparisons, and `manufacturer` for both. Do not substitute an applicant/importer's name for the manufacturer.

Raw barcodes support the four GS1 AIs `(01)` GTIN, `(10)` lot, `(17)` expiry and `(21)` serial, including `]d2` and actual ASCII group separators (`\u001d` in JSON, which must decode to the actual separator rather than literal backslash text). Preserve separators between variable-length fields. Unsupported/repeated AIs and invalid values are rejected. GTIN must be a valid 14-digit value with a correct check digit; ordinary EAN/UPC numbers may be padded to GTIN-14 before submitting `gtin`. No name-based product search, GTIN-to-NDC guessing or GTIN-to-NAFDAC-number conversion occurs.

## Photo endpoint

`POST /api/scans/verify-image`, existing user bearer token, multipart:

- `image`: required JPEG/PNG GS1 DataMatrix photo, maximum 10 MB.
- Optional text fields: `nafdacNumber`, `productName`, `manufacturer`, `strength`, `brandName`, `genericName`.
- Do not send `rawBarcode` or `gtin`; the backend obtains the raw barcode from the image.

This endpoint decodes the barcode, not printed text/OCR. If a pack has no readable supported barcode, use the JSON endpoint with the typed NAFDAC number instead.

## Response contract

Successful assessments retain HTTP 201 and `{ "success": true, "message": "Medicine verification assessment completed.", "data": ... }`. Completion means the assessment finished, not that authenticity was established.

| Field | Meaning |
| --- | --- |
| `identifiers` | `{gtin, lot, serial, expiry}`; unavailable values are null |
| `checkedAt` | Server UTC timestamp after the checks |
| `validation` | `{status: "VALID" or "WARNING", scope: "PRODUCT_RECORD_CHECK", reason, reasons: [{code, message}]}`; empty reasons on VALID |
| `authenticity` | `{status: "UNVERIFIED", provider: null, reason}` |
| `productLookup` | Existing openFDA result with `status`, `source`, `market`, `sourceUrl`, `labelId`, `labelEffectiveTime`, `official` |
| `productLookup.status` | `FOUND`, `NOT_FOUND`, `UNAVAILABLE`, `AMBIGUOUS`; `NOT_REQUESTED` when no barcode/GTIN is supplied |
| `productLookup.official` | Null or arrays `brandNames`, `genericNames`, `manufacturers`, `productNdcs`, `packageNdcs`, `activeIngredients`, `storageAndHandling`, `warnings` |
| `comparisons` | Existing US label comparisons for brandName/genericName/manufacturer |
| `registrationLookup` | Nigerian registration evidence, described below |
| `expiry` | `{status: "EXPIRED" or "NOT_EXPIRED" or "UNKNOWN", source: "BARCODE", verifiedByManufacturer: false}` |
| `recall` | `{status: "NOT_CHECKED"}`; no recall clearance is implied |
| `guidance` | Next action; expiry/inactive registration/mismatch warnings where applicable |

`registrationLookup` fields:

| Field | Meaning |
| --- | --- |
| `status` | `NOT_PROVIDED`, `NOT_CONFIGURED`, `FOUND`, `NO_EXACT_MATCH`, `AMBIGUOUS`, `UNAVAILABLE` |
| `reason` | Null or explanatory text |
| `source` | `NAFDAC_GREENBOOK_VIA_APIFY` |
| `officialApi` | Always false; this is a community-maintained integration |
| `market` | `NG` |
| `registrationNumber` | Normalized requested number or null |
| `retrievedAt` | Timestamp our backend received valid results; preserved on cache hits |
| `completeness` | `NOT_GUARANTEED`; the actor may return a partial snapshot |
| `barcodeLink` | `NOT_ESTABLISHED`; no authoritative link to the scanned GTIN |
| `recordLink` | `PRODUCT_AND_MANUFACTURER_MATCH` or `NOT_ESTABLISHED`; source text association only |
| `crossSourceComparisons` | Greenbook product name/manufacturer against openFDA brand names/manufacturers, with MATCH/MISMATCH/UNAVAILABLE; empty unless both source records exist |
| `records` | All exact-number matching records; never a silently chosen first result |
| `comparisons` | Product name/manufacturer/strength comparisons, only when exactly one record is returned with status FOUND; otherwise empty |

Each record contains `productId`, `registrationNumber`, `productName`, `status` (Active/Inactive), `applicant`, `manufacturer`, `activeIngredients`, `strength`, `dosageForm`, `packSize`, `approvedAt`, `registrationExpiresAt`, `fetchedAt`, `sourceUrl`, and `dataQualityNote`. Scalar unavailable details are null; ingredients may be empty. `sourceUrl` links directly to the official Greenbook record. `fetchedAt` is the actor's evidence timestamp. Evidence older than 24 hours, implausible future timestamps, malformed records, duplicated IDs and potentially capped results are rejected as unavailable.

FOUND means one exact NRN record was returned, not proof of pack identity, active registration, or complete coverage. NO_EXACT_MATCH means no exact NRN was returned by the third-party search, not authoritative absence from NAFDAC. AMBIGUOUS means more than one record has the exact NRN. The actor uses contains searches, so the backend filters to exact registration numbers before returning evidence.

Both comparison arrays use `MATCH`, `MISMATCH`, `NOT_PROVIDED`, `UNAVAILABLE`. Text matches do not establish medicinal equivalence.

HTTP errors: 400 invalid input/image; 401 authentication; 403 existing account/facility restrictions; 413 excessive upload; 422 unsupported decoded identifiers; 429 per-user throttling. Provider lookup failures normally complete the assessment with UNAVAILABLE rather than throwing away other evidence. The existing AuthGuard applies; read assessment does not require inventory.manage. Throttling remains ten attempts/user/minute/process across both routes.

## Backend environment variables

```env
OPENFDA_API_KEY=your_openfda_key
APIFY_API_TOKEN=your_apify_api_token
APIFY_NAFDAC_ENABLED=true
```

All are backend-only. Keep the existing openFDA key. Obtain the Apify token in Apify Console under Settings > API & Integrations: https://console.apify.com/settings/integrations . Enable access to the community actor `a-g-d/ng-nafdac`: https://apify.com/a-g-d/ng-nafdac . Check its current pricing and account spending limits before enabling paid runs. Setting the flag to `false`, omitting it, or omitting the token returns NOT_CONFIGURED for requested Nigerian checks; it does not call Apify. Restart/redeploy after configuring secrets. No other provider variables or database migrations are required.

The backend calls the documented endpoint:

`POST https://api.apify.com/v2/acts/a-g-d~ng-nafdac/run-sync-get-dataset-items?timeout=90&format=json&clean=true`

It sends `Authorization: Bearer <token>` and JSON `{registrationNumber, maxItems:100, includeManufacturer:true, includeManufacturerCountry:false}`. The hostname and actor are fixed in code; clients cannot choose a destination or actor. No credentials, raw provider bodies or sensitive errors are returned or logged by this service.

Each uncached number can start a billable actor run. Matching concurrent requests are coalesced; successful results are cached for up to five minutes, failures for thirty seconds, with at most two distinct paid lookups in flight per process. No automatic retries occur. API timeout/cancellation may leave an upstream run active; check Apify Console before manually repeating uncertain requests. Cache, concurrency and throttling are per-process; use a shared limiter/cache for aggregate control across replicas. Set account spending limits in Apify. The current transport waits up to 95 seconds; hosting/proxy/frontend timeouts must allow this, or a future asynchronous job flow is needed.

## References and remaining acceptance checks

- Actor input/output, coverage, pricing and partial-snapshot limitations: https://apify.com/a-g-d/ng-nafdac
- Public OpenAPI definition: https://apify.com/a-g-d/ng-nafdac/api/openapi
- Apify synchronous run API: https://docs.apify.com/api/v2/actor-run-sync-get-dataset-items-post
- Official registration search: https://greenbook.nafdac.gov.ng/
- openFDA label API: https://open.fda.gov/apis/drug/label/
- openFDA key registration: https://open.fda.gov/apis/authentication/

No live paid run is performed as part of local automated validation. After configuration, verify a known real NRN, shared-number ambiguity, comparison mismatches, expired/inactive registration evidence, provider failure and a real barcode photo through the deployed authenticated endpoints. Check current actor behavior, completeness, evidence freshness, latency and billing before production rollout.

Sproxil/PharmaSecure individual-pack authentication remains pending partner access. Neither this registration check nor openFDA proves physical pack authenticity, chemical composition, storage history or patient suitability. Existing stock-intake endpoints and historical scan records retain their previous behavior.
