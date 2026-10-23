-- Apply after prescription-review.sql, before deploying description support.
BEGIN;
ALTER TABLE prescriptions ADD COLUMN description text CHECK (description IS NULL OR length(description)<=2000);
CREATE OR REPLACE FUNCTION prescription_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.patient_ref,NEW.icd10,NEW.description,NEW.tnm_stage,NEW.drug_id,NEW.qty,NEW.insurer,NEW.pharmacy_facility_id,NEW.prescriber_id,NEW.auth_status,NEW.order_stage)
 IS DISTINCT FROM ROW(OLD.patient_ref,OLD.icd10,OLD.description,OLD.tnm_stage,OLD.drug_id,OLD.qty,OLD.insurer,OLD.pharmacy_facility_id,OLD.prescriber_id,OLD.auth_status,OLD.order_stage) THEN
 NEW.version=OLD.version+1; NEW.updated_at=clock_timestamp();
 ELSE NEW.version=OLD.version; END IF;
 RETURN NEW;
END $$;
COMMIT;
