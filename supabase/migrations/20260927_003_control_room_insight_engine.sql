-- Village Hub Control Room intelligence layer
-- Keeps the live Supabase project and feature branch in sync.

create or replace function public.control_room_operations_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with office_stats as (
    select
      count(*)::int as office_count,
      coalesce(sum(capacity),0)::int as office_capacity,
      count(*) filter (where assigned_capacity > 0)::int as occupied_offices,
      coalesce(sum(assigned_capacity),0)::int as assigned_capacity,
      coalesce(sum(rack_price),0)::numeric(14,2) as office_rack_capacity
    from public.spacebring_resources
    where resource_type = 'office'
  ), sub_stats as (
    select
      coalesce(sum(price) filter (where status = 'active' and period = 'month' and price > 0),0)::numeric(14,2) as active_mrr,
      coalesce(sum(price) filter (where status = 'scheduled' and period = 'month' and price > 0),0)::numeric(14,2) as scheduled_mrr,
      count(*) filter (where status = 'active' and period = 'month' and price > 0)::int as active_paid_subscriptions,
      count(*) filter (where status = 'scheduled' and period = 'month' and price > 0)::int as scheduled_paid_subscriptions,
      count(*) filter (where status = 'active' and price > 0 and mapping_status = 'unlinked_office')::int as unlinked_active_office_subscriptions,
      count(*) filter (where status = 'scheduled' and price > 0 and mapping_status = 'pending_assignment')::int as pending_assignment_subscriptions,
      coalesce(sum(price) filter (
        where status = 'active' and period = 'month' and price > 0
          and end_at is not null and end_at > now() and end_at <= now() + interval '7 days'
      ),0)::numeric(14,2) as expiring_mrr_7d,
      coalesce(sum(price) filter (
        where status = 'scheduled' and period = 'month' and price > 0
          and start_at is not null and start_at <= now() + interval '7 days'
      ),0)::numeric(14,2) as starting_mrr_7d,
      coalesce(sum(price) filter (
        where status = 'active' and period = 'month' and price > 0
          and end_at is not null and end_at > now() and end_at <= now() + interval '30 days'
      ),0)::numeric(14,2) as expiring_mrr_30d
    from public.spacebring_subscriptions
  ), concentration as (
    select coalesce(sum(price),0)::numeric(14,2) as top3_mrr
    from (
      select price
      from public.spacebring_subscriptions
      where status = 'active' and period = 'month' and price > 0
      order by price desc
      limit 3
    ) x
  )
  select jsonb_build_object(
    'office_count', o.office_count,
    'office_capacity', o.office_capacity,
    'occupied_offices', o.occupied_offices,
    'available_offices', greatest(o.office_count - o.occupied_offices, 0),
    'assigned_capacity', o.assigned_capacity,
    'unused_office_seats', greatest(o.office_capacity - o.assigned_capacity, 0),
    'office_occupancy_pct', case when o.office_capacity > 0 then round((o.assigned_capacity::numeric / o.office_capacity::numeric) * 100, 1) else 0 end,
    'office_count_occupancy_pct', case when o.office_count > 0 then round((o.occupied_offices::numeric / o.office_count::numeric) * 100, 1) else 0 end,
    'office_rack_capacity', o.office_rack_capacity,
    'active_mrr', s.active_mrr,
    'scheduled_mrr', s.scheduled_mrr,
    'starting_mrr_7d', s.starting_mrr_7d,
    'expiring_mrr_7d', s.expiring_mrr_7d,
    'expiring_mrr_30d', s.expiring_mrr_30d,
    'projected_mrr_7d', (s.active_mrr + s.starting_mrr_7d - s.expiring_mrr_7d)::numeric(14,2),
    'net_mrr_change_7d', (s.starting_mrr_7d - s.expiring_mrr_7d)::numeric(14,2),
    'net_mrr_growth_pct_7d', case when s.active_mrr > 0 then round(((s.starting_mrr_7d - s.expiring_mrr_7d) / s.active_mrr) * 100, 1) else 0 end,
    'mrr_capture_pct', case when o.office_rack_capacity > 0 then round((s.active_mrr / o.office_rack_capacity) * 100, 1) else 0 end,
    'projected_mrr_capture_pct_7d', case when o.office_rack_capacity > 0 then round(((s.active_mrr + s.starting_mrr_7d - s.expiring_mrr_7d) / o.office_rack_capacity) * 100, 1) else 0 end,
    'mrr_gap_to_rack', greatest(o.office_rack_capacity - s.active_mrr, 0)::numeric(14,2),
    'projected_mrr_gap_to_rack_7d', greatest(o.office_rack_capacity - (s.active_mrr + s.starting_mrr_7d - s.expiring_mrr_7d), 0)::numeric(14,2),
    'active_paid_subscriptions', s.active_paid_subscriptions,
    'scheduled_paid_subscriptions', s.scheduled_paid_subscriptions,
    'avg_mrr_per_paid_subscription', case when s.active_paid_subscriptions > 0 then round(s.active_mrr / s.active_paid_subscriptions, 2) else 0 end,
    'top3_mrr', c.top3_mrr,
    'top3_mrr_share_pct', case when s.active_mrr > 0 then round((c.top3_mrr / s.active_mrr) * 100, 1) else 0 end,
    'unlinked_active_office_subscriptions', s.unlinked_active_office_subscriptions,
    'pending_assignment_subscriptions', s.pending_assignment_subscriptions,
    'resource_sync_at', (select max(synced_at) from public.spacebring_resources),
    'subscription_sync_at', (select max(synced_at) from public.spacebring_subscriptions)
  )
  from office_stats o cross join sub_stats s cross join concentration c;
$$;

create or replace function public.control_room_insights()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with o as (select public.control_room_operations_summary() as j)
  select jsonb_build_array(
    jsonb_build_object(
      'key','mrr_momentum',
      'tone',case when (j->>'net_mrr_change_7d')::numeric > 0 then 'positive' else 'watch' end,
      'title',case when (j->>'net_mrr_change_7d')::numeric > 0 then 'Recurring revenue is accelerating' else 'Recurring revenue needs attention' end,
      'metric',concat(case when (j->>'net_mrr_change_7d')::numeric >= 0 then '+' else '' end,'R',to_char(abs((j->>'net_mrr_change_7d')::numeric),'FM999,999,990')),
      'detail',concat('Projected 7-day MRR is R',to_char((j->>'projected_mrr_7d')::numeric,'FM999,999,990'),' (',case when (j->>'net_mrr_growth_pct_7d')::numeric >= 0 then '+' else '' end,(j->>'net_mrr_growth_pct_7d'),'%).')
    ),
    jsonb_build_object(
      'key','capacity_headroom','tone','opportunity',
      'title','There is monetisable capacity inside the current footprint',
      'metric',concat((j->>'unused_office_seats')::int,' seats'),
      'detail',concat((j->>'available_offices')::int,' offices are fully available, while occupied offices still leave ',(j->>'unused_office_seats')::int,' seats unassigned across the office inventory.')
    ),
    jsonb_build_object(
      'key','rack_capture',
      'tone',case when (j->>'projected_mrr_capture_pct_7d')::numeric >= 80 then 'positive' else 'opportunity' end,
      'title','Rack-rate capture is improving',
      'metric',concat((j->>'projected_mrr_capture_pct_7d'),'%'),
      'detail',concat('Current recurring revenue captures ',(j->>'mrr_capture_pct'),'% of office rack potential; after known starts/expiries the projected capture is ',(j->>'projected_mrr_capture_pct_7d'),'%.')
    ),
    jsonb_build_object(
      'key','revenue_concentration',
      'tone',case when (j->>'top3_mrr_share_pct')::numeric >= 50 then 'watch' else 'neutral' end,
      'title','Watch recurring-revenue concentration',
      'metric',concat((j->>'top3_mrr_share_pct'),'%'),
      'detail',concat('The three largest active subscriptions contribute ',(j->>'top3_mrr_share_pct'),'% of active MRR. Retention conversations with major accounts deserve proactive attention.')
    ),
    jsonb_build_object(
      'key','data_hygiene',
      'tone',case when ((j->>'unlinked_active_office_subscriptions')::int + (j->>'pending_assignment_subscriptions')::int) > 0 then 'watch' else 'positive' end,
      'title',case when ((j->>'unlinked_active_office_subscriptions')::int + (j->>'pending_assignment_subscriptions')::int) > 0 then 'A few subscriptions need mapping cleanup' else 'Subscription mapping is clean' end,
      'metric',concat(((j->>'unlinked_active_office_subscriptions')::int + (j->>'pending_assignment_subscriptions')::int),' items'),
      'detail',concat((j->>'unlinked_active_office_subscriptions')::int,' active office subscriptions are unlinked and ',(j->>'pending_assignment_subscriptions')::int,' scheduled subscriptions are awaiting assignment.')
    )
  )
  from o;
$$;

revoke all on function public.control_room_insights() from public, anon, authenticated;
grant execute on function public.control_room_insights() to service_role;

create or replace function public.control_room_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'bookings_today', (select count(*) from public.bookings where status != 'canceled' and start_at >= date_trunc('day', now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg' and start_at < (date_trunc('day', now() at time zone 'Africa/Johannesburg') + interval '1 day') at time zone 'Africa/Johannesburg'),
    'in_progress', (select count(*) from public.bookings where status != 'canceled' and start_at <= now() and end_at >= now()),
    'messages_queued', (select count(*) from public.message_queue where status = 'queued'),
    'messages_failed', (select count(*) from public.message_queue where status in ('failed','dead_letter')),
    'open_feedback', (select count(*) from public.feedback where needs_follow_up = true and follow_up_status in ('open','in_progress')),
    'new_leads', (select count(*) from public.leads where status = 'new'),
    'unanswered_leads', (select count(*) from public.leads where status = 'new' and first_response_at is null),
    'last_spacebring_event', (select max(received_at) from public.inbound_events where provider = 'spacebring'),
    'last_whatsapp_event', (select max(created_at) from public.message_log where channel = 'whatsapp'),
    'operations', public.control_room_operations_summary(),
    'insights', public.control_room_insights()
  );
$$;