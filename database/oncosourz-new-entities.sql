-- PostgreSQL schema for entities added to support the Oncosourz frontend.
-- Existing tables and entities are intentionally left unchanged.
BEGIN;

CREATE TABLE IF NOT EXISTS prescriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), display_id varchar(24) NOT NULL UNIQUE,
  patient_ref text NOT NULL, icd10 varchar(8) NOT NULL, tnm_stage varchar(32),
  drug_id uuid NOT NULL REFERENCES medicines(id), qty integer NOT NULL CHECK (qty > 0),
  insurer varchar(120), pharmacy_facility_id uuid NOT NULL REFERENCES hospitals(id),
  auth_status varchar(32) NOT NULL DEFAULT 'Pending', order_stage varchar(32) NOT NULL DEFAULT 'Waiting',
  prescriber_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prescriptions_stage ON prescriptions(order_stage, auth_status);
CREATE TABLE IF NOT EXISTS order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), order_id uuid NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  step varchar(120) NOT NULL, state varchar(16) NOT NULL DEFAULT 'pending', at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_events_order_time ON order_events(order_id, at);

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), reference varchar(32) NOT NULL UNIQUE,
  order_id uuid NOT NULL REFERENCES prescriptions(id), pharmacy_facility_id uuid NOT NULL REFERENCES hospitals(id),
  status varchar(32) NOT NULL DEFAULT 'AWAITING_PAYMENT', total_naira integer NOT NULL CHECK (total_naira >= 0),
  paystack_reference varchar(120) UNIQUE, paid_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description text NOT NULL, quantity integer NOT NULL CHECK (quantity > 0), unit_price_naira integer NOT NULL CHECK (unit_price_naira >= 0)
);
CREATE TABLE IF NOT EXISTS settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_id uuid NOT NULL REFERENCES invoices(id),
  amount_naira integer NOT NULL CHECK (amount_naira >= 0), platform_fee_naira integer NOT NULL CHECK (platform_fee_naira >= 0),
  payout_status varchar(16) NOT NULL DEFAULT 'QUEUED', created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key varchar(120) PRIMARY KEY, value jsonb, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS research_inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(160) NOT NULL, organisation varchar(200) NOT NULL,
  email varchar(254) NOT NULL, message text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_research_inquiries_created ON research_inquiries(created_at DESC);

CREATE TABLE IF NOT EXISTS verification_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id), registry varchar(32) NOT NULL,
  license_number varchar(24) NOT NULL, registry_result varchar(24) NOT NULL DEFAULT 'UNAVAILABLE', status varchar(24) NOT NULL DEFAULT 'PENDING',
  reviewer_id uuid REFERENCES users(id), reviewed_at timestamptz, reason text, submitted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_verification_applications_status ON verification_applications(status, submitted_at);

CREATE TABLE IF NOT EXISTS storage_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), facility_id uuid NOT NULL REFERENCES hospitals(id), label varchar(160) NOT NULL,
  kind varchar(16) NOT NULL DEFAULT 'FRIDGE', target_min numeric(4,2) NOT NULL DEFAULT 2,
  target_max numeric(4,2) NOT NULL DEFAULT 8, device_key varchar(160) NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS cold_chain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), unit_id uuid NOT NULL REFERENCES storage_units(id), severity varchar(16) NOT NULL,
  message text NOT NULL, action_taken text, at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_cold_chain_events_unit_time ON cold_chain_events(unit_id, at DESC);
CREATE TABLE IF NOT EXISTS facility_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), facility_id uuid NOT NULL REFERENCES hospitals(id), device_id varchar(160) NOT NULL,
  label varchar(160), approved boolean NOT NULL DEFAULT false, last_seen timestamptz,
  UNIQUE(facility_id, device_id)
);
CREATE TABLE IF NOT EXISTS role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), role_id integer NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission varchar(160) NOT NULL, UNIQUE(role_id, permission)
);

-- Existing temperature_logs are retained; this index supports chart/history queries.
CREATE INDEX IF NOT EXISTS idx_temperature_logs_transfer_recorded ON temperature_logs(transfer_id, recorded_at DESC);
COMMIT;
