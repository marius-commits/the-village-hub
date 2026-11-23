-- Company vetting recorded against an application (registry check done in
-- Lexis WinDeed before approval). Additive: one nullable column.
alter table public.applications
  add column if not exists vetting jsonb;
