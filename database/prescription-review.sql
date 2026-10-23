-- Apply after frontend-contract.sql and facility-registration.sql (structured audit columns).
BEGIN;
ALTER TABLE prescriptions ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE order_events
 ADD COLUMN event_type text,
 ADD COLUMN message text,
 ADD COLUMN actor_id uuid REFERENCES users(id),
 ADD COLUMN review_version integer;
CREATE UNIQUE INDEX prescription_review_event_once ON order_events(order_id,review_version) WHERE review_version IS NOT NULL;
CREATE INDEX prescription_review_history ON order_events(order_id,at,id);
CREATE INDEX prescription_review_queue ON prescriptions(auth_status,created_at DESC,id DESC);
CREATE FUNCTION prescription_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.patient_ref,NEW.icd10,NEW.tnm_stage,NEW.drug_id,NEW.qty,NEW.insurer,NEW.pharmacy_facility_id,NEW.prescriber_id,NEW.auth_status,NEW.order_stage)
 IS DISTINCT FROM ROW(OLD.patient_ref,OLD.icd10,OLD.tnm_stage,OLD.drug_id,OLD.qty,OLD.insurer,OLD.pharmacy_facility_id,OLD.prescriber_id,OLD.auth_status,OLD.order_stage) THEN
 NEW.version=OLD.version+1; NEW.updated_at=clock_timestamp();
 ELSE NEW.version=OLD.version; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER prescription_revision_guard BEFORE UPDATE ON prescriptions FOR EACH ROW EXECUTE FUNCTION prescription_revision();
CREATE FUNCTION prescription_event_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Prescription history is append-only'; END $$;
CREATE TRIGGER prescription_event_history_guard BEFORE UPDATE OR DELETE ON order_events FOR EACH ROW EXECUTE FUNCTION prescription_event_append_only();
-- Grant prescription.review explicitly to approved network reviewers. No automatic grants.
COMMIT;
