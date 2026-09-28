create table if not exists public.spacebring_resources (
  resource_id uuid primary key,
  location_ref uuid not null,
  title text not null,
  resource_type text not null,
  capacity integer not null default 0,
  visibility text,
  booking_permission text,
  rack_price numeric(14,2),
  rack_period text,
  assignment_count integer not null default 0,
  assigned_capacity integer not null default 0,
  assignment_names text[] not null default '{}'::text[],
  assignment_data jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.spacebring_subscriptions (
  subscription_id uuid primary key,
  location_ref uuid not null,
  customer_ref uuid,
  customer_type text,
  customer_name text not null,
  status text not null,
  period text,
  price numeric(14,2) not null default 0,
  credits numeric(14,3) not null default 0,
  day_passes numeric(14,3) not null default 0,
  start_at timestamptz,
  end_at timestamptz,
  item_titles text[] not null default '{}'::text[],
  resource_refs uuid[] not null default '{}'::uuid[],
  mapping_status text not null default 'linked' check (mapping_status in ('linked','unlinked_office','pending_assignment','non_resource','access_only')),
  metadata jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists spacebring_resources_type_idx on public.spacebring_resources(resource_type);
create index if not exists spacebring_resources_assignment_idx on public.spacebring_resources(resource_type, assigned_capacity);
create index if not exists spacebring_subscriptions_status_idx on public.spacebring_subscriptions(status, period, price);
create index if not exists spacebring_subscriptions_customer_idx on public.spacebring_subscriptions(customer_ref);
create index if not exists spacebring_subscriptions_mapping_idx on public.spacebring_subscriptions(mapping_status) where mapping_status in ('unlinked_office','pending_assignment');

drop trigger if exists spacebring_resources_set_updated_at on public.spacebring_resources;
create trigger spacebring_resources_set_updated_at before update on public.spacebring_resources for each row execute function public.set_updated_at();
drop trigger if exists spacebring_subscriptions_set_updated_at on public.spacebring_subscriptions;
create trigger spacebring_subscriptions_set_updated_at before update on public.spacebring_subscriptions for each row execute function public.set_updated_at();

alter table public.spacebring_resources enable row level security;
alter table public.spacebring_subscriptions enable row level security;
revoke all on public.spacebring_resources, public.spacebring_subscriptions from anon, authenticated;
grant all on public.spacebring_resources, public.spacebring_subscriptions to service_role;
create policy "deny_client_access" on public.spacebring_resources for all to anon, authenticated using (false) with check (false);
create policy "deny_client_access" on public.spacebring_subscriptions for all to anon, authenticated using (false) with check (false);

create or replace function public.control_room_operations_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with office_stats as (
    select count(*)::int as office_count,
      coalesce(sum(capacity),0)::int as office_capacity,
      count(*) filter (where assigned_capacity > 0)::int as occupied_offices,
      coalesce(sum(assigned_capacity),0)::int as assigned_capacity
    from public.spacebring_resources where resource_type = 'office'
  ), sub_stats as (
    select coalesce(sum(price) filter (where status='active' and period='month' and price>0),0)::numeric(14,2) as active_mrr,
      coalesce(sum(price) filter (where status='scheduled' and period='month' and price>0),0)::numeric(14,2) as scheduled_mrr,
      count(*) filter (where status='active' and period='month' and price>0)::int as active_paid_subscriptions,
      count(*) filter (where status='scheduled' and period='month' and price>0)::int as scheduled_paid_subscriptions,
      count(*) filter (where status='active' and price>0 and mapping_status='unlinked_office')::int as unlinked_active_office_subscriptions,
      count(*) filter (where status='scheduled' and price>0 and mapping_status='pending_assignment')::int as pending_assignment_subscriptions
    from public.spacebring_subscriptions
  )
  select jsonb_build_object(
    'office_count',o.office_count,'office_capacity',o.office_capacity,'occupied_offices',o.occupied_offices,
    'assigned_capacity',o.assigned_capacity,'office_occupancy_pct',case when o.office_capacity>0 then round((o.assigned_capacity::numeric/o.office_capacity::numeric)*100,1) else 0 end,
    'active_mrr',s.active_mrr,'scheduled_mrr',s.scheduled_mrr,'active_paid_subscriptions',s.active_paid_subscriptions,
    'scheduled_paid_subscriptions',s.scheduled_paid_subscriptions,'unlinked_active_office_subscriptions',s.unlinked_active_office_subscriptions,
    'pending_assignment_subscriptions',s.pending_assignment_subscriptions,
    'resource_sync_at',(select max(synced_at) from public.spacebring_resources),'subscription_sync_at',(select max(synced_at) from public.spacebring_subscriptions)
  ) from office_stats o cross join sub_stats s;
$$;
revoke all on function public.control_room_operations_summary() from public, anon, authenticated;
grant execute on function public.control_room_operations_summary() to service_role;

create or replace function public.control_room_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'bookings_today',(select count(*) from public.bookings where status!='canceled' and start_at>=date_trunc('day',now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg' and start_at<(date_trunc('day',now() at time zone 'Africa/Johannesburg')+interval '1 day') at time zone 'Africa/Johannesburg'),
    'in_progress',(select count(*) from public.bookings where status!='canceled' and start_at<=now() and end_at>=now()),
    'messages_queued',(select count(*) from public.message_queue where status='queued'),
    'messages_failed',(select count(*) from public.message_queue where status in ('failed','dead_letter')),
    'open_feedback',(select count(*) from public.feedback where needs_follow_up=true and follow_up_status in ('open','in_progress')),
    'new_leads',(select count(*) from public.leads where status='new'),
    'unanswered_leads',(select count(*) from public.leads where status='new' and first_response_at is null),
    'last_spacebring_event',(select max(received_at) from public.inbound_events where provider='spacebring'),
    'last_whatsapp_event',(select max(created_at) from public.message_log where channel='whatsapp'),
    'operations',public.control_room_operations_summary()
  );
$$;
revoke all on function public.control_room_summary() from public, anon, authenticated;
grant execute on function public.control_room_summary() to service_role;
