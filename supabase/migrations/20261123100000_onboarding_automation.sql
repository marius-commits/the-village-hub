-- Onboarding automation: what happened to an application after Approve.
--
-- Additive only. Two nullable columns and one index. Nothing is dropped,
-- no row is changed, nothing is sent.
--
--   onboarding        every automated step with its timestamp and the
--                     Spacebring reference it produced, plus the last error
--   onboarding_state  null (not started / done by hand) | in_progress |
--                     needs_attention | complete
--
-- The staff page draws its progress bar from these. The scheduled
-- onboarding-sync function reads onboarding_state to find work.

begin;

alter table public.applications
  add column if not exists onboarding jsonb,
  add column if not exists onboarding_state text;

create index if not exists applications_onboarding_state_idx
  on public.applications (onboarding_state)
  where onboarding_state is not null;

commit;
