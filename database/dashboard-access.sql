-- Intended facility workspace roles; grants no network or inventory mutation rights.
-- Apply after facility-registration.sql. Existing session serializers return these grants.
INSERT INTO role_permissions(role_id, permission)
SELECT id, 'dashboard.read' FROM roles
WHERE UPPER(TRIM(name)) IN ('FACILITY_ADMIN','PHARMACIST','PHARMACY_STORE','DOCTOR','ONCOLOGIST')
ON CONFLICT (role_id, permission) DO NOTHING;
