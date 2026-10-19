-- Apply after facility-registration.sql, oncosourz-new-entities.sql and gs1-scanner.sql.
BEGIN;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS selling_unit text;
ALTER TABLE inventory ADD CONSTRAINT inventory_selling_unit_check CHECK (selling_unit IN ('vial','pack','bottle','box'));
-- Fail closed for legacy medicines: a prescription is required until reviewed.
ALTER TABLE medicines ADD COLUMN IF NOT EXISTS prescription_required boolean NOT NULL DEFAULT true;

CREATE TABLE marketplace_listings (
 id uuid PRIMARY KEY, inventory_item_id uuid NOT NULL UNIQUE REFERENCES inventory(id),
 facility_id uuid NOT NULL REFERENCES hospitals(id), creator_id uuid NOT NULL REFERENCES users(id),
 category text NOT NULL CHECK (category IN ('Biologics','Chemotherapy','Supportive care','Other')),
 unit text NOT NULL CHECK (unit IN ('vial','pack','bottle','box')),
 price_kobo bigint NOT NULL CHECK (price_kobo > 0 AND price_kobo <= 9000000000000),
 quantity integer NOT NULL CHECK (quantity > 0), description text NOT NULL,
 storage text NOT NULL, prescription_required boolean NOT NULL,
 status text NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('PUBLISHED','PENDING_REVIEW','SUSPENDED')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE marketplace_image_uploads (
 id uuid PRIMARY KEY, storage_key text NOT NULL UNIQUE,
 state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','ATTACHED')),
 cleanup_after timestamptz NOT NULL DEFAULT now() + interval '1 hour'
);
CREATE TABLE marketplace_listing_images (
 id uuid PRIMARY KEY REFERENCES marketplace_image_uploads(id),
 listing_id uuid NOT NULL REFERENCES marketplace_listings(id), storage_key text NOT NULL UNIQUE,
 url text NOT NULL, alt text NOT NULL, position integer NOT NULL,
 content_type text NOT NULL, byte_size integer NOT NULL,
 UNIQUE(listing_id, position)
);
CREATE TABLE marketplace_orders (
 id uuid PRIMARY KEY, buyer_id uuid NOT NULL REFERENCES users(id),
 listing_id uuid NOT NULL REFERENCES marketplace_listings(id), inventory_item_id uuid NOT NULL REFERENCES inventory(id),
 facility_id uuid NOT NULL REFERENCES hospitals(id), prescription_id uuid REFERENCES prescriptions(id),
 idempotency_key uuid NOT NULL, payload_hash text NOT NULL, quantity integer NOT NULL CHECK (quantity > 0),
 unit_price_kobo bigint NOT NULL, fees_kobo bigint NOT NULL DEFAULT 0, total_kobo bigint NOT NULL CHECK (total_kobo > 0),
 currency text NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'), snapshot jsonb NOT NULL,
 invoice_reference varchar(32) NOT NULL UNIQUE, payment_reference text NOT NULL UNIQUE,
 authorization_url text, initialization_attempted boolean NOT NULL DEFAULT false,
 payment_status text NOT NULL DEFAULT 'INITIALIZING',
 reservation_state text NOT NULL DEFAULT 'RESERVED' CHECK (reservation_state IN ('RESERVED','RELEASED','CONSUMED')),
 fulfillment_state text NOT NULL DEFAULT 'AWAITING_CLINICAL_RELEASE',
 expires_at timestamptz NOT NULL, paid_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), last_verified_at timestamptz,
 UNIQUE(buyer_id, idempotency_key)
);
CREATE INDEX marketplace_orders_reservations ON marketplace_orders(inventory_item_id, expires_at) WHERE reservation_state = 'RESERVED';
CREATE INDEX marketplace_orders_reconcile ON marketplace_orders(last_verified_at NULLS FIRST) WHERE payment_status NOT IN ('PAID','PAID_REVIEW');
CREATE INDEX marketplace_listings_created ON marketplace_listings(created_at DESC, id);

-- Protect reserved stock even when existing inventory/transfer routes update it.
CREATE FUNCTION marketplace_reserved_stock_floor() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reserved bigint;
BEGIN
 SELECT COALESCE(sum(quantity),0) INTO reserved FROM marketplace_orders
 WHERE inventory_item_id=OLD.id AND reservation_state='RESERVED' AND expires_at > now();
 IF NEW.quantity < reserved THEN
  RAISE EXCEPTION 'Stock is reserved by marketplace checkout' USING ERRCODE='23514';
 END IF;
 IF EXISTS (SELECT 1 FROM marketplace_listings WHERE inventory_item_id=OLD.id) AND
    (NEW.medicine_id IS DISTINCT FROM OLD.medicine_id OR NEW.hospital_id IS DISTINCT FROM OLD.hospital_id OR
     NEW.batch_number IS DISTINCT FROM OLD.batch_number OR NEW.expiry_date IS DISTINCT FROM OLD.expiry_date OR
     NEW.selling_unit IS DISTINCT FROM OLD.selling_unit) THEN
  RAISE EXCEPTION 'Listed batch identity cannot be changed' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER marketplace_inventory_guard BEFORE UPDATE ON inventory FOR EACH ROW EXECUTE FUNCTION marketplace_reserved_stock_floor();
-- Grant marketplace.list explicitly through role_permissions to authorized seller roles.
COMMIT;
