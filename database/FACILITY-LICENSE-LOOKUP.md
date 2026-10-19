# Facility licence lookup and manual evidence contracts

The existing `POST /api/facility-membership-requests/:requestId/license-check` is deliberately a **manual review submission** endpoint. It still requires `{ "result": "MATCH|NO_MATCH|UNAVAILABLE|INCONCLUSIVE", "evidence": "5–4000 characters" }` and an authorized facility administrator. Sending `{}` to that route still produces validation errors. Manual evidence is trimmed and must remain within 5–4000 characters.

The **Check licence button must call the separate automated endpoint**:

```http
POST /api/facility-membership-requests/:requestId/license-lookup
Authorization: Bearer <facility-user-or-admin-session-token>
Content-Type: application/json

{}
```

The frontend request has not been changed in this backend repository. This is the confirmed contract to use when updating that button. Do not send a result, evidence, licence number, registry, facility ID, or applicant identity to the automated action. Nonempty request properties are rejected.

The server reads the pending membership request, linked applicant and latest verification application. Applicant account type, registry and licence number must exist and agree with the application. Allowed professional/registry pairs are the existing registration pairs: DOCTOR/MDCN, PHARMACIST/PCN and PHARMACY_STORE/PCN_PREMISES. A facility reviewer must be active and verified, hold the FACILITY_ADMIN role and `facility.users.manage`, and belong to the request's facility. ADMIN/SUPERADMIN operators use their admin bearer token with `admin.access` and `verification.decide`; configured network MFA still applies. Network operators are not silently scoped to their own facility.

The response uses the single canonical result field **`result`**, nested in `data.facility_license_review`:

```json
{
  "success": true,
  "message": "Registry check completed. Manual review is required.",
  "data": {
    "facility_license_review": {
      "id": "persisted-check-uuid",
      "membership_request_id": "request-uuid",
      "facility_id": "facility-uuid",
      "user_id": "applicant-uuid",
      "application_id": "central-application-uuid",
      "registry": "PCN",
      "registry_name": null,
      "result": "UNAVAILABLE",
      "evidence": "Server-side registry lookup is not configured. Manual licence review is required.",
      "checked_by": "reviewer-uuid",
      "checked_at": "2026-10-19T12:00:00.000Z",
      "status": "MANUAL_REVIEW"
    }
  }
}
```

HTTP 200 means that the lookup outcome was recorded, including UNAVAILABLE or INCONCLUSIVE; it does not imply a successful licence match or approval. Each lookup appends an immutable row to `facility_license_checks` and an audit event atomically. The existing facility-registration migration already creates this table; no new migration is needed for this feature. Facility membership list responses include the latest persisted `facility_license_review` so the result survives refresh. Its `status` is a derived, non-authoritative review indicator. The authoritative application status, licence result, membership decision, and user activation are never updated by this lookup. Even MATCH leaves central and membership approval gates in place.

Applicant details, reviewer permission and pending membership are checked again after the provider call. Changed applicant/application/facility details cause 409 instead of saving stale evidence. Missing licence/application data is 422, invalid request UUIDs are 400, unknown requests are 404, and forbidden reviewer or cross-facility access is 403. No database transaction or locks are held while waiting on the external registry.

## Server registry integration

### Registry display names

`registry` is the stored registry code. Applicant/licence responses and `facility_license_review` include a separate optional **`registry_name`** from backend configuration. User records retain the legacy `license_registry` field and also supply `registry` as its code alias. The UI should display the supplied `registry_name`, fall back to the supplied `registry` code, and display **Not provided** if neither exists. Do not infer full registry names from account type.

Configure display metadata through the existing authenticated `PUT /admin/api/integrations/license_registry/configuration` endpoint:

```json
{
  "values": {
    "mdcn_registry_name": "Your configured MDCN display name",
    "pcn_registry_name": "Your configured PCN display name",
    "pcn_premises_registry_name": "Your configured premises registry display name"
  }
}
```

These are optional non-secret, single-line text settings, at most 200 characters. Clear a name with an empty string. The backend trims configured names and returns `registry_name: null` for unset names, unknown codes, or unavailable metadata. Names are read independently of Vault and provider availability; display metadata does not establish a licence match. No new database migration is required because the existing integration configuration JSON stores these settings. Names are response metadata, not immutable evidence, so renaming a registry does not rewrite licence codes or historical checks.

Authenticated user/session responses, facility membership applicants and their latest review, automated/manual lookup replies, and central verification application records carry this metadata. No public registry metadata enumeration endpoint is introduced. Registration should keep generic licence labels until a public metadata contract is available; required registration codes remain MDCN, PCN and PCN_PREMISES with their existing account-type validation.

### Lookup provider

Configure the existing `license_registry` integration through integration administration: `registry_url` is the HTTPS lookup gateway endpoint and `api_key` is stored through the existing Vault secret mechanism. The URL is validated using the existing public-host HTTPS policy; redirects are rejected. Credentials are never returned in review records or evidence. Unconfigured integrations, inaccessible secrets, network failures, timeouts, and unsuccessful HTTP responses produce persisted UNAVAILABLE outcomes with safe explanations.

The adapter uses this **application-owned gateway contract**, not an asserted native MDCN/PCN API. Connect a trusted provider adapter/gateway that implements it; a real registry provider connection is still required for live matches. It receives a server-side POST with a Bearer API credential and JSON containing only:

```json
{
  "licenseNumber": "PCN-1234",
  "professionalType": "PHARMACIST",
  "registry": "PCN"
}
```

A successful gateway response is JSON, bounded to 64 KiB, and echoes the exact search in `query`:

```json
{
  "query": {
    "licenseNumber": "PCN-1234",
    "professionalType": "PHARMACIST",
    "registry": "PCN"
  },
  "found": true,
  "ambiguous": false,
  "record": {
    "licenseNumber": "PCN-1234",
    "professionalType": "PHARMACIST",
    "registry": "PCN",
    "lastName": "Applicant surname returned by registry",
    "status": "ACTIVE"
  }
}
```

`MATCH` requires an unambiguous response for the exact query, matching licence number, registry, professional type and the applicant's stored surname, and explicit ACTIVE status. Normalization trims and applies Unicode NFKC/uppercase; it does not guess identity. An explicit `found:false` for the exact unambiguous query yields NO_MATCH. Conflicting identity details or an explicitly INACTIVE, EXPIRED, SUSPENDED or REVOKED licence yield NO_MATCH. Missing fields, unknown status, ambiguous data, mismatched search echoes, malformed JSON or unsupported provider shapes yield INCONCLUSIVE. A bare `result:"MATCH"` is not sufficient. Provider-supplied evidence and unrelated personal data are not copied into the response; the server generates bounded explanations and does not store raw registry responses.

Tests cover empty-body requests, the unchanged manual contract, all four outcomes, evidence bounds, persisted records and timestamps, real admin/facility bearer tokens, review permissions, cross-facility rejection, missing data, applicant/permission changes during lookup and unchanged central approval/activation state. Provider calls are mocked; live provider credentials and gateway integration must be validated in the deployment environment.
