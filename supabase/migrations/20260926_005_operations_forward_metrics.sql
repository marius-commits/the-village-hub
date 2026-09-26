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
      ),0)::numeric(14,2) as starting_mrr_7d
    from public.spacebring_subscriptions
  )
  select jsonb_build_object(
    'office_count', o.office_count,
    'office_capacity', o.office_capacity,
    'occupied_offices', o.occupied_offices,
    'available_offices', greatest(o.office_count - o.occupied_offices, 0),
    'assigned_capacity', o.assigned_capacity,
    'office_occupancy_pct', case when o.office_capacity > 0 then round((o.assigned_capacity::numeric / o.office_capacity::numeric) * 100, 1) else 0 end,
    'office_rack_capacity', o.office_rack_capacity,
    'active_mrr', s.active_mrr,
    'scheduled_mrr', s.scheduled_mrr,
    'starting_mrr_7d', s.starting_mrr_7d,
    'expiring_mrr_7d', s.expiring_mrr_7d,
    'projected_mrr_7d', (s.active_mrr + s.starting_mrr_7d - s.expiring_mrr_7d)::numeric(14,2),
    'active_paid_subscriptions', s.active_paid_subscriptions,
    'scheduled_paid_subscriptions', s.scheduled_paid_subscriptions,
    'unlinked_active_office_subscriptions', s.unlinked_active_office_subscriptions,
    'pending_assignment_subscriptions', s.pending_assignment_subscriptions,
    'resource_sync_at', (select max(synced_at) from public.spacebring_resources),
    'subscription_sync_at', (select max(synced_at) from public.spacebring_subscriptions)
  )
  from office_stats o cross join sub_stats s;
$$;
revoke all on function public.control_room_operations_summary() from public, anon, authenticated;
grant execute on function public.control_room_operations_summary() to service_role;
