-- Apply after marketplace.sql and before deploying provider selection.
BEGIN;
ALTER TABLE marketplace_orders ADD COLUMN payment_provider text NOT NULL DEFAULT 'PAYSTACK'
 CHECK (payment_provider IN ('PAYSTACK','FLUTTERWAVE'));
COMMIT;
