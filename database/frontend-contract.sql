BEGIN;
CREATE TABLE IF NOT EXISTS form_options (
  context text NOT NULL CHECK (context IN ('prescription','marketplace','settings')),
  value text NOT NULL CHECK (length(btrim(value)) BETWEEN 1 AND 120 AND value !~ '[[:cntrl:]]'),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 200 AND label !~ '[[:cntrl:]]'),
  active boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  PRIMARY KEY (context,value),
  CHECK (context <> 'marketplace' OR length(value)<=100)
);
-- Deliberately no insurer, category, or currency seeds. Provision reviewed business values.
ALTER TABLE transfer_requests ADD COLUMN IF NOT EXISTS batch_number text;
ALTER TABLE transfer_requests ADD COLUMN IF NOT EXISTS expiry_date date;
ALTER TABLE transfer_requests ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;
ALTER TABLE transfer_requests ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE transfer_requests ADD COLUMN IF NOT EXISTS dispatched_by uuid REFERENCES users(id);
ALTER TABLE transfer_requests ADD COLUMN IF NOT EXISTS delivered_by uuid REFERENCES users(id);
ALTER TABLE transfer_requests ADD COLUMN IF NOT EXISTS recipient_inventory_id uuid REFERENCES inventory(id);
-- Only pending requests can safely adopt current stock provenance. Review older approved stock explicitly.
UPDATE transfer_requests t SET batch_number=i.batch_number,expiry_date=i.expiry_date
FROM inventory i WHERE i.id=t.inventory_id AND t.status IN ('PENDING','PENDING_APPROVAL') AND t.batch_number IS NULL;
COMMIT;
