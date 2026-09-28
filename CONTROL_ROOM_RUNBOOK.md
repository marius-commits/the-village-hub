# Village Hub Control Room — build & go-live runbook

This branch contains the new operating layer for The Village Hub. It is intentionally isolated from production until the integration secrets, Meta number and Supabase project are ready.

## Built on this branch

- Supabase schema for contacts, Spacebring bookings, provider events, WhatsApp queue/log, feedback, leads, automation rules, system health, Google Ads daily metrics and attribution events.
- RLS on all sensitive tables; browser users never receive service-role access.
- `spacebring-webhook`: Svix signature verification, idempotent booking sync, welcome/post-visit queueing, cancellation cleanup, 12-hour repeat-welcome suppression.
- `message-dispatcher`: Meta template sending, retries/backoff, dead-letter handling and 90-day review-request cooldown.
- `meta-webhook`: Meta verification/signature validation, sent/delivered/read/failed updates and inbound reply logging.
- `lead-intake`: website/ad lead capture with UTM + GCLID attribution and queued acknowledgement.
- `google-ads-sync`: direct Google Ads API campaign/day metrics into the Control Room database.
- `/control-room`: authenticated responsive UI with Today, Bookings, Messages, Experience, Leads, Marketing, Automations and System Health.
- Legacy Zoho Web-to-Lead removed from the feature branch.

## Supabase deployment order

1. Create a separate Village Hub Supabase project.
2. Apply `supabase/migrations/20260926_001_control_room_core.sql`.
3. Insert the first Control Room admin:
   ```sql
   insert into public.control_room_admins(email, role)
   values ('<ADMIN_EMAIL>', 'admin');
   ```
4. Deploy functions:
   - `spacebring-webhook` — public gateway; authenticates Svix signature.
   - `meta-webhook` — public gateway; authenticates Meta signature.
   - `lead-intake` — public gateway; authenticates `x-village-lead-key`.
   - `message-dispatcher` — internal; authenticates `x-control-room-secret`.
   - `google-ads-sync` — internal; authenticates `x-control-room-secret`.
   - `control-room-api` — Supabase JWT verification enabled.
5. Add the secrets listed in `.env.example`.
6. Add Netlify `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `LEAD_INGEST_SECRET`.
7. Run Supabase security and performance advisors before production cutover.

## Spacebring

Webhook URL:
`https://<PROJECT_REF>.supabase.co/functions/v1/spacebring-webhook`

Subscribe initially to:
- `booking.created`
- `booking.updated`
- `booking.paid`
- `booking.deleted`
- `visitors.visit.checked_in`
- `visitors.visit.checked_out`

Store the Svix signing secret as `SPACEBRING_WEBHOOK_SECRET`. Test duplicate deliveries, booking edits and cancellations before enabling outbound WhatsApp.

## WhatsApp

Once the dedicated number is available:
1. Attach it to the Village Hub Meta Business / WABA.
2. Add permanent access token + Phone Number ID.
3. Callback: `https://<PROJECT_REF>.supabase.co/functions/v1/meta-webhook`.
4. Create/approve templates:
   - `village_booking_welcome`
   - `village_post_visit_feedback`
   - `village_post_visit_thanks`
   - `village_lead_received`
5. Add the exact Google review URL.

The public review message must ask for honest feedback/review and must not be selectively sent only after positive feedback.

## Scheduled jobs

After integration tests:
- message dispatcher: every minute
- Google Ads sync: daily around 05:15 SAST

Both use `x-control-room-secret`. Do not enable the message dispatcher until Meta templates and the dedicated number are live.

## Google Ads

Confirmed live account: `7631185996` / `hello@villagehub.co.za`.

The deployed sync uses Google Ads API v25. Since September 9, 2026, developer tokens are optional/ignored by Google; API access is attached to the Google Cloud project owning the OAuth credentials. The existing ChatGPT/Supermetrics connection is used for analysis/validation and is not treated as a production website credential.

## Production cutover checklist

- [ ] Supabase project created
- [ ] migration applied
- [ ] first admin allow-listed
- [ ] security/performance advisor reviewed
- [ ] Spacebring webhook test green
- [ ] WhatsApp number connected
- [ ] Meta templates approved
- [ ] Meta delivery/read webhook green
- [ ] Google Ads OAuth sync green
- [ ] cron jobs enabled
- [ ] website lead test reaches `leads`
- [ ] `/control-room` login works on desktop/mobile
- [ ] only then merge/deploy

## Safety choices

No credentials are committed. No production deployment is performed from this branch. Provider events and message jobs are idempotent/audited. Failed messages retry then dead-letter. Customer data remains behind server-side Supabase access and an authenticated admin allow-list.
