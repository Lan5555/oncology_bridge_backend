-- Apply after marketplace.sql and inventory-access.sql, before deploying.
BEGIN;
ALTER TABLE transfer_requests ADD COLUMN IF NOT EXISTS selling_unit text;
-- Snapshot reviewed units for pre-existing requests. Unreviewed legacy rows must
-- be corrected explicitly; approval will not infer a unit for them.
UPDATE transfer_requests t SET selling_unit=i.selling_unit
FROM inventory i WHERE i.id=t.inventory_id AND t.selling_unit IS NULL
  AND t.status IN ('PENDING','PENDING_APPROVAL')
  AND i.selling_unit IN ('vial','pack','bottle','box');
CREATE INDEX IF NOT EXISTS idx_transfer_pending_inventory ON transfer_requests(inventory_id)
  WHERE status IN ('PENDING','PENDING_APPROVAL');
COMMIT;
