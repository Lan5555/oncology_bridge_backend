# Network operational reads

Apply `admin-operational-reads.sql` after the existing facility, GS1, Oncosourz, cold-chain hardening, marketplace and inventory-access migrations. It grants the operational read permissions to existing `ADMIN` and `SUPERADMIN` roles and extends listing publication states to DRAFT and WITHDRAWN. Existing `admin.access` and configured network MFA checks still apply. Mutation grants and seller eligibility do not change. This migration has not been applied to a live database by Codex.

| GET endpoint                      | Permission          |
| --------------------------------- | ------------------- |
| `/api/medicines`                  | `medicine.read`     |
| `/api/inventory`                  | `inventory.read`    |
| `/admin/api/marketplace/listings` | `marketplace.read`  |
| `/api/prescriptions`              | `prescription.read` |
| `/api/invoices`                   | `invoice.read`      |
| `/api/transfers`                  | `transfer.read`     |
| `/api/scans`                      | `scan.read`         |
| `/api/storage-units`              | `coldchain.read`    |
| `/api/cold-chain-events`          | `coldchain.read`    |
| `/api/expiry?withinDays=60`       | `inventory.read`    |
| `/api/network`                    | `network.read`      |
| `/api/research/inquiries`         | `research.read`     |

Send the intended session's JWT in `Authorization: Bearer ...`. These endpoints never choose a session from cookies or from a client-supplied facility claim. Both authentication and list scope are checked against current database account state. Network operators remain network-wide even if their account is linked to a facility. A facility filter is optional for network operators; a different facility ID from a facility session is rejected with 403. Inactive or unverified facility membership cannot use the operational lists.

All endpoints accept `page` (default 1), `limit` (default 25, maximum 100) and `q` (maximum 200 characters). Search and resource filters apply before counting/paging; ordering has an ID tie-breaker and count/page share a repeatable-read transaction. The response is `{success:true,message:"",data:{items,total,page,limit}}`. Out-of-range pages return an empty `items` array with the filtered total intact. Invalid pagination is 400, denied reads are 403, and unavailable database schemas or connectivity produce an explicit 503 response. Missing grants do not produce empty success.

Existing inventory category, prescription tab, transfer status, cold-chain unit/status/time-range, and expiry-window filters are supported. Listing `status` can filter any publication state. No publication, seller-verification, expiry, or stock-eligibility filter is imposed on the admin marketplace list. The buyer marketplace route keeps its existing restrictions. Admin list details include seller/facility, current inventory reference, price, and ordered HTTPS image links.

Facility sessions receive only their scoped inventory, scans, storage, cold-chain events, prescriptions, invoices and redistribution records. Redistribution includes incoming and outgoing records. Invoice reads include the seller facility's records and marketplace invoices purchased by members of the viewing facility. Catalogue visibility includes records owned by the facility or referenced by its stock; shared GTIN lookup remains available through the existing lookup routes. Directory reads return the viewing facility alone. The admin marketplace list and research inquiry list are network-only. Public inquiry submission remains unchanged.

Invoices combine legacy invoices and marketplace order invoices using a `source` discriminator. No payment initialization, verification, or stock mutation is performed by these collection GETs. Fields are selected explicitly: no password hashes, access/refresh tokens, device keys, Cloudinary credentials, buyer contact information, prescription patient names, or raw payment authorization links are returned. Prescriptions use pseudonymous `patient_ref` and opaque order identifiers. Research inquiry contact fields are restricted to `research.read` operators. Record details can be rendered from the returned item without a separate detail request.

Login/refresh and `/api/me` expose newly assigned role permissions through the existing authenticated-user response. Refresh the admin session after migration or grant changes so navigation reloads its claims; server authorization checks current grants on each request.

Run `npm test -- --runInBand` and `npm run build`. The operational API tests mount the actual controllers, authentication/permission guards, real signed JWTs and raw PostgreSQL queries against an isolated embedded PostgreSQL instance. They simulate an admin bearer with a facility cookie and the inverse, exercise two-facility data on every view, search before paging, empty pages, denied/missing bearer tokens, SUPERADMIN, MFA, all listing publication states, image details, credential exclusion and unavailable lists. This does not replace the final browser check against the separately deployed frontend: sign in to both sessions, inspect the adminSession bearer header in every operational view, and check empty/denied/error states and the record-details dialog. No connected browser was available for the frontend sign-in check, and no live migration was applied.
