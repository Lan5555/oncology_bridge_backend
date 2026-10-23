# Purchase orders

Apply `purchase-orders.sql` after `marketplace.sql`, `facility-registration.sql` (including structured audit columns), and `email-service.sql`, before deploying this code. The app uses `synchronize: false`. The migration is transactional and intended to run once. It validates existing checkout money; investigate any invalid historical amounts rather than modifying financial snapshots to make it pass.

Grant `admin.access` and `order.read` to authorized network administrator roles; add `order.manage` only for fulfillment operators. These permissions are assignable through the existing roles API. The migration does not grant privileges automatically. Facility administrators do not receive network scope, even with these grants. Network roles use the existing network-wide scope and MFA guard; there is no facility-scoped order administrator role in this implementation.

## API

All five routes use the existing bearer access token. Buyer ownership comes from the token. `GET /api/orders` and `GET /api/orders/:orderId` only return the caller's marketplace purchases. Other buyers' IDs return 404. `GET /admin/api/orders` and `GET /admin/api/orders/:orderId` require network admin access and `order.read`. `PATCH /admin/api/orders/:orderId/fulfillment` requires network admin access and `order.manage`.

Lists accept `page=1`, `limit=20` (maximum 100), `q`, `status`, and `paymentStatus`. Empty search/status filters are omitted. Unknown parameters, including buyer IDs, are rejected. Search is case-insensitive and literal; filters combine with AND. Ordering is `created_at DESC, id DESC`, with a repeatable-read count/page. Responses use `{success,message,data}`, nested `pagination`, and integer minor units. Details include one immutable checkout line, version, delivery fields, chronological append-only events, and server-computed transitions. Buyer responses always have no transitions.

Verified professional buyers receive `pg-orders` in `allowed_pages`. Existing sessions should refresh their authenticated user metadata after deployment. Browser polling and draft preservation remain the frontend's responsibility.

## Checkout and payment

The existing `/api/marketplace/checkout` request and redirect behavior are preserved. Its response adds `orderReference` beside `orderId` and `authorizationUrl`. The same buyer/idempotency key and payload reuse the order and provider reference; changed payloads return 409. Listing eligibility, prescription authorization (when needed), NGN pricing, reservations, and one-time stock consumption remain server-controlled.

Paystack verification checks the persisted reference, amount, and currency before updating payment. Browser redirects never mark orders paid. A verified successful reserved purchase becomes `CONFIRMED`/`PAID`. Fulfillment moves `CONFIRMED → PROCESSING → SHIPPED → DELIVERED`; each change needs the current version, a customer-visible note, and current paid/consumed eligibility. Shipping additionally requires actual carrier/tracking values. Delivery uses server time. Changes atomically increment the version and append timeline/audit events; confirmation, shipping, and delivery enqueue emails through the shared encrypted outbox in the same transaction. Unique event keys and locked order rows prevent duplicate notification effects. Email delivery follows the existing `EMAIL_ENABLED` setting.

No manual cancellation is offered, either before payment (possible in-flight payment) or after payment (no compensation/refund implementation). Expired reservations and authoritative unsuccessful payments automatically release stock and cancel fulfillment. Expiry alone leaves the public payment status `PENDING`; it does not assert failure or refund. A late successful payment with released stock is recorded as paid but stays cancelled, cannot be fulfilled, and has a customer-visible payment-resolution event. Operators must resolve it outside this API; no refund is claimed. Existing `PAYMENT_REVIEW_REQUIRED` holds also block fulfillment. Seller payouts, a refund API, prescription-only invoices, and stock redistribution are not mapped into these purchase orders.

Historical marketplace orders use their original item/seller/price snapshots. Previously captured buyer snapshots, tracking details, and events cannot be reconstructed: missing buyer names are empty strings, facility/delivery data is null, historical delivery fees are null, and no historical events are fabricated. New checkouts snapshot buyer/facility names and explicitly record the current zero delivery charge. Historical paid/consumed orders are migrated to CONFIRMED; review holds remain ineligible.

## Validation

`marketplace.service.spec.ts` exercises checkout, the migration and PostgreSQL constraints/triggers, real HTTP bearer-token guards, ownership, filtering, permission revocation, fulfillment version conflicts, transactional rollback, duplicate payment effects, and late-payment review using PGlite and mocked providers. Separate-connection PostgreSQL lock contention and a live Paystack test-mode checkout/webhook must still be verified in the deployment environment. Tests do not contact providers or load `.env` files.
