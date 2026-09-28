-- Village Hub Control Room hardening + FK covering indexes
-- Applied to project vmvbmqxbnltcixjlybzk on 2026-09-26.

revoke execute on function public.is_control_room_admin() from authenticated;
drop policy if exists "admins_read_automation_rules" on public.automation_rules;
drop policy if exists "admins_read_system_health" on public.system_health;

create policy "deny_client_access" on public.control_room_admins for all to anon, authenticated using (false) with check (false);
create policy "deny_client_access" on public.contacts for all to anon, authenticated using (false) with check (false);
create policy "deny_client_access" on public.bookings for all to anon, authenticated using (false) with check (false);
create policy "deny_client_access" on public.inbound_events for all to anon, authenticated using (false) with check (false);
create policy "deny_client_access" on public.message_queue for all to anon, authenticated using (false) with check (false);
create policy "deny_client_access" on public.message_log for all to anon, authenticated using (false) with check (false);
create policy "deny_client_access" on public.feedback for all to anon, authenticated using (false) with check (false);
create policy "deny_client_access" on public.leads for all to anon, authenticated using (false) with check (false);
create policy "deny_client_access" on public.automation_rules for all to anon, authenticated using (false) with check (false);
create policy "deny_client_access" on public.system_health for all to anon, authenticated using (false) with check (false);
create policy "deny_client_access" on public.ad_campaign_daily for all to anon, authenticated using (false) with check (false);
create policy "deny_client_access" on public.attribution_events for all to anon, authenticated using (false) with check (false);

create index if not exists attribution_events_booking_idx on public.attribution_events(booking_id);
create index if not exists attribution_events_contact_idx on public.attribution_events(contact_id);
create index if not exists feedback_booking_idx on public.feedback(booking_id);
create index if not exists feedback_contact_idx on public.feedback(contact_id);
create index if not exists leads_converted_booking_idx on public.leads(converted_booking_id);
create index if not exists leads_converted_contact_idx on public.leads(converted_contact_id);
create index if not exists message_log_booking_idx on public.message_log(booking_id);
create index if not exists message_log_queue_idx on public.message_log(queue_id);
create index if not exists message_queue_booking_idx on public.message_queue(booking_id);
create index if not exists message_queue_lead_idx on public.message_queue(lead_id);
