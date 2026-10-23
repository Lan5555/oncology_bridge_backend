-- Apply after marketplace.sql, facility-registration.sql, and email-service.sql.
BEGIN;
ALTER TABLE marketplace_orders
 ADD COLUMN order_status text NOT NULL DEFAULT 'PENDING_PAYMENT'
   CHECK (order_status IN ('PENDING_PAYMENT','CONFIRMED','PROCESSING','SHIPPED','DELIVERED','CANCELLED')),
 ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
 ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN buyer_snapshot jsonb,
 ADD COLUMN delivery jsonb;
ALTER TABLE marketplace_orders ADD CONSTRAINT marketplace_order_money CHECK (
 currency='NGN' AND unit_price_kobo>0 AND fees_kobo>=0 AND
 total_kobo=unit_price_kobo*quantity+fees_kobo AND total_kobo<=9000000000000);
-- Historical orders retain their checkout snapshots. Do not manufacture buyer or delivery snapshots.
UPDATE marketplace_orders SET updated_at=GREATEST(created_at,COALESCE(paid_at,created_at)),order_status=CASE
 WHEN payment_status='PAID' AND reservation_state='CONSUMED' THEN 'CONFIRMED'
 WHEN payment_status IN ('PAID_REVIEW','EXPIRED','PAYMENT_FAILED') THEN 'CANCELLED'
 ELSE 'PENDING_PAYMENT' END;
CREATE TABLE purchase_order_events (
 id uuid PRIMARY KEY, sequence bigserial UNIQUE, order_id uuid NOT NULL REFERENCES marketplace_orders(id),
 event_key text NOT NULL, status text NOT NULL, message text NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(order_id,event_key)
);
CREATE FUNCTION purchase_order_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Purchase order events are append-only'; END $$;
CREATE TRIGGER purchase_order_events_guard BEFORE UPDATE OR DELETE ON purchase_order_events
 FOR EACH ROW EXECUTE FUNCTION purchase_order_events_immutable();
CREATE FUNCTION purchase_order_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.buyer_id,NEW.listing_id,NEW.inventory_item_id,NEW.facility_id,NEW.prescription_id,
 NEW.idempotency_key,NEW.payload_hash,NEW.quantity,NEW.unit_price_kobo,NEW.fees_kobo,
 NEW.total_kobo,NEW.currency,NEW.snapshot,NEW.invoice_reference,NEW.payment_reference,NEW.buyer_snapshot,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.buyer_id,OLD.listing_id,OLD.inventory_item_id,OLD.facility_id,OLD.prescription_id,
 OLD.idempotency_key,OLD.payload_hash,OLD.quantity,OLD.unit_price_kobo,OLD.fees_kobo,
 OLD.total_kobo,OLD.currency,OLD.snapshot,OLD.invoice_reference,OLD.payment_reference,OLD.buyer_snapshot,OLD.created_at) THEN
 RAISE EXCEPTION 'Purchase order checkout snapshots are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER purchase_order_snapshot_guard BEFORE UPDATE ON marketplace_orders
 FOR EACH ROW EXECUTE FUNCTION purchase_order_snapshot_immutable();
CREATE INDEX purchase_orders_buyer_created ON marketplace_orders(buyer_id,created_at DESC,id DESC);
CREATE INDEX purchase_orders_created ON marketplace_orders(created_at DESC,id DESC);
CREATE INDEX purchase_order_events_history ON purchase_order_events(order_id,occurred_at,sequence);
-- Grant order.read/order.manage explicitly through role permissions; no automatic privilege expansion.
COMMIT;
