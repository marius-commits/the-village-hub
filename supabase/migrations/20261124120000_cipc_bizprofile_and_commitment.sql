-- CIPC BizPortal BizProfile PDFs, and the commitment the applicant chose.
--
-- Additive only. The new enum value is not inserted in this file (Postgres
-- will not let a transaction use a value added in the same transaction).
-- commitment_months defaults to 3, the virtual office minimum. Allowed
-- choices are 3, 6 and 12. Existing rows read as 3.

alter type document_type add value if not exists 'cipc_bizprofile';

alter table public.applications
  add column if not exists commitment_months integer default 3;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'applications_commitment_months_check'
  ) then
    alter table public.applications
      add constraint applications_commitment_months_check
      check (commitment_months is null or commitment_months in (3, 6, 12));
  end if;
end $$;
