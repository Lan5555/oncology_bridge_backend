# Bulk medicine creation

Add a **Bulk add medicines** action beside the existing single medicine creation form.
Use the existing authenticated API client and session for the current portal.

## Endpoint

`POST /api/medicines/bulk` (legacy alias: `POST /medicine/bulk`).
Send `Authorization: Bearer <access token>` and `Content-Type: application/json`.
The existing medicine catalogue guards apply: active verified facility members need
`medicine.create` or `inventory.manage`; network administrators need `admin.access`,
`medicine.create`, and the existing network admin session/MFA checks.
Ownership comes from the authenticated actor; do not send facility IDs or ownership fields.

## Request

```json
{
  "medicines": [
    {
      "gtin": "12345678901231",
      "generic_name": "Medicine generic name",
      "brand_name": "Medicine brand name",
      "manufacturer": "Manufacturer name",
      "strength": "10 mg",
      "dosage_form": "Tablet",
      "storage_temperature": "Use the approved product storage wording"
    }
  ]
}
```

The example values are illustrative; submit user-entered product data.
Send 1–100 medicines per request. All seven fields are required strings and must
contain non-whitespace text. GTIN must be a string of 14 digits with the correct
check digit: preserve leading zeros. Extra fields are rejected, including
`facilityId`, `catalog_facility_id`, `id`, quantities, batch numbers, or expiry dates.
This endpoint creates catalogue records; stock intake remains a separate workflow
using each returned medicine `id` as `medicineId`.

## Success: HTTP 201

```ts
type BulkMedicineResponse = {
  success: true;
  message: "Medicines created";
  data: {
    count: number;
    medicines: Array<{
      id: string;
      gtin: string;
      generic_name: string;
      brand_name: string;
      manufacturer: string;
      strength: string;
      dosage_form: string;
      storage_temperature: string;
      prescription_required: boolean;
      catalog_facility_id: string | null;
      created_at: string;
      deleted_at: null;
    }>;
  };
};
```

The returned medicines follow input order. Show `data.count` as the number created,
then refresh the catalogue and medicine selectors from the API.

## Errors and UI behavior

The entire request is atomic: any error means zero rows from that request are created.
Never silently skip duplicates, overwrite existing products, or clear failed input.

- **400:** malformed body, invalid row, blank field, invalid GTIN, duplicate GTIN
  within the request, or batch outside 1–100. Nested DTO validation messages name
  paths such as `medicines.0.brand_name`; business validation also returns structured
  `data.errors` as shown below.
- **401/403:** use the existing sign-in/access-denied flow. Keep the entered rows.
- **409:** a GTIN already exists, including a deleted catalogue record, or another
  request created it concurrently. Existing conflicts provide indexed errors;
  concurrent conflicts may provide only a message. Refresh/reconcile before retrying.
- **Other/network errors:** keep the rows and display the API error. If the response
  was lost, refresh/reconcile the catalogue before retrying: the first request may
  have committed. There is no idempotency-key contract for this endpoint.

Example structured error:

```json
{
  "success": false,
  "message": "Bulk medicine validation failed",
  "data": {
    "errors": [
      { "index": 1, "field": "gtin", "message": "Duplicate GTIN in this request" }
    ]
  },
  "code": "HTTP_400"
}
```

Indexes are zero-based; display `index + 1` as the row number. Always handle a
message-only error as well. Let users add/remove rows and review them before
submitting. Disable duplicate submissions while saving. If CSV/Excel import is
added, parse it in the frontend into this JSON shape and preserve GTINs as strings;
the API accepts JSON, not uploaded files. Do not automatically split a larger
import and imply it is atomic: separate requests commit independently.

No new database migration is required. Local implementation and tests do not
establish deployed endpoint availability.
