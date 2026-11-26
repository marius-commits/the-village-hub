-- Desk sign-ups as a third application type.
--
-- Additive only. One new enum value and a new reference prefix. No row is
-- changed, no column is added, nothing is dropped.
--
--   application_type  gains 'desk'
--   reference         desk sign-ups are numbered DK-YYYY-NNNN from the same
--                     sequence as VO- and ST-, so numbers never collide
--
-- The function compares type as text so it can be replaced in the same
-- migration that adds the enum value.

alter type public.application_type add value if not exists 'desk';

create or replace function public.set_application_reference()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.reference is null or new.reference = '' then
    new.reference := case new.type::text
                       when 'virtual_office' then 'VO-'
                       when 'desk' then 'DK-'
                       else 'ST-'
                     end
                   || to_char(now(), 'YYYY') || '-'
                   || lpad(nextval('application_ref_seq')::text, 4, '0');
  end if;

  -- Default retention: five years from submission for approved/activated
  -- applicants (FICA record-keeping), reviewed sooner for the rest.
  if new.retention_review_date is null then
    new.retention_review_date := (now() + interval '5 years')::date;
  end if;

  return new;
end;
$function$;
