# Admin professional account types

`PATCH /users/api/update-one-user/:id` (also `/api/users/api/update-one-user/:id`)
accepts contact-only updates as before. A type update requires an active ADMIN
or SUPERADMIN with both `admin.access` and `user.update`. Admin session user
responses already include the current database-backed `permissions` array.

```json
{
  "first_name": "Ada",
  "account_type": "PHARMACIST",
  "expected_account_type": "DOCTOR",
  "account_type_change_reason": "Corrected classification after review."
}
```

Types: `DOCTOR`, `PHARMACIST`, `PHARMACY_STORE`. Expected type must be present,
and may be null for an unassigned account. Reasons are trimmed and must contain
1–1000 characters. Administrator-role targets (including facility administrators)
and self-reclassification are forbidden. Unknown payload properties are rejected
by the existing global validation pipe.

The user row is locked and re-read in a transaction. A stale expected type returns
409 without saving contacts. A real change sets `active=false`,
`verification_status=MANUAL_REVIEW`, clears current licence references, revokes
refresh sessions, and writes `USER_ACCOUNT_TYPE_CHANGED` in the same transaction.
Historical applications are retained; any current licence not already represented
there is also recorded in the audit description. The audit includes actor, target,
old/new type, reason, timestamp and resulting verification state.

Derived professional roles change to ONCOLOGIST for DOCTOR and PHARMACIST for
the pharmacy types, matching registration. Independently assigned roles/grants
remain subject to normal active, verified membership checks. Existing access
tokens fail database-backed authentication while the account is inactive; tokens
carrying a previous professional type also fail after approval. Refresh responses
already recompute permissions and navigation from the current database state.

Success uses `{success,message,data}`, including saved `data.account_type`,
`verification_status`, `active`, safe contacts and role. No password hashes,
blind indexes, tokens or nested facility entity are returned. Directory responses
already expose nullable `account_type`. Validation/authentication/authorization,
missing user and concurrency errors use the standard envelope with HTTP
400/401/403/404/409 respectively.

## New evidence after a change

The existing `POST /api/me/verification/resubmit` placeholder is now a real,
credential-verified operation. Inactive accounts cannot obtain a workspace session,
so this specific route takes credentials rather than requiring a bearer token:

```json
{
  "email": "ada@example.test",
  "password": "the user's current password",
  "registry": "PCN",
  "license_number": "NEW12345"
}
```

The route verifies credentials, permits only inactive MANUAL_REVIEW accounts
awaiting new evidence, and accepts MDCN for doctors, PCN for pharmacists, and
PCN_PREMISES for pharmacy stores. It creates a fresh review application and audit
entry, keeping the account inactive. Five attempts per minute per IP are allowed
per backend process (HTTP 429 thereafter). Multi-instance deployments should apply
an equivalent shared gateway limit. No provider verification is fabricated.

Frontend integration must collect these credentials and the new licence on the
resubmission screen; the old bodyless placeholder request is no longer supported.
This backend change does not implement that screen.

The existing admin review routes recheck/decide only the latest application whose
licence and registry match the user's current profession. Review locks the user
row, preventing approval from racing a type change. Re-reviewing a member of an
already active facility does not change that facility's status. Approval restores
access only under the existing facility/membership conditions.

No schema migration or new permission seed is needed. Existing `users`,
`user_sessions`, `verification_applications`, `audit_logs` and role-permission
tables must already be installed. No business email was added. Production database
execution, deployment and frontend integration require separate verification.

Validation: `npm.cmd test -- --runInBand`, `npm.cmd run build`.
