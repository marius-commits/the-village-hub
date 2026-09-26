# Village Hub Control Room — Build Specification

Status: Phase 1 architecture scaffold
Branch: `feature/village-hub-control-room`
Production impact: none

## Objective

Build a single internal operating layer for The Village Hub that uses Spacebring as the operational source of truth and connects bookings, visitors, customer messaging, feedback, Google review requests, website leads and paid-ad leads without requiring Zoho as an intermediary CRM.

The target stack is:

Spacebring webhooks/API -> secure webhook receiver -> operational database -> message queue -> Meta WhatsApp Cloud API

Meta delivery/reply webhooks -> message log -> Control Room

Meta Lead Ads / website enquiry forms -> lead inbox -> automated acknowledgement -> team follow-up

## Core principles

1. Spacebring remains the source of truth for members, bookings, resources, booking dates/times and payment state.
2. The Control Room stores only the additional operational state Spacebring does not provide: message queue/status, feedback, review-request history, ad/website leads, internal follow-up status and automation audit trail.
3. No Zoho dependency.
4. Zapier/Make are not required in the core architecture. Direct webhooks and serverless functions should be used instead.
5. No customer-facing automation may depend on ChatGPT being open. The workflow must run server-side.
6. Every outbound message is idempotent: the same booking/event cannot trigger the same message twice.
7. Every automated message is logged with provider message ID and delivery state.
8. Recurring members and repeat bookings must be protected from message spam.
9. Review requests must ask for genuine, unbiased feedback and must not be selectively sent only to satisfied guests.
10. Marketing/upsell messages must remain separate from transactional/service messages and only be sent where the required consent/basis exists.

## Spacebring events

Primary real-time inputs:

- `booking.created`
- `booking.updated`
- `booking.paid`
- `booking.deleted`
- `visitors.visit.checked_in`
- `visitors.visit.checked_out`

A booking's `endDate` is used to create the delayed post-visit job. Because a booking-completed webhook is not required for this design, the message queue executes scheduled post-visit actions when their due time arrives.

A reconciliation job should periodically compare recent Spacebring bookings to local records. This is a safety net for missed webhook deliveries and must not be the primary trigger.

## Automation rules

### Booking created

Conditions:
- confirmed booking
- valid customer mobile number available
- not a suppressed test/staff booking

Actions:
- upsert contact
- upsert booking
- write event audit record
- send immediate booking/welcome message when appropriate
- schedule pre-arrival reminder if enabled for resource type
- schedule post-visit follow-up at booking end + configured delay

### Booking updated

Actions:
- update booking date/time/resource/status
- reschedule pending reminder/follow-up jobs
- do not resend already delivered welcome message unless specifically configured

### Booking cancelled/deleted

Actions:
- mark booking cancelled
- cancel pending pre-arrival and post-visit messages
- optionally send cancellation acknowledgement if customer initiated and template is enabled

### Visitor checked in

Actions:
- record check-in
- optionally alert front of house
- optional first-visit welcome automation only; do not send a second welcome when the booking workflow has already sent one

### Visitor checked out

Actions:
- record checkout
- if checkout occurs before the scheduled post-visit time, move the feedback follow-up to checkout + configured delay

### Post-visit

Default timing:
- meeting/boardroom: 60 minutes after end or checkout
- day-pass/hot-desk: configurable late-afternoon send or checkout + 60 minutes
- recurring monthly desk member: do not send after every daily booking

Actions:
- send neutral thank-you + feedback/review request
- record `review_request_at`
- enforce configurable cooldown before another review request (default 90 days)
- inbound negative/issue reply creates an internal follow-up item; it does not remove the customer's ability to leave an honest review

### Ad or website lead created

Actions:
- create lead
- deduplicate by phone/email and campaign/source identifiers
- send immediate acknowledgement where permitted
- assign to Front of House by default
- start response-time clock
- allow status progression: `new`, `contacted`, `tour_booked`, `proposal`, `won`, `lost`

## Recommended WhatsApp templates

### `booking_welcome`

Hi {{first_name}} 👋 Thanks for booking {{resource_name}} at The Village Hub for {{booking_date}}, {{start_time}}–{{end_time}}.

We're on the 1st Floor, The Foundry, Nooitgedacht Village. If you need anything before you arrive, just reply here.

— The Village Hub

### `post_visit_feedback`

Hi {{first_name}}, thanks for spending time with us at The Village Hub today.

We'd love your honest feedback on your {{resource_name}} booking. If there's anything you'd like us to follow up on, simply reply to this message.

If you'd like to share your experience publicly, you can leave an honest Google review here:
https://g.page/r/CZOda7c0eiF9EBM/review

Thank you for being part of the village 🌿
— The Village Hub

### `lead_acknowledgement`

Hi {{first_name}} 👋 Thanks for your enquiry about {{interest}} at The Village Hub. We've received it and one of our team will follow up.

If it's easier, reply here with your ideal date, team size or what you're looking for and we'll help from there.

— The Village Hub

## Data model

A separate Village Hub backend/database should contain at minimum:

### contacts
- id
- spacebring_customer_ref
- spacebring_user_ref
- first_name
- last_name
- email
- phone_e164
- company_name
- whatsapp_opt_status
- last_review_request_at
- created_at
- updated_at

### bookings
- id
- spacebring_booking_id (unique)
- spacebring_customer_ref
- contact_id
- resource_id
- resource_name
- resource_type
- booking_title
- start_at
- end_at
- status
- source
- payment_status
- payment_category
- checked_in_at
- checked_out_at
- created_at
- updated_at

### inbound_events
- id
- provider
- provider_event_id (unique)
- event_type
- entity_ref
- payload_json
- received_at
- processed_at
- processing_status
- error_text

### message_queue
- id
- booking_id
- contact_id
- template_key
- due_at
- status
- unique_key (unique; example `BOOKING_ID:post_visit`)
- payload_json
- attempts
- last_error
- created_at
- sent_at

### message_log
- id
- queue_id
- contact_id
- booking_id
- channel
- direction
- template_key
- provider_message_id (unique where present)
- status
- sent_at
- delivered_at
- read_at
- failed_at
- replied_at
- error_code
- error_text

### feedback
- id
- booking_id
- contact_id
- source
- rating_or_sentiment
- message
- needs_follow_up
- follow_up_owner
- resolved_at
- created_at

### leads
- id
- source
- campaign_id
- ad_id
- form_id
- external_lead_id
- first_name
- last_name
- email
- phone_e164
- interest
- status
- owner
- first_response_at
- created_at
- updated_at

### automation_rules
- id
- rule_key
- enabled
- resource_type
- delay_minutes
- cooldown_days
- config_json
- updated_at

## Control Room dashboard

The existing Village Hub dashboard visual system should become a unified internal Control Room with the following areas.

### Today
- bookings now
- next arrivals
- rooms/desks in use
- follow-ups due
- unresolved customer issues

### Communications
- queued
- sent
- delivered
- read
- replied
- failed
- filter by booking/resource/customer/date/template

### Experience
- recent feedback
- follow-up required
- review requests sent
- review-request cooldown state
- issue resolution time

### Leads
- Meta lead ads
- website enquiries
- response-time clock
- lead source/campaign
- funnel status
- team owner

### Spacebring
- booking volume
- resource usage
- booking revenue where available
- subscriptions/invoices later

### Automations
- rule toggles
- message timing
- template status
- review cooldown
- excluded users/resources

### System health
- last Spacebring webhook
- last reconciliation run
- last successful WhatsApp send
- last Meta delivery webhook
- failed jobs
- missing phone numbers

## Security and privacy

- Never expose Spacebring API credentials, Meta access tokens, Supabase secret/service keys or webhook secrets to browser JavaScript.
- All provider credentials must be server-side environment secrets.
- Webhook signatures must be verified before payloads are accepted.
- The Control Room must require authenticated internal access before live customer data is exposed.
- Store only data needed for the operational workflow.
- Keep the public website and customer-facing pages separate from the internal data APIs.
- Maintain an immutable event/message audit trail where practical.

## Environment variables

Names only; no secret values belong in GitHub:

- `SPACEBRING_API_KEY`
- `SPACEBRING_WEBHOOK_SECRET`
- `SPACEBRING_LOCATION_ID`
- `META_WABA_ID`
- `META_PHONE_NUMBER_ID`
- `META_ACCESS_TOKEN`
- `META_WEBHOOK_VERIFY_TOKEN`
- `META_APP_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `CONTROL_ROOM_ALLOWED_USERS`
- `GOOGLE_REVIEW_URL`

## Build phases

### Phase 1 — Foundation
- Create a separate Village Hub database/backend.
- Create tables, constraints, indexes and RLS/security model.
- Add webhook receiver and event audit trail.
- Add booking/contact upsert logic.
- Add message queue and idempotency rules.

### Phase 2 — WhatsApp
- Connect Village Hub WhatsApp Business number through Meta Cloud API.
- Submit/approve operational templates.
- Add outbound sender.
- Add Meta delivery/read/failure/reply webhook.
- Add message-log reconciliation.

### Phase 3 — Control Room
- Extend the current internal dashboard style into the Control Room.
- Add authenticated data endpoints.
- Add Today, Communications, Experience, Leads, Automations and System Health screens.

### Phase 4 — Lead engine
- Connect Meta Lead Ads webhook.
- Connect website enquiry forms.
- Add dedupe, assignment and response-time tracking.
- Add optional campaign-performance widgets from existing ad reporting.

### Phase 5 — Optimisation
- recurring-member suppression rules
- review-request cooldown
- first-visit logic
- no-response tasks
- conversion reporting from lead -> tour -> Spacebring customer -> paid booking
- optional reactivation and membership marketing flows with appropriate consent

## Definition of done

The system is considered operational when a real test booking can complete this trace end to end:

1. Spacebring booking occurs.
2. Webhook is received and verified.
3. Booking/contact appears in the Control Room.
4. Welcome WhatsApp is queued and sent once.
5. Meta delivery/read state updates in the Control Room.
6. Booking end/checkout creates the post-visit message at the correct time.
7. Review request is logged and cooldown applied.
8. Customer reply appears and, where needed, creates a follow-up item.
9. Cancellation/update tests correctly cancel/reschedule pending messages.
10. A test ad/website lead enters the same lead inbox and receives the configured acknowledgement.
