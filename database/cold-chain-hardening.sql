-- Run after the existing schema and oncosourz-new-entities.sql.
-- Secrets are resolved from server-side IOT_DEVICE_KEYS JSON; never insert them here.
BEGIN;

CREATE TABLE IF NOT EXISTS iot_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id varchar(160) NOT NULL UNIQUE,
  facility_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  secret_ref varchar(160) NOT NULL,
  secret_fingerprint varchar(64) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  expected_interval_seconds integer NOT NULL DEFAULT 300 CHECK (expected_interval_seconds > 0),
  sensor_min_celsius numeric(5,2) NOT NULL DEFAULT -40,
  sensor_max_celsius numeric(5,2) NOT NULL DEFAULT 85,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS iot_device_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES iot_devices(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES storage_units(id) ON DELETE CASCADE,
  UNIQUE(device_id, unit_id)
);
CREATE INDEX IF NOT EXISTS idx_iot_device_units_unit ON iot_device_units(unit_id, device_id);
CREATE TABLE IF NOT EXISTS iot_request_nonces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), device_id uuid NOT NULL REFERENCES iot_devices(id) ON DELETE CASCADE,
  nonce varchar(160) NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(device_id, nonce)
);

ALTER TABLE storage_units ALTER COLUMN device_key DROP NOT NULL;
ALTER TABLE storage_units ADD COLUMN IF NOT EXISTS offline_after_seconds integer NOT NULL DEFAULT 900;
ALTER TABLE storage_units ADD COLUMN IF NOT EXISTS operational_state varchar(16) NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE storage_units ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
ALTER TABLE storage_units ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_storage_units_facility_id ON storage_units(facility_id, id);

ALTER TABLE temperature_logs ALTER COLUMN transfer_id DROP NOT NULL;
ALTER TABLE temperature_logs ADD COLUMN IF NOT EXISTS unit_id uuid REFERENCES storage_units(id) ON DELETE SET NULL;
ALTER TABLE temperature_logs ADD COLUMN IF NOT EXISTS device_id uuid REFERENCES iot_devices(id) ON DELETE SET NULL;
ALTER TABLE temperature_logs ADD COLUMN IF NOT EXISTS sequence bigint;
CREATE UNIQUE INDEX IF NOT EXISTS uq_temperature_logs_device_sequence
  ON temperature_logs(device_id, sequence) WHERE device_id IS NOT NULL AND sequence IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_temperature_logs_unit_time ON temperature_logs(unit_id, recorded_at);

ALTER TABLE inventory ADD COLUMN IF NOT EXISTS storage_unit_id uuid REFERENCES storage_units(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_storage_unit ON inventory(storage_unit_id, status);

ALTER TABLE cold_chain_events ADD COLUMN IF NOT EXISTS state varchar(16) NOT NULL DEFAULT 'OPEN';
ALTER TABLE cold_chain_events ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE cold_chain_events ADD COLUMN IF NOT EXISTS observed_min_celsius numeric(5,2);
ALTER TABLE cold_chain_events ADD COLUMN IF NOT EXISTS observed_max_celsius numeric(5,2);
ALTER TABLE cold_chain_events ADD COLUMN IF NOT EXISTS affected_inventory_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
-- Existing rows predate stateful alerts and must remain history, not be treated as open incidents.
UPDATE cold_chain_events SET state = 'RESOLVED' WHERE state = 'OPEN';
CREATE UNIQUE INDEX IF NOT EXISTS uq_cold_chain_open_unit_severity
  ON cold_chain_events(unit_id, severity) WHERE state = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_cold_chain_events_unit_state_time
  ON cold_chain_events(unit_id, state, at DESC);
CREATE INDEX IF NOT EXISTS idx_cold_chain_events_created
  ON cold_chain_events(at DESC);

CREATE SEQUENCE IF NOT EXISTS cold_chain_outbox_stream_id_seq;
CREATE TABLE IF NOT EXISTS cold_chain_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id bigint NOT NULL UNIQUE DEFAULT nextval('cold_chain_outbox_stream_id_seq'),
  event_type varchar(24) NOT NULL,
  unit_id uuid NOT NULL REFERENCES storage_units(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  processed boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cold_chain_outbox_pending ON cold_chain_outbox(created_at) WHERE processed = false;

ALTER TABLE audit_logs ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS event_key uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_logs_event_key
  ON audit_logs(event_key) WHERE event_key IS NOT NULL;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS cold_chain_outbox_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_cold_chain_outbox_user
  ON notifications(cold_chain_outbox_id, user_id)
  WHERE cold_chain_outbox_id IS NOT NULL;

COMMIT;
