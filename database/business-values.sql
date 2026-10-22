-- Apply after marketplace.sql and cold-chain-hardening.sql, before deploying.
BEGIN;
ALTER TABLE marketplace_listings DROP CONSTRAINT IF EXISTS marketplace_listings_category_check;
ALTER TABLE marketplace_listings ADD CONSTRAINT marketplace_listings_category_check
  CHECK (length(btrim(category)) BETWEEN 1 AND 100 AND category !~ '[[:cntrl:]]') NOT VALID;
-- Do not silently assign a storage policy or measurement time on future writes.
-- Existing recorded values are preserved; their provenance cannot be inferred.
ALTER TABLE storage_units ALTER COLUMN target_min DROP DEFAULT;
ALTER TABLE storage_units ALTER COLUMN target_max DROP DEFAULT;
ALTER TABLE temperature_logs ALTER COLUMN recorded_at DROP DEFAULT;
COMMIT;
