drop policy if exists "deny_browser_finance_snapshots" on public.spacebring_finance_snapshots;
create policy "deny_browser_finance_snapshots"
on public.spacebring_finance_snapshots
for all
to anon, authenticated
using (false)
with check (false);
