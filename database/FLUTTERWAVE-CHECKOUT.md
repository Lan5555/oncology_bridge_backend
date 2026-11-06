# Flutterwave alongside Paystack

Scope: authenticated marketplace checkout. Existing clients default to PAYSTACK. Legacy prescription invoices are unchanged. Hosted checkout uses Flutterwave Standard v3; no frontend payment SDK or public key is required. This does not add seller payout/split settlement.

## Deployment

Apply database/marketplace-payment-providers.sql after marketplace.sql (and retain existing purchase-orders.sql deployment requirements), before deploying this code. Existing orders are backfilled as PAYSTACK. Do not modify the original marketplace migration.

Configure backend-only FLUTTERWAVE_SECRET_KEY and FLUTTERWAVE_SECRET_HASH through your deployment secret manager. Use the same secret hash in the Flutterwave v3 dashboard webhook settings. FRONTEND_ORIGIN must be HTTPS and included in CORS_ORIGIN. No secrets were read or changed during implementation.

Webhook: POST <backend>/api/payments/flutterwave/webhook. This v3 endpoint authenticates the verif-hash header, handles charge.completed, then verifies the stored tx_ref directly with Flutterwave. Do not configure the v4 HMAC webhook format for this endpoint. Keep the existing Paystack webhook and credentials. Configure and test test/live environments separately.

## Frontend implementation text

Add a payment-provider selector with labels Paystack and Flutterwave and values PAYSTACK and FLUTTERWAVE. Keep Paystack selected by default. On checkout submit:

POST /api/marketplace/checkout
Authorization: Bearer <buyer token>
Idempotency-Key: <UUID for this checkout attempt>
Content-Type: application/json

{
  "listingId": "<selected listing UUID>",
  "quantity": 2,
  "prescriptionId": "<approved prescription UUID, omit when not needed>",
  "paymentProvider": "FLUTTERWAVE"
}

Do not send amounts, currency, email, callback URL or provider transaction IDs. The backend derives these. Provider values are case-sensitive. Omitting paymentProvider retains Paystack behavior.

HTTP 200 response envelope:

{
  "success": true,
  "message": "Checkout ready.",
  "data": {
    "paymentProvider": "FLUTTERWAVE",
    "authorizationUrl": "<HTTPS hosted checkout URL>",
    "reference": "<provider payment reference>",
    "invoiceReference": "<OB invoice reference>",
    "orderId": "<order UUID>",
    "orderReference": "<same invoice reference>",
    "totalNaira": 2500.50,
    "expiresAt": "<ISO timestamp>"
  }
}

Save invoiceReference and orderId before navigating to data.authorizationUrl. Use the same authorizationUrl field for either provider. Preserve the same UUID and exact body for network/502 retries; disable duplicate submission. A key reused with different details/provider returns 409 IDEMPOTENCY_CONFLICT. Never silently switch gateways after an uncertain initialization. To change provider, wait for the previous reservation to expire and explicitly start a new attempt with a new UUID; do not pay an older checkout afterward.

Both providers redirect to /pay/<invoiceReference>. Flutterwave appends status, tx_ref and transaction_id. Treat these parameters as informational only. On that route, retain the buyer session and GET /api/invoices/<invoiceReference> with the buyer bearer token. This endpoint returns a direct object (no data envelope) and triggers backend verification. Use the invoiceReference from the path, not tx_ref, for the invoice request.

Marketplace invoice fields:
{
  "reference": "<invoice reference>",
  "status": "AWAITING_PAYMENT",
  "totalNaira": 2500.50,
  "items": [{ "description": "<medicine name>", "quantity": 2, "unitPriceNaira": 1250.25 }],
  "paymentMethods": ["Debit card", "Bank transfer", "USSD"],
  "isDemo": false,
  "paymentProvider": "FLUTTERWAVE",
  "authorizationUrl": "<hosted URL or null>",
  "paystackUrl": null,
  "expiresAt": "<ISO timestamp>",
  "fulfillmentState": "AWAITING_CLINICAL_RELEASE"
}

Use authorizationUrl to resume either gateway; paystackUrl remains a compatibility field populated only for eligible Paystack reservations. The URL is null after release/consumption/expiry. paymentMethods describes payment channels; the provider checkout determines actual channel availability.

Show success only for PAID. For PAID_REVIEW show Payment received; manual review required and do not prompt another payment. For INITIALIZING, INITIALIZATION_UNKNOWN or AWAITING_PAYMENT show pending and poll the authenticated invoice endpoint with a modest delay/backoff while the page is visible. Persisted pending status can remain during provider outages. For EXPIRED or PAYMENT_FAILED stop polling and show the outcome, with an explicit new checkout action. Never infer paid from redirect parameters. Payment success is separate from clinical release and delivery.

Handle 401 by restoring the buyer login, 403 as access denied, 409 STOCK_UNAVAILABLE by refreshing stock/start state, 409 PAYMENT_MISMATCH as a support/review error without automatic payment retry, 422 as invalid input/prescription/key, 502 as provider uncertainty (retry the same key/body), and 503 as provider configuration unavailable. Preserve the user's input.

## Verification and references

Automated tests use mocked providers and embedded PostgreSQL and do not load .env files. Before launch apply the migration and verify real Flutterwave test-mode checkout, callback, authenticated invoice polling, duplicate webhook delivery and late payment review. Multi-connection PostgreSQL concurrency and live provider behavior remain deployment checks.

Official references: https://developer.flutterwave.com/docs/flutterwave-standard-1 ; https://developer.flutterwave.com/reference/verify-transaction-with-tx_ref ; https://developer.flutterwave.com/docs/webhooks ; https://developer.flutterwave.com/docs/checksum
