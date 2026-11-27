-- Boardroom bookings taken through villagehub.co.za/book-boardroom.
--
-- Additive only: two new tables, one trigger function, three policies.
-- No existing table, row, column or function is changed.
--
--   boardroom_bookings        one row per request (instant booking or quote)
--   boardroom_booking_events  append-only trail of what happened to it
--
-- References are BR-YYYY-NNNN, numbered from the same sequence as VO-, ST-
-- and DK- so no two references anywhere share a number.

create table if not exists public.boardroom_bookings (
  id                    uuid primary key default gen_random_uuid(),
  reference             text unique,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  route                 text not null check (route in ('instant', 'quote')),
  status                text not null default 'received'
                        check (status in ('quote_requested', 'received', 'held', 'confirmed',
                                          'released', 'cancelled', 'clash', 'needs_attention')),
  mode                  text not null default 'off' check (mode in ('off', 'dry', 'live')),

  room_key              text check (room_key in ('boardroom', 'chamber')),
  room_title            text,
  resource_ref          uuid,
  starts_at             timestamptz not null,
  ends_at               timestamptz not null,
  guests                integer not null check (guests between 1 and 60),

  meeting_type          text not null,
  needs                 jsonb not null default '[]'::jsonb,
  catering              text not null default 'none' check (catering in ('none', 'own', 'village_table')),
  catering_notes        text,
  notes                 text,
  quote_reasons         jsonb,

  billing               text not null default 'personal' check (billing in ('personal', 'company')),
  company_name          text,
  company_vat           text,
  first_name            text not null,
  last_name             text not null,
  email                 text not null,
  phone                 text not null,

  rate                  numeric(10,2),
  amount_ex_vat         numeric(10,2),
  amount_incl_vat       numeric(10,2),
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

  constraint boardroom_bookings_times_chk check (ends_at > starts_at)
);

comment on table public.boardroom_bookings is
  'Boardroom requests from the website. Spacebring stays the calendar and the billing system; this table is the intake record and the state of the hold.';
comment on column public.boardroom_bookings.status is
  'quote_requested: a person must price it. received: saved, hold not yet made. held: room held and invoice issued in Spacebring. confirmed: invoice paid. released: unpaid hold lapsed. clash: slot was taken between the form and the hold.';

create index if not exists boardroom_bookings_starts_idx on public.boardroom_bookings (starts_at);
create index if not exists boardroom_bookings_status_idx on public.boardroom_bookings (status);
create index if not exists boardroom_bookings_email_idx  on public.boardroom_bookings (lower(email));

create table if not exists public.boardroom_booking_events (
  id          bigint generated always as identity primary key,
  booking_id  uuid not null references public.boardroom_bookings (id) on delete cascade,
  created_at  timestamptz not null default now(),
  event_type  text not null,
  actor       text not null default 'system',
  detail      jsonb
);

create index if not exists boardroom_booking_events_booking_idx
  on public.boardroom_booking_events (booking_id, created_at);

create or replace function public.set_boardroom_booking_reference()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'INSERT' and (new.reference is null or new.reference = '') then
    new.reference := 'BR-' || to_char(now(), 'YYYY') || '-'
                  || lpad(nextval('application_ref_seq')::text, 4, '0');
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists boardroom_bookings_reference on public.boardroom_bookings;
create trigger boardroom_bookings_reference
  before insert or update on public.boardroom_bookings
  for each row execute function public.set_boardroom_booking_reference();

-- Nothing is readable by the public or by an ordinary signed-in user. The
-- website writes through Netlify functions holding the service role, which
-- bypasses RLS. Approved staff may read, the same check as every other table.
alter table public.boardroom_bookings       enable row level security;
alter table public.boardroom_booking_events enable row level security;

drop policy if exists boardroom_bookings_staff_read on public.boardroom_bookings;
create policy boardroom_bookings_staff_read on public.boardroom_bookings
  for select to authenticated using (public.is_approved_staff());

drop policy if exists boardroom_booking_events_staff_read on public.boardroom_booking_events;
create policy boardroom_booking_events_staff_read on public.boardroom_booking_events
  for select to authenticated using (public.is_approved_staff());

revoke all on public.boardroom_bookings, public.boardroom_booking_events from anon;
