# Onboarding automation

What happens after staff press **Approve** on a membership application.

## The flow

| Stage | Who | What happens |
|---|---|---|
| Documents checked | Staff | Each document is opened, then ticked **Checked**. Approve stays locked until all are ticked. |
| Approved | Staff | One click. The client gets the approval email. |
| Set up in Spacebring | Automatic | Company created (legal name with CIPC number, VAT number, KYC note). Member created and invited to the app. |
| Agreement sent | Automatic | Virtual office only. Agreement drafted from the template and issued for e-signature. Registered address or Virtual Pro uses the template with the mandate annexure. |
| Agreement signed | Client | Spacebring creates the subscription and the first invoice. |
| Invoice sent / paid | Client | Followed every 15 minutes by `onboarding-sync`. |
| Paid and live | Automatic | Application marked activated. Welcome email to the client with the exact address wording. |
| Mail desk told | Automatic | Email to the mail desk with the company names, contact and the legal-mail rule. |

Student plans skip the agreement: member, then subscription and first invoice.

If any step fails the run stops, the application shows **Needs attention** with the reason, and staff are emailed. Finished steps are never repeated. **Retry set-up** carries on from the step that failed.

Every email to a client is blind-copied to `hello@villagehub.co.za`. Emails Spacebring sends itself (app invitation, agreement, invoice) cannot be copied from here.

## Netlify environment variables

| Variable | Value |
|---|---|
| `SPACEBRING_PROVISIONING` | `off` (default), `dry` (records the steps, sends nothing) or `live` |
| `SPACEBRING_CLIENT_ID` | Spacebring > Network settings > Developers (owner only, needs the API & webhooks add-on) |
| `SPACEBRING_CLIENT_SECRET` | Same page. Enter it in Netlify yourself; it must never be pasted into chat or committed. |
| `SPACEBRING_TEMPLATE_VIRTUAL_OFFICE` | Id of the "Virtual Office Agreement" contract template |
| `SPACEBRING_TEMPLATE_VIRTUAL_OFFICE_REGISTERED` | Id of the agreement template with the registered address mandate |
| `MAIL_DESK_EMAILS` | Comma-separated. Who runs the mail desk. Unset: the notice goes to the staff list. |

## Going live

1. Apply `supabase/migrations/20261123100000_onboarding_automation.sql` (two nullable columns, one index).
2. Merge and deploy. With `SPACEBRING_PROVISIONING` unset nothing automatic happens; the document ticks, progress bar and BCC rule are live straight away.
3. Upload both agreement templates in Spacebring (Location settings > Billing > Contracts) and set the two template ids.
4. Set the client id and secret, set `SPACEBRING_PROVISIONING=dry`, approve a test application and read the recorded steps.
5. Set `live` and run one internal test application end to end, watching Spacebring, before the first real client.

## Not verified against the live API yet

Written from Spacebring's published API reference and from real records read through the connector. No write call has been made. Watch these on the first live run:

- Whether creating a member whose email already exists is refused. The flow treats a refusal as "already a member" for companies and carries on.
- Whether a contract item created from a plan carries the plan's 3-month commitment.
- That the first invoice is issued when the agreement is signed and the start date has arrived.
