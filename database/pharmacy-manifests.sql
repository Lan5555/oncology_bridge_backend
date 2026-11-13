-- Apply before deploying the manifest/dispensing endpoints. Does not change stock counts.
BEGIN;
CREATE TABLE IF NOT EXISTS pharmacy_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES hospitals(id),
  uploaded_by uuid NOT NULL REFERENCES users(id),
  reference varchar(120) NOT NULL CHECK (length(trim(reference)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (facility_id, reference),
  UNIQUE (id, facility_id)
);
CREATE TABLE IF NOT EXISTS pharmacy_manifest_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES hospitals(id),
  gtin varchar(14) NOT NULL CHECK (gtin ~ '^[0-9]{14}$'),
  serial varchar(20) NOT NULL CHECK (length(serial) > 0),
  lot varchar(20) NOT NULL CHECK (length(lot) > 0),
  expiry date NOT NULL,
  FOREIGN KEY (manifest_id, facility_id) REFERENCES pharmacy_manifests(id, facility_id),
  UNIQUE (facility_id, gtin, serial)
);
CREATE INDEX IF NOT EXISTS idx_manifest_packs_manifest ON pharmacy_manifest_packs(manifest_id);
CREATE TABLE IF NOT EXISTS pack_dispense_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES hospitals(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  client_uuid uuid NOT NULL,
  gtin varchar(14) NOT NULL CHECK (gtin ~ '^[0-9]{14}$'),
  serial varchar(20) NOT NULL CHECK (length(serial) > 0),
  lot varchar(20) NOT NULL CHECK (length(lot) > 0),
  expiry date NOT NULL,
  accepted boolean NOT NULL,
  assessment jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (facility_id, client_uuid)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pack_dispense_identity ON pack_dispense_events(gtin, serial) WHERE accepted = true;
CREATE INDEX IF NOT EXISTS idx_pack_dispense_facility_created ON pack_dispense_events(facility_id, created_at DESC);
COMMIT;
