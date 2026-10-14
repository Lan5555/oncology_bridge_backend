-- Apply once to an existing Oncosourz PostgreSQL database.
-- Adds scan audit/idempotency fields while preserving the existing scan_logs table.
BEGIN;

ALTER TABLE scan_logs
  ADD COLUMN IF NOT EXISTS client_uuid uuid,
  ADD COLUMN IF NOT EXISTS client_ts timestamptz,
  ADD COLUMN IF NOT EXISTS action varchar(24),
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS result varchar(16) NOT NULL DEFAULT 'CLEAN',
  ADD COLUMN IF NOT EXISTS facility_id uuid REFERENCES hospitals(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_scan_logs_client_uuid
  ON scan_logs(client_uuid) WHERE client_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scan_logs_facility_created
  ON scan_logs(facility_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_logs_serial
  ON scan_logs(serial_number);

COMMIT;
