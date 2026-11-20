-- Command centre access, lead follow-up fields, and one staff check.
--
-- Apply this in the Supabase SQL editor (or via the Supabase CLI) for project
-- lcrjcdlydlfrohtppmky BEFORE relying on the new admin tabs. It only adds
-- columns, widens one check, and replaces functions. It does not drop tables,
-- delete rows, or send messages.
--
-- After it runs:
--   * marius@brick-field.co.za is the owner
--   * christel@villagehub.co.za and francois@brick-field.co.za stay approved admins
--   * don@villagehub.co.za stays inactive (status revoked)
--   * public.is_approved_staff() is the single check for staff
--   * public.wa_approvers is kept in step by a trigger, so the existing
--     WhatsApp edge functions (wa-approvals, wa-inbox-reply) and the GitHub
--     Pages tools keep working without a redeploy

begin;

-- ---------------------------------------------------------------------------
-- staff_access: pending / approved / revoked, plus who approved them
-- ---------------------------------------------------------------------------

alter table public.staff_access
  add column if not exists status text,
  add column if not exists requested_at timestamptz,
  add column if not exists approved_by text,
  add column if not exists approved_at timestamptz;

update public.staff_access
set status = 'approved',
    requested_at = coalesce(requested_at, created_at),
    approved_at = coalesce(approved_at, created_at),
    approved_by = coalesce(approved_by, 'marius@brick-field.co.za')
where active = true
  and status is null;

update public.staff_access
set status = 'revoked',
    active = false,
    requested_at = coalesce(requested_at, created_at)
where active = false
  and status is null;

update public.staff_access
set role = 'owner',
    status = 'approved',
    active = true
where lower(email) = 'marius@brick-field.co.za';

update public.staff_access
set role = 'admin',
    status = 'approved',
    active = true
where lower(email) in ('christel@villagehub.co.za', 'francois@brick-field.co.za');

update public.staff_access
set role = 'reviewer',
    status = 'revoked',
    active = false
where lower(email) = 'don@villagehub.co.za';

alter table public.staff_access
  alter column status set default 'pending';

alter table public.staff_access
  alter column status set not null;

alter table public.staff_access
  drop constraint if exists staff_access_status_chk;

alter table public.staff_access
  add constraint staff_access_status_chk
  check (status in ('pending', 'approved', 'revoked'));

alter table public.staff_access
  drop constraint if exists staff_access_role_chk;

alter table public.staff_access
  add constraint staff_access_role_chk
  check (role in ('owner', 'admin', 'reviewer'));

comment on column public.staff_access.status is
  'pending: signed up, waiting for Marius. approved: can use the command centre. revoked: refused or removed.';

-- ---------------------------------------------------------------------------
-- One check. Existing RLS policies call is_active_staff(), so they follow.
-- Pending and revoked staff fail it, including leads, applications and
-- WhatsApp contact reads.
-- ---------------------------------------------------------------------------

create or replace function public.is_approved_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.staff_access
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and active
      and status = 'approved'
  );
$$;

comment on function public.is_approved_staff() is
  'True when the signed-in email is an approved, active row in staff_access. Source of truth for admin and WhatsApp.';

create or replace function public.is_active_staff()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select public.is_approved_staff();
$$;

revoke all on function public.is_approved_staff() from public;
grant execute on function public.is_approved_staff() to anon, authenticated, service_role;
grant execute on function public.is_active_staff() to anon, authenticated, service_role;
grant execute on function public.wa_backlog_is_approver() to authenticated, service_role;

-- Backlog RPCs on the old GitHub Pages tool call this. Approved staff pass,
-- and a still-active wa_approvers row passes too, so nothing locks out
-- between this migration and the trigger below.
create or replace function public.wa_backlog_is_approver()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_approved_staff()
      or exists (
        select 1
        from public.wa_approvers
        where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
          and active
      );
$$;

-- Keep wa_approvers aligned with staff_access so wa-approvals and
-- wa-inbox-reply (which still read wa_approvers) do not drift.
create or replace function public.sync_wa_approver_from_staff()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'approved' and new.active then
    insert into public.wa_approvers (email, name, active)
    values (lower(new.email), coalesce(new.full_name, split_part(new.email, '@', 1)), true)
    on conflict (email) do update
      set active = true,
          name = excluded.name;
  else
    update public.wa_approvers
    set active = false
    where lower(email) = lower(new.email);
  end if;
  return new;
end;
$$;

drop trigger if exists staff_access_sync_wa_approver on public.staff_access;

create trigger staff_access_sync_wa_approver
  after insert or update of status, active, full_name, email
  on public.staff_access
  for each row
  execute function public.sync_wa_approver_from_staff();

insert into public.wa_approvers (email, name, active)
select lower(email), coalesce(full_name, split_part(email, '@', 1)), true
from public.staff_access
where status = 'approved' and active
on conflict (email) do update
  set active = true,
      name = excluded.name;

update public.wa_approvers a
set active = false
from public.staff_access s
where lower(a.email) = lower(s.email)
  and not (s.status = 'approved' and s.active);

-- ---------------------------------------------------------------------------
-- Leads: last contact, channel, and the next action
-- ---------------------------------------------------------------------------

alter table public.leads
  add column if not exists last_contacted_at timestamptz,
  add column if not exists last_contact_channel text,
  add column if not exists next_action text,
  add column if not exists next_action_at timestamptz;

alter table public.leads
  drop constraint if exists leads_last_contact_channel_chk;

alter table public.leads
  add constraint leads_last_contact_channel_chk
  check (
    last_contact_channel is null
    or last_contact_channel in ('call', 'whatsapp', 'email')
  );

comment on column public.leads.last_contact_channel is
  'call, whatsapp or email. Set by the Called / WhatsApped / Emailed buttons.';

-- ---------------------------------------------------------------------------
-- Marketing reviews: keep the old name picker working, and allow the real
-- signed-in email from the command centre. The anon insert policy is
-- unchanged, so the GitHub Pages site can still write Marius / Christel /
-- Francois with the publishable key.
-- ---------------------------------------------------------------------------

alter table public.marketing_caption_reviews
  add column if not exists reviewer_email text;

alter table public.marketing_caption_reviews
  drop constraint if exists marketing_caption_reviews_reviewer_chk;

alter table public.marketing_caption_reviews
  add constraint marketing_caption_reviews_reviewer_chk
  check (
    reviewer = any (array['Marius', 'Christel', 'Francois'])
    or reviewer ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  );

comment on column public.marketing_caption_reviews.reviewer_email is
  'Signed-in staff email when the review comes from the command centre. Null for older name-picker rows.';

commit;
