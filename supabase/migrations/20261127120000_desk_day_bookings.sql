-- Hot desk bookings by the hour, half day or full day, taken through
-- villagehub.co.za/hot-desk-stellenbosch.
--
-- Additive only: two new tables, one trigger function, two read policies.
-- No existing table, row, column or function is changed.
--
-- References are HD-YYYY-NNNN, from the same sequence as VO-, ST-, DK- and
-- BR- so no two references anywhere share a number.

create table if not exists public.desk_day_bookings (
  id                    uuid primary key default gen_random_uuid(),
  reference             text unique,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  status                text not null default 'received'
                        check (status in ('received', 'held', 'confirmed', 'released', 'cancelled', 'clash', 'needs_attention')),
  mode                  text not null default 'off' check (mode in ('off', 'dry', 'live')),

  product               text not null check (product in ('hour', 'half', 'day')),
  product_title         text not null,
  resource_ref          uuid not null,
  starts_at             timestamptz not null,
  ends_at               timestamptz not null,
  seats                 integer not null default 1 check (seats between 1 and 8),

  billing               text not null default 'personal' check (billing in ('personal', 'company')),
  company_name          text,
  company_vat           text,
  first_name            text not null,
  last_name             text not null,
  email                 text not null,
  phone                 text not null,
  notes                 text,

  amount_ex_vat         numeric(10,2) not null,
  amount_incl_vat       numeric(10,2) not null,
  hold_expires_at       timestamptz,
  paid_at               timestamptz,

  spacebring            jsonb not null default '{}'::jsonb,
  steps                 jsonb not null default '{}'::jsonb,
  attention             jsonb,

  popia_consent_at      timestamptz not null,
  popia_consent_version text not null,
  notified_at           timestamptz,
  source_page           text,
  utm                   jsonb,

  constraint desk_day_bookings_times_chk check (ends_at > starts_at)
);

comment on table public.desk_day_bookings is
  'Hot desk bookings by the hour, half day or full day from the website. Spacebring stays the calendar and billing system; this is the intake record and the state of the hold.';

create index if not exists desk_day_bookings_starts_idx on public.desk_day_bookings (starts_at);
create index if not exists desk_day_bookings_status_idx on public.desk_day_bookings (status);
create index if not exists desk_day_bookings_email_idx  on public.desk_day_bookings (lower(email));

create table if not exists public.desk_day_booking_events (
  id          bigint generated always as identity primary key,
  booking_id  uuid not null references public.desk_day_bookings (id) on delete cascade,
  created_at  timestamptz not null default now(),
  event_type  text not null,
  actor       text not null default 'system',
  detail      jsonb
);

create index if not exists desk_day_booking_events_booking_idx
  on public.desk_day_booking_events (booking_id, created_at);

create or replace function public.set_desk_day_booking_reference()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'INSERT' and (new.reference is null or new.reference = '') then
    new.reference := 'HD-' || to_char(now(), 'YYYY') || '-'
                  || lpad(nextval('application_ref_seq')::text, 4, '0');
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists desk_day_bookings_reference on public.desk_day_bookings;
create trigger desk_day_bookings_reference
  before insert or update on public.desk_day_bookings
  for each row execute function public.set_desk_day_booking_reference();

alter table public.desk_day_bookings       enable row level security;
alter table public.desk_day_booking_events enable row level security;

drop policy if exists desk_day_bookings_staff_read on public.desk_day_bookings;
create policy desk_day_bookings_staff_read on public.desk_day_bookings
  for select to authenticated using (public.is_approved_staff());

drop policy if exists desk_day_booking_events_staff_read on public.desk_day_booking_events;
create policy desk_day_booking_events_staff_read on public.desk_day_booking_events
  for select to authenticated using (public.is_approved_staff());
