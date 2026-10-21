\set ON_ERROR_STOP on
-- Explicit deployment operation; supply the approved existing seller role name.
-- psql "$DATABASE_URL" -v seller_role=PHARMACY_STORE -f database/grant-marketplace-list.sql
-- No default: do not infer an authorization grant from account type or stock access.
BEGIN;
CREATE TEMP TABLE approved_marketplace_seller_role ON COMMIT DROP AS
  SELECT id, name FROM roles WHERE name = :'seller_role';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM approved_marketplace_seller_role) THEN
    RAISE EXCEPTION 'Approved seller role does not exist; supply its exact existing name';
  END IF;
  IF EXISTS (SELECT 1 FROM approved_marketplace_seller_role
    WHERE upper(btrim(name)) IN ('ADMIN','SUPERADMIN','C','NETWORK ADMIN','NETWORK_ADMIN','NETWORK-ADMIN')) THEN
    RAISE EXCEPTION 'Select an approved facility seller role, not a network administrator role';
  END IF;
END $$;
INSERT INTO role_permissions(role_id, permission)
  SELECT id, 'marketplace.list' FROM approved_marketplace_seller_role
  ON CONFLICT (role_id, permission) DO NOTHING;
COMMIT;
