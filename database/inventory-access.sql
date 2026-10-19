-- Explicit stock grants. Apply after the existing facility and marketplace migrations.
BEGIN;
CREATE TABLE inventory_access_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 facility_id uuid NOT NULL REFERENCES hospitals(id),
 granted_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,facility_id)
);
ALTER TABLE medicines ADD COLUMN catalog_facility_id uuid REFERENCES hospitals(id);
CREATE INDEX medicines_catalog_facility ON medicines(catalog_facility_id);
-- No automatic grant to FACILITY_ADMIN or to all pharmacists/doctors.
-- Existing shared catalogue records retain NULL ownership and require network administration.
COMMIT;
