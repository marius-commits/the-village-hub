-- Make webhook/ingest dedupe keys compatible with Supabase upsert(onConflict).
-- PostgreSQL UNIQUE indexes allow multiple NULL values, so partial predicates are unnecessary.

drop index if exists public.contacts_spacebring_user_uq;
create unique index contacts_spacebring_user_uq on public.contacts(spacebring_user_ref);

drop index if exists public.leads_external_uq;
create unique index leads_external_uq on public.leads(source, external_lead_id);

drop index if exists public.message_log_provider_message_uq;
create unique index message_log_provider_message_uq on public.message_log(provider_message_id);
