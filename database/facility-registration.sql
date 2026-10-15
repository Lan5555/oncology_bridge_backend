-- Registration contract additions. Apply once; application uses synchronize=false.
BEGIN;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_type varchar(24),
  ADD COLUMN IF NOT EXISTS license_number varchar(24),
  ADD COLUMN IF NOT EXISTS license_registry varchar(32),
  ADD COLUMN IF NOT EXISTS verification_status varchar(24) NOT NULL DEFAULT 'MANUAL_REVIEW',
  ADD COLUMN IF NOT EXISTS registry_result varchar(24) NOT NULL DEFAULT 'UNAVAILABLE';
ALTER TABLE medicines ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE hospitals
  ADD COLUMN IF NOT EXISTS ip_whitelist text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS admin_note text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS membership_open boolean NOT NULL DEFAULT true;
ALTER TABLE verification_applications
  ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_license_number_normalized
  ON users (upper(btrim(license_number))) WHERE license_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_verification_applications_user_submitted
  ON verification_applications(user_id, submitted_at DESC);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS event_key uuid;
ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS object_type varchar(64),
  ADD COLUMN IF NOT EXISTS object_id uuid,
  ADD COLUMN IF NOT EXISTS request_id varchar(100),
  ADD COLUMN IF NOT EXISTS before_status varchar(32),
  ADD COLUMN IF NOT EXISTS after_status varchar(32);
CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_logs_event_key
  ON audit_logs(event_key) WHERE event_key IS NOT NULL;

-- Repair a stale serial sequence before role inserts (older databases may have
-- been populated with explicit role IDs).
SELECT setval(
  pg_get_serial_sequence('roles', 'id'),
  GREATEST(COALESCE(MAX(id), 0), 1),
  COALESCE(MAX(id), 0) > 0
) FROM roles;

INSERT INTO roles (name, description)
VALUES ('FACILITY_ADMIN', 'Administrator for a single facility')
ON CONFLICT (name) DO NOTHING;
-- Public signups previously received ADMIN; keep facility users out of the network-admin role.
UPDATE users AS u
SET role_id = facility_admin.id
FROM roles AS facility_admin, roles AS network_admin
WHERE facility_admin.name = 'FACILITY_ADMIN'
  AND network_admin.name = 'ADMIN'
  AND u.role_id = network_admin.id
  AND (
    u.account_type IS NOT NULL OR
    EXISTS (
      SELECT 1 FROM verification_applications AS va
      JOIN hospitals AS h ON h.id = u.hospital_id
      WHERE va.user_id = u.id AND h.status = 'PENDING'
    )
  );
INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
CROSS JOIN (VALUES
  ('admin.access'), ('facility.read'), ('facility.update'), ('facility.delete'),
  ('user.read'), ('user.update'), ('role.read'), ('role.update'),
  ('verification.read'), ('verification.decide'), ('audit.read'), ('audit.export'),
  ('settlement.read'), ('integration.read'), ('integration.manage'),
  ('integration.sync'), ('dashboard.read')
) AS p(permission)
WHERE r.name IN ('ADMIN', 'SUPERADMIN')
ON CONFLICT (role_id, permission) DO NOTHING;

INSERT INTO role_permissions (role_id, permission)
SELECT r.id, p.permission
FROM roles r
CROSS JOIN (VALUES ('medicine.update'), ('medicine.delete')) AS p(permission)
WHERE r.name = 'PHARMACIST'
ON CONFLICT (role_id, permission) DO NOTHING;

CREATE TABLE IF NOT EXISTS integration_configurations (
  integration_key varchar(48) PRIMARY KEY,
  config_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_checked_at timestamptz NULL,
  last_status varchar(24) NULL
);
CREATE TABLE IF NOT EXISTS integration_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_key varchar(48) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'QUEUED',
  started_by uuid NOT NULL REFERENCES users(id),
  started_ip text NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  safe_summary text NULL
);
ALTER TABLE integration_sync_jobs ADD COLUMN IF NOT EXISTS started_ip text;
CREATE INDEX IF NOT EXISTS idx_integration_sync_jobs_key_started
  ON integration_sync_jobs(integration_key, started_at DESC);

INSERT INTO role_permissions (role_id, permission)
SELECT id, 'facility.users.manage'
FROM roles WHERE name = 'FACILITY_ADMIN'
ON CONFLICT (role_id, permission) DO NOTHING;

CREATE TABLE IF NOT EXISTS facility_membership_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  facility_id uuid NOT NULL REFERENCES hospitals(id),
  status varchar(24) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  reviewer_id uuid NULL REFERENCES users(id),
  reviewed_at timestamptz NULL,
  reason text NULL,
  submitted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_facility_membership_facility_status_submitted
  ON facility_membership_requests(facility_id, status, submitted_at DESC);

-- Facility registry checks are evidence records only. They do not alter the
-- authoritative verification application, user status, or account activation.
CREATE TABLE IF NOT EXISTS facility_license_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_request_id uuid NOT NULL REFERENCES facility_membership_requests(id),
  facility_id uuid NOT NULL REFERENCES hospitals(id),
  user_id uuid NOT NULL REFERENCES users(id),
  application_id uuid NOT NULL REFERENCES verification_applications(id),
  checked_by uuid NOT NULL REFERENCES users(id),
  registry varchar(32) NOT NULL,
  result varchar(24) NOT NULL CHECK (result IN ('MATCH', 'NO_MATCH', 'UNAVAILABLE', 'INCONCLUSIVE')),
  evidence text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_facility_license_checks_request_checked
  ON facility_license_checks(membership_request_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_facility_license_checks_facility_checked
  ON facility_license_checks(facility_id, checked_at DESC);

CREATE OR REPLACE FUNCTION reject_facility_license_check_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'facility license check evidence is immutable';
END;
$$;
DROP TRIGGER IF EXISTS trg_facility_license_checks_immutable ON facility_license_checks;
CREATE TRIGGER trg_facility_license_checks_immutable
  BEFORE UPDATE OR DELETE ON facility_license_checks
  FOR EACH ROW EXECUTE FUNCTION reject_facility_license_check_mutation();
COMMIT;
