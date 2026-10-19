-- Apply after the marketplace, inventory-access and cold-chain migrations.
BEGIN;
INSERT INTO role_permissions(role_id,permission)
SELECT r.id,p.permission FROM roles r CROSS JOIN (VALUES
 ('medicine.read'),('inventory.read'),('marketplace.read'),('prescription.read'),
 ('invoice.read'),('transfer.read'),('scan.read'),('coldchain.read'),('network.read'),('research.read')
) AS p(permission)
WHERE UPPER(BTRIM(r.name)) IN ('ADMIN','SUPERADMIN')
ON CONFLICT(role_id,permission) DO NOTHING;
-- Read grants do not change mutation grants or confer network operator status.
ALTER TABLE marketplace_listings DROP CONSTRAINT marketplace_listings_status_check;
ALTER TABLE marketplace_listings ADD CONSTRAINT marketplace_listings_status_check
 CHECK(status IN ('DRAFT','PENDING_REVIEW','PUBLISHED','SUSPENDED','WITHDRAWN'));
COMMIT;
