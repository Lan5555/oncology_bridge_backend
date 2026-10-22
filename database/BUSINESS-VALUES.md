# Explicit business values and evidence-based presentation

Apply [business-values.sql](business-values.sql) after the existing marketplace/cold-chain migrations, before deploying. It replaces the four-category database constraint with text validation and removes implicit storage-limit and measurement-time defaults. Existing data is preserved; previously defaulted values cannot be distinguished from deliberately configured values without an operational review. Reapplying the migration is safe. Historical categories are not rewritten or deleted.

## Existing input fields

| Field | Accepted values | Missing/invalid behavior |
| --- | --- | --- |
| Listing `category` | Current managed marketplace identifier; trimmed NFC text, 1-100 characters, no controls | Blank, malformed, or unavailable choices are rejected before upload/save |
| Listing-search `category` | Current managed category identifier; case-insensitive match against stored categories | Blank omits the filter; unknown/withdrawn options return 422; valid choices with no listings return an empty list |
| Prescription `insurer` | Current managed insurer/payment identifier, 1-120 characters | Required on create; omission preserves it on update; null, blank, malformed, or withdrawn choices are rejected |
| Settings `currency` | Current managed ISO 4217 code supported by Node ICU, normalized to uppercase | Blank/null clears to null; omission preserves it; unsupported or withdrawn choices fail before any settings writes |

The subsequent frontend API handoff now requires managed choices. Apply `frontend-contract.sql` and follow [FRONTEND-CONTRACT.md](FRONTEND-CONTRACT.md): `/api/form-options` exposes reviewed identifiers, and mutations/searches independently validate their current availability. There are no business-value seeds or currency defaults. Currency preferences do not convert money or change explicitly NGN marketplace prices/payments. The text validation below still applies, alongside managed-choice validation.

DTO errors use the application's existing validation responses; service-level business value errors use HTTP 422 with the offending field, length or supported-code guidance. Whole quantities, stock units, facility/account types and supported workflow/permission rules remain enforced by their existing APIs. `UNKNOWN` is not a supported facility status update. Missing account/facility/status fields must be rendered as unavailable, and a missing pharmacy activity status must not be treated as `ACTIVE`. The existing live medicine, pharmacy and transfer selection integrations remain the sources of identifiers; the subsequent frontend contract adds the scoped pharmacy directory and explicit dispatch/delivery endpoints.

## Missing data and cold chain

Actual SQL counts and recorded numeric zero remain zero. Missing/invalid measurements are null, not zero. An empty denominator produces a null percentage. Missing transfer quantities/units are not replaced with zero or a fictitious unit. Dashboard unit summaries include explicitly recorded units; chart rows without units have `unit:null` and no percentage.

Storage responses return `currentReadingAt` from the measurement record, `lastSeenAt` separately, `targetMin`/`targetMax` and the snake-case equivalents, and `readingState`. A temperature without a valid measurement timestamp is not a current reading. The latest valid recorded timestamp is selected; no receipt timestamp is substituted. States are:

- `NOMINAL`: a recorded finite temperature within the configured finite limits, with minimum lower than maximum.
- `BREACH`: a recorded finite temperature outside those configured limits.
- `OFFLINE`: recorded offline state, or a recorded last-seen timestamp exceeding the configured positive offline interval.
- `UNKNOWN`: measurement, limits or other evidence is missing/invalid and there is no offline evidence.

Missing/invalid/reversed limits return null limits and cannot imply 2–8°C or nominal status. Partial storage-limit updates validate the resulting pair against the stored bound. Signed sensor ingestion requires a real ISO measurement timestamp including timezone. Live reading events include `targetMin`, `targetMax` and `readingState`; unknown limits never resolve an open breach. History excludes entries without a valid measurement timestamp/finite temperature. Old outbox events retain the evidence originally recorded; clients should show unknown if those events lack classification data.

The dashboard's chain-integrity percentage requires measured/configured state for every monitored unit; it is null if any unit's state is unknown. A known offline unit or open excursion is unhealthy. No monitored units means no percentage, while zero healthy units among known monitored units is a real zero.

## Public statistics and deployment checks

Public statistics expose recorded database counts, an `asOf` timestamp, scope/time-window basis and metric definitions. Inventory and delivered transfer totals share one snapshot. The counts do not establish clinical improvements, financial recovery or a geographic service area. The dashboard no longer supplies a fixed geographic region; `network.region` is null. No change here creates evidence for landing-page improvement claims or named artwork facilities.

Automated coverage includes categories outside the old list, database constraints, blank/new currencies and atomic validation, null versus zero, unsupported facility status updates, measured timestamps and non-default/missing/reversed bounds, pagination/scoping, and recorded dashboard metrics. Verify the frontend forms with actual facility sessions after applying the migration; deployment credentials and frontend components are outside this repository. The subsequent pharmacy-directory, dispatch/delivery, managed-options, and binary-export implementation is documented in [FRONTEND-CONTRACT.md](FRONTEND-CONTRACT.md).


