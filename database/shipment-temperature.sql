-- Apply after purchase-orders.sql and the courier/transfer tables and structured audit columns exist.
BEGIN;
CREATE TABLE shipment_monitors (
 id uuid PRIMARY KEY,
 order_id uuid UNIQUE REFERENCES marketplace_orders(id),
 courier_assignment_id uuid UNIQUE REFERENCES courier_assignments(id),
 courier_id uuid NOT NULL REFERENCES couriers(id),
 provider text NOT NULL CHECK (length(provider) BETWEEN 1 AND 100),
 device_id text NOT NULL CHECK (length(device_id) BETWEEN 1 AND 160),
 min_celsius double precision NOT NULL,
 max_celsius double precision NOT NULL,
 stale_after_seconds integer NOT NULL CHECK (stale_after_seconds BETWEEN 30 AND 86400),
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 last_synced_at timestamptz,
 CHECK ((order_id IS NOT NULL)::int+(courier_assignment_id IS NOT NULL)::int=1),
 CHECK (min_celsius > '-Infinity'::float8 AND max_celsius < 'Infinity'::float8 AND min_celsius<max_celsius)
);
CREATE TABLE shipment_temperature_readings (
 id uuid PRIMARY KEY, shipment_id uuid NOT NULL REFERENCES shipment_monitors(id),
 provider_event_id text NOT NULL CHECK (length(provider_event_id) BETWEEN 1 AND 160),
 celsius double precision NOT NULL CHECK (celsius > '-Infinity'::float8 AND celsius < 'Infinity'::float8),
 recorded_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 out_of_range boolean NOT NULL,
 UNIQUE(shipment_id,provider_event_id)
);
CREATE INDEX shipment_temperature_history ON shipment_temperature_readings(shipment_id,recorded_at DESC,id DESC);
CREATE TABLE shipment_temperature_events (
 id uuid PRIMARY KEY, shipment_id uuid NOT NULL REFERENCES shipment_monitors(id),
 reading_id uuid NOT NULL UNIQUE REFERENCES shipment_temperature_readings(id),
 type text NOT NULL CHECK(type='TEMPERATURE_EXCURSION'),
 occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE notifications ADD COLUMN shipment_temperature_event_id uuid REFERENCES shipment_temperature_events(id);
CREATE UNIQUE INDEX shipment_temperature_notification_once ON notifications(user_id,shipment_temperature_event_id)
 WHERE shipment_temperature_event_id IS NOT NULL;
CREATE FUNCTION shipment_monitor_preserve_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.order_id,NEW.courier_assignment_id,NEW.courier_id,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.order_id,OLD.courier_assignment_id,OLD.courier_id,OLD.created_at) THEN
 RAISE EXCEPTION 'Shipment source and monitoring start cannot be rewritten'; END IF;
 IF EXISTS(SELECT 1 FROM shipment_temperature_readings WHERE shipment_id=OLD.id) AND
 ROW(NEW.provider,NEW.device_id,NEW.min_celsius,NEW.max_celsius,NEW.stale_after_seconds)
 IS DISTINCT FROM ROW(OLD.provider,OLD.device_id,OLD.min_celsius,OLD.max_celsius,OLD.stale_after_seconds) THEN
 RAISE EXCEPTION 'Monitoring configuration with recorded readings is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER shipment_monitor_history_guard BEFORE UPDATE ON shipment_monitors
 FOR EACH ROW EXECUTE FUNCTION shipment_monitor_preserve_history();
CREATE FUNCTION shipment_telemetry_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Shipment telemetry is append-only'; END $$;
CREATE TRIGGER shipment_readings_immutable BEFORE UPDATE OR DELETE ON shipment_temperature_readings
 FOR EACH ROW EXECUTE FUNCTION shipment_telemetry_append_only();
CREATE TRIGGER shipment_events_immutable BEFORE UPDATE OR DELETE ON shipment_temperature_events
 FOR EACH ROW EXECUTE FUNCTION shipment_telemetry_append_only();
-- Explicitly grant coldchain.manage to monitoring operators using the role permissions API.
COMMIT;
