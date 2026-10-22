# Brevo transactional email

## HTML previews

All default emails use a shared responsive HTML layout with inline styles, an Outlook table fallback, a hidden inbox preview, and a plain-text alternative. Reset, welcome, registration, review and notification emails have tailored content; custom messages without HTML inherit the same layout. The design uses system fonts and no external images or tracking assets.

To preview the actual application messages without sending email, run `npm run build`, then `node scripts/preview-emails.cjs`. Open `dist/email-previews/index.html` to view all six sample emails. Check them at desktop and mobile widths; previews use dummy data and a nonfunctional reset token. Outlook/Gmail rendering should also be smoke tested with a configured test sender before launch.

Apply [email-service.sql](email-service.sql) before deploying this version, including when email is disabled. The API uses `synchronize: false`.

Set these server environment variables (see [../.env.example](../.env.example)):

```dotenv
EMAIL_ENABLED=true
BREVO_API_KEY=<Brevo API key>
EMAIL_FROM_ADDRESS=no-reply@your-verified-domain.example
EMAIL_FROM_NAME=OncoSourz
FRONTEND_ORIGIN=https://your-frontend.example
PASSWORD_RESET_PATH=/reset-password
```

Use a verified Brevo sender and an **API key**, not an SMTP key. The service uses [Brevo's transactional API](https://developers.brevo.com/reference/send-transac-email). This module reads server environment variables; the older admin SMTP configuration does not configure this sender. `ENCRYPTION_KEY` must remain stable across API instances and restarts, as it also encrypts pending emails. When `EMAIL_ENABLED=true`, invalid provider/sender/origin configuration fails startup. When disabled, optional emails are skipped and password recovery reports that delivery is unavailable.

## Events

| Event | Email |
| --- | --- |
| Facility registration, joining a facility, regular account creation, staff invitation | Account created / registration received, reflecting whether the account is active |
| Forgot password | Reset link valid for 15 minutes |
| Password successfully reset | Security confirmation; existing refresh sessions revoked |
| Licence and membership decisions | The applicant's decision message, including any remaining approval requirement |
| Other new in-app notifications, including facility join requests and cold-chain alerts | A minimal notice asking the recipient to open the app; clinical details remain in the app |

Account and notification emails are captured by `EmailEventsSubscriber` for **new TypeORM entity inserts**. Editing or marking a notification as read does not send again. Raw SQL inserts bypass subscribers. Existing rows are not backfilled. Ordinary login/refresh/logout does not send email. Public research inquiries do not send automatic replies. Transfer and payment flows that do not create notifications are not automatically emailed.

Registration and notification inserts enqueue through the insert event's `EntityManager`, so their existing transactions include the email. No Brevo call occurs during registration/review/notification writes. Use `EmailService.enqueue(message, manager)` in future transactional workflows; omitting `manager` uses the default connection. Use an explicit transaction when multiple writes must succeed together. `EmailModule` exports the global injectable service.

## Password recovery contract

`POST /auth/api/forgot-password` accepts `{ "email": "..." }`. Known, unknown and throttled accounts receive the same success response and `{ "emailQueued": true }`; this is an enumeration-safe acknowledgement, not proof of delivery. No environment returns a reset token. Requests for an account are limited to one queued reset per minute across API instances. A newer request invalidates older tokens.

The frontend route in `PASSWORD_RESET_PATH` reads `?token=...`, accepts a new password (at least eight characters), and posts `{ "token": "...", "password": "..." }` to `/auth/api/reset-password`. Do not load third-party resources on the reset page; remove the token from browser history after reading it. Only token hashes are stored in `password_resets`. Resetting the password, consuming all the account's tokens, revoking refresh sessions and queueing the confirmation share one transaction. Existing access tokens retain their normal lifetime of up to 15 minutes.

## Delivery and operations

The API worker polls every five seconds, processes up to ten messages per pass, and locks rows with PostgreSQL `FOR UPDATE SKIP LOCKED` so replicas share work. A ten-second request timeout and up to eight attempts with exponential backoff isolate provider outages. Expired reset emails are discarded. Email recipient/content payloads are encrypted at rest and removed after success, expiry or final failure. Logs contain only outbox IDs and attempt counts.

`SENT` means Brevo accepted the message; it does not guarantee inbox delivery. Monitor delivery/bounces in Brevo. The worker reuses the outbox UUID as Brevo's idempotency key, but delivery is at least once: a crash after provider acceptance and before database commit can cause a duplicate, particularly outside the provider's deduplication window. Terminal failures require investigation and a new business request; there is no public replay endpoint.

Monitor the queue without exposing recipients/content:

```sql
SELECT status, count(*), min(created_at) AS oldest
FROM email_outbox GROUP BY status;
```

Expired reset hashes and terminal outbox metadata can be removed periodically according to operational retention needs. Pending rows should be retained until processed. No automatic database purge is enabled.

To smoke test after configuring a test sender, register a test account, check the welcome email, request password recovery, follow the link, reset the password, and confirm the token cannot be reused. Check the security confirmation and Brevo logs. Test review decisions with a pending applicant and cold-chain notices with a configured device. Automated tests mock Brevo; they never send live mail.
