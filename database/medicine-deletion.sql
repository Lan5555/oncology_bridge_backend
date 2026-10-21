-- Apply after marketplace.sql and the transfer_requests table exists, before deploying this backend.
BEGIN;
-- Hold a shared medicine row lock until each stock/transfer write commits. This
-- serializes scanner/manual writes with the deletion service's exclusive lock.
CREATE OR REPLACE FUNCTION require_active_stock_medicine() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
   IF NEW.medicine_id IS NOT DISTINCT FROM OLD.medicine_id AND NEW.quantity<=OLD.quantity THEN RETURN NEW; END IF;
 END IF;
 PERFORM id FROM medicines WHERE id=NEW.medicine_id AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Deleted or missing medicine cannot receive new stock' USING ERRCODE='23514',CONSTRAINT='medicine_active_required';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS inventory_active_medicine ON inventory;
CREATE TRIGGER inventory_active_medicine BEFORE INSERT OR UPDATE OF medicine_id,quantity ON inventory
 FOR EACH ROW EXECUTE FUNCTION require_active_stock_medicine();
CREATE OR REPLACE FUNCTION require_active_transfer_medicine() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
   IF NEW.status IN ('REJECTED','CANCELLED') AND NEW.medicine_id IS NOT DISTINCT FROM OLD.medicine_id
      AND NEW.inventory_id IS NOT DISTINCT FROM OLD.inventory_id THEN RETURN NEW; END IF;
 END IF;
 PERFORM m.id FROM medicines m JOIN inventory i ON i.medicine_id=m.id
 WHERE m.id=NEW.medicine_id AND i.id=NEW.inventory_id AND m.deleted_at IS NULL FOR SHARE OF m;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'Deleted or missing medicine stock cannot be transferred' USING ERRCODE='23514',CONSTRAINT='medicine_active_required';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS transfer_active_medicine ON transfer_requests;
CREATE TRIGGER transfer_active_medicine BEFORE INSERT OR UPDATE ON transfer_requests
 FOR EACH ROW EXECUTE FUNCTION require_active_transfer_medicine();
COMMIT;
