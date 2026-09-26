-- Village Hub Control Room core schema
-- Generated 2026-09-26. Designed for a dedicated Village Hub Supabase project.

create extension if not exists pgcrypto;

-- ---------- utility ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- internal access ----------
create table if not exists public.control_room_admins (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role text not null default 'admin' check (role in ('admin','operator','viewer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists control_room_admins_email_lower_uq
  on public.control_room_admins (lower(email));

create or replace function public.is_control_room_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.control_room_admins a
    where a.active = true
      and lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_control_room_admin() from public, anon;
grant execute on function public.is_control_room_admin() to authenticated, service_role;

-- ---------- contacts ----------
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  spacebring_customer_ref uuid,
  spacebring_user_ref uuid,
  first_name text,
  last_name text,
  email text,
  phone_e164 text,
  company_name text,
  whatsapp_opt_status text not null default 'unknown'
    check (whatsapp_opt_status in ('unknown','service_ok','marketing_opted_in','opted_out')),
  last_review_request_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists contacts_spacebring_user_uq
  on public.contacts(spacebring_user_ref) where spacebring_user_ref is not null;
create index if not exists contacts_phone_idx on public.contacts(phone_e164);
create index if not exists contacts_email_lower_idx on public.contacts(lower(email));

-- ---------- bookings ----------
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  spacebring_booking_id text not null unique,
  spacebring_customer_ref uuid,
  spacebring_user_ref uuid,
  contact_id uuid references public.contacts(id) on delete set null,
  resource_id uuid,
  resource_name text,
  resource_type text,
  booking_title text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'confirmed'
    check (status in ('tentative','confirmed','canceled','completed')),
  source text,
  payment_status text,
  payment_category text,
  payment_amount numeric(14,2),
  payment_currency text,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  raw_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bookings_start_idx on public.bookings(start_at);
create index if not exists bookings_end_idx on public.bookings(end_at);
create index if not exists bookings_contact_idx on public.bookings(contact_id);
create index if not exists bookings_status_idx on public.bookings(status);

-- ---------- provider event audit ----------
create table if not exists public.inbound_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  entity_ref text,
  payload_json jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_status text not null default 'received'
    check (processing_status in ('received','processed','ignored','failed')),
  error_text text,
  unique(provider, provider_event_id)
);
create index if not exists inbound_events_received_idx
  on public.inbound_events(received_at desc);
create index if not exists inbound_events_status_idx
  on public.inbound_events(processing_status, received_at);

-- ---------- outbound message queue ----------
create table if not exists public.message_queue (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  lead_id uuid,
  template_key text not null,
  due_at timestamptz not null,
  status text not null default 'queued'
    check (status in ('queued','processing','sent','canceled','failed','dead_letter')),
  unique_key text not null unique,
  payload_json jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists message_queue_due_idx
  on public.message_queue(status, due_at) where status = 'queued';
create index if not exists message_queue_contact_idx on public.message_queue(contact_id);

-- ---------- message audit ----------
create table if not exists public.message_log (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid references public.message_queue(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  channel text not null default 'whatsapp',
  direction text not null check (direction in ('outbound','inbound')),
  template_key text,
  provider_message_id text,
  status text not null default 'received'
    check (status in ('queued','sent','delivered','read','received','failed')),
  body_preview text,
  provider_payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  received_at timestamptz,
  failed_at timestamptz,
  replied_at timestamptz,
  error_code text,
  error_text text,
  created_at timestamptz not null default now()
);
create unique index if not exists message_log_provider_message_uq
  on public.message_log(provider_message_id)
  where provider_message_id is not null;
create index if not exists message_log_created_idx on public.message_log(created_at desc);
create index if not exists message_log_contact_idx on public.message_log(contact_id);

-- ---------- feedback / service recovery ----------
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  source text not null default 'whatsapp',
  rating numeric(3,1),
  sentiment text check (sentiment in ('positive','neutral','negative') or sentiment is null),
  message text,
  needs_follow_up boolean not null default false,
  follow_up_owner text,
  follow_up_status text not null default 'open'
    check (follow_up_status in ('open','in_progress','resolved','closed')),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists feedback_open_idx
  on public.feedback(needs_follow_up, follow_up_status, created_at desc);

-- ---------- leads ----------
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_lead_id text,
  campaign_id text,
  campaign_name text,
  ad_group_id text,
  ad_id text,
  form_id text,
  gclid text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  first_name text,
  last_name text,
  email text,
  phone_e164 text,
  company_name text,
  interest text,
  preferred_date date,
  message text,
  status text not null default 'new'
    check (status in ('new','contacted','tour_booked','proposal','won','lost','spam')),
  owner text,
  first_response_at timestamptz,
  converted_contact_id uuid references public.contacts(id) on delete set null,
  converted_booking_id uuid references public.bookings(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists leads_external_uq
  on public.leads(source, external_lead_id)
  where external_lead_id is not null;
create index if not exists leads_status_created_idx on public.leads(status, created_at desc);
create index if not exists leads_phone_idx on public.leads(phone_e164);
create index if not exists leads_gclid_idx on public.leads(gclid) where gclid is not null;

alter table public.message_queue
  add constraint message_queue_lead_fk
  foreign key (lead_id) references public.leads(id) on delete set null;

-- ---------- automation configuration ----------
create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null unique,
  enabled boolean not null default true,
  resource_type text,
  delay_minutes integer not null default 0,
  cooldown_days integer not null default 0,
  config_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.automation_rules(rule_key, enabled, delay_minutes, cooldown_days, config_json)
values
  ('booking_welcome', true, 0, 0,
    '{"service_message":true,"exclude_recurring_daily":true}'::jsonb),
  ('pre_arrival', false, 60, 0,
    '{"minutes_before_start":60,"minimum_lead_time_minutes":180}'::jsonb),
  ('post_visit_feedback', true, 60, 90,
    '{"meeting_delay_minutes":60,"hotdesk_mode":"checkout_or_16_30","ask_for_honest_review":true}'::jsonb),
  ('lead_acknowledgement', true, 0, 0,
    '{"service_message":true}'::jsonb),
  ('repeat_review_suppression', true, 0, 90,
    '{"cooldown_days":90}'::jsonb)
on conflict (rule_key) do nothing;

-- ---------- system health ----------
create table if not exists public.system_health (
  key text primary key,
  status text not null default 'unknown',
  last_ok_at timestamptz,
  last_event_at timestamptz,
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------- ad snapshot store ----------
create table if not exists public.ad_campaign_daily (
  id uuid primary key default gen_random_uuid(),
  platform text not null default 'google_ads',
  account_id text not null,
  campaign_id text not null,
  campaign_name text not null,
  metric_date date not null,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  cost numeric(14,4) not null default 0,
  conversions numeric(14,4) not null default 0,
  conversion_value numeric(14,4) not null default 0,
  currency_code text,
  fetched_at timestamptz not null default now(),
  unique(platform, account_id, campaign_id, metric_date)
);
create index if not exists ad_campaign_daily_date_idx on public.ad_campaign_daily(metric_date desc);

-- ---------- attribution event trail ----------
create table if not exists public.attribution_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  event_type text not null,
  event_at timestamptz not null default now(),
  source text,
  campaign_id text,
  gclid text,
  value numeric(14,2),
  currency_code text,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists attribution_events_lookup_idx
  on public.attribution_events(lead_id, contact_id, booking_id, event_at desc);

-- ---------- updated_at triggers ----------
do $$
declare
  t text;
begin
  foreach t in array array[
    'control_room_admins','contacts','bookings','message_queue',
    'feedback','leads','automation_rules','system_health'
  ]
  loop
    execute format('drop trigger if exists %I_set_updated_at on public.%I', t, t);
    execute format(
      'create trigger %I_set_updated_at before update on public.%I
       for each row execute function public.set_updated_at()', t, t
    );
  end loop;
end $$;

-- ---------- queue worker primitive ----------
create or replace function public.claim_due_messages(batch_size integer default 25)
returns setof public.message_queue
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select q.id
    from public.message_queue q
    where q.status = 'queued'
      and q.due_at <= now()
      and q.attempts < q.max_attempts
    order by q.due_at asc
    for update skip locked
    limit greatest(1, least(batch_size, 100))
  )
  update public.message_queue q
  set status = 'processing',
      locked_at = now(),
      attempts = q.attempts + 1,
      updated_at = now()
  from due
  where q.id = due.id
  returning q.*;
end;
$$;

revoke all on function public.claim_due_messages(integer) from public, anon, authenticated;
grant execute on function public.claim_due_messages(integer) to service_role;

-- Recover jobs that died mid-send. Intended for a scheduled server-side worker.
create or replace function public.requeue_stale_messages(stale_after interval default interval '10 minutes')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.message_queue
  set status = case when attempts >= max_attempts then 'dead_letter' else 'queued' end,
      locked_at = null,
      updated_at = now(),
      last_error = coalesce(last_error, 'worker lock expired')
  where status = 'processing'
    and locked_at < now() - stale_after;
  get diagnostics affected = row_count;
  return affected;
end;
$$;
revoke all on function public.requeue_stale_messages(interval) from public, anon, authenticated;
grant execute on function public.requeue_stale_messages(interval) to service_role;

-- ---------- dashboard summary RPC ----------
create or replace function public.control_room_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'bookings_today', (
      select count(*) from public.bookings
      where status != 'canceled'
        and start_at >= date_trunc('day', now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg'
        and start_at < (date_trunc('day', now() at time zone 'Africa/Johannesburg') + interval '1 day') at time zone 'Africa/Johannesburg'
    ),
    'in_progress', (
      select count(*) from public.bookings
      where status != 'canceled' and start_at <= now() and end_at >= now()
    ),
    'messages_queued', (
      select count(*) from public.message_queue where status = 'queued'
    ),
    'messages_failed', (
      select count(*) from public.message_queue where status in ('failed','dead_letter')
    ),
    'open_feedback', (
      select count(*) from public.feedback where needs_follow_up = true and follow_up_status in ('open','in_progress')
    ),
    'new_leads', (
      select count(*) from public.leads where status = 'new'
    ),
    'unanswered_leads', (
      select count(*) from public.leads where status = 'new' and first_response_at is null
    ),
    'last_spacebring_event', (
      select max(received_at) from public.inbound_events where provider = 'spacebring'
    ),
    'last_whatsapp_event', (
      select max(created_at) from public.message_log where channel = 'whatsapp'
    )
  );
$$;
revoke all on function public.control_room_summary() from public, anon, authenticated;
grant execute on function public.control_room_summary() to service_role;

-- ---------- RLS: sensitive tables are service-only by default ----------
alter table public.control_room_admins enable row level security;
alter table public.contacts enable row level security;
alter table public.bookings enable row level security;
alter table public.inbound_events enable row level security;
alter table public.message_queue enable row level security;
alter table public.message_log enable row level security;
alter table public.feedback enable row level security;
alter table public.leads enable row level security;
alter table public.automation_rules enable row level security;
alter table public.system_health enable row level security;
alter table public.ad_campaign_daily enable row level security;
alter table public.attribution_events enable row level security;

-- No anon access. The browser talks to authenticated Edge Functions, not raw tables.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Authenticated users get no direct table access either; Control Room API enforces allow-list.
revoke all on public.control_room_admins, public.contacts, public.bookings,
  public.inbound_events, public.message_queue, public.message_log, public.feedback,
  public.leads, public.automation_rules, public.system_health,
  public.ad_campaign_daily, public.attribution_events
from authenticated;

grant all on public.control_room_admins, public.contacts, public.bookings,
  public.inbound_events, public.message_queue, public.message_log, public.feedback,
  public.leads, public.automation_rules, public.system_health,
  public.ad_campaign_daily, public.attribution_events
to service_role;

-- RLS policies are deliberately narrow even though service_role bypasses RLS.
-- They become useful if selected tables are exposed to authenticated users later.
create policy "admins_read_automation_rules"
  on public.automation_rules for select to authenticated
  using (public.is_control_room_admin());
create policy "admins_read_system_health"
  on public.system_health for select to authenticated
  using (public.is_control_room_admin());

comment on schema public is 'Village Hub Control Room operational schema';
