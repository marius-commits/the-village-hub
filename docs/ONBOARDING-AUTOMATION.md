# Onboarding automation

What happens after staff press **Approve** on a membership application.

## The flow

| Stage | Who | What happens |
|---|---|---|
| Documents checked | Staff | Each document is opened, then ticked **Checked**. Approve stays locked until all are ticked. |
| Company vetted | Staff | Virtual office. CIPC BizPortal BizProfile is recorded on the application, and the PDF is stored with it. Optional unless `VETTING_REQUIRED=true`. |
| Approved | Staff | One click. The client gets the approval email. |
| Set up in Spacebring | Automatic | Company created with the registered name from the BizProfile when one was recorded (legal name with CIPC number, VAT number, KYC note). Member created and invited to the app. |
| Agreement sent | Automatic | Virtual office only. Agreement drafted from the template and issued for e-signature. Start date is the applicant's date when it is still ahead, otherwise the approval date. The agreement end date is that start plus the commitment (3, 6 or 12 months). Registered address or Virtual Pro uses the template with the mandate annexure. |
| Agreement signed | Client | Spacebring creates the subscription and the first invoice. |
| Commitment and add-on | Automatic | The plan item's commitment is set to the months the applicant chose. The subscription is not given an end date, so it continues month to month after the minimum. Village Address and Village Virtual with a registered address also get the R250/month excl. VAT add-on. Village Virtual Pro includes that address, so no add-on line is added. |
| Invoice sent / paid | Client | Followed every 15 minutes by `onboarding-sync`. |
| Paid and live | Automatic | Application marked activated. Welcome email to the client with the exact address wording, using the registered name. |
| Mail desk told | Automatic | Email to the mail desk with the company names, contact and the legal-mail rule. |

Student plans skip the agreement: member, then subscription and first invoice.

If any step fails the run stops, the application shows **Needs attention** with the reason, and staff are emailed. Finished steps are never repeated. **Retry set-up** carries on from the step that failed.

Every email to a client is blind-copied to `hello@villagehub.co.za`. Emails Spacebring sends itself (app invitation, agreement, invoice) cannot be copied from here.

## CIPC BizPortal BizProfile

Staff open [CIPC BizPortal](https://www.bizportal.gov.za/), download the BizProfile PDF, and record it on the application:

- `applications.vetting` keeps `cipc_name`, `company_active`, `director_listed`, `notes`, `checked_by`, `checked_at`.
- Optional structured fields: `source` (default `CIPC BizPortal BizProfile`), `enterprise_number`, `enterprise_status`, `directors`, `registered_address`, `annual_returns_note`, `document_id`, `storage_path`.
- The PDF is uploaded by staff into the private `kyc-documents` bucket at `applications/{application_id}/cipc_bizprofile-{rand}.pdf`, with an `application_documents` row (`doc_type = cipc_bizprofile`, `verified = true`). Open and Download use the same signed-URL viewer as the other documents.
- Older rows may still say `Lexis WinDeed company search`. They still pass or fail on the same three facts. Saving the check again records it as a BizPortal check and keeps the attached PDF.

The name on the BizProfile (`vetting.cipc_name`) is the legal name sent to Spacebring, so a typo on the form is not what the agreement or the invoice prints. A trading name, when they gave one, stays the company title.

## Start date and commitment

The virtual office form asks for both before the personal details.

- **Start date** (`preferred_start_date`). Used as the Spacebring contract and subscription start when it is still in the future. Blank or already past at approval becomes the approval date (today in SAST).
- **Commitment** (`commitment_months`): 3 (the minimum, and the default), 6 or 12. The contract `endDate` is the start plus that many months. Contract items cannot carry `commitmentCycles` (the API types are plan, resource and oneOff), so once the signature has created the subscription the plan item's `commitmentCycles` is set to the same number. The subscription itself is not ended on that date.

## Registered address, R250/month

On Village Address and Village Virtual, using The Village Hub as the registered CIPC and SARS address is **R250/month excl. VAT, 3-month minimum**. It is **included with Village Virtual Pro**.

Spacebring's contract API cannot add a recurring shop line (only plan, resource or oneOff). The Monthly option of the shop product `Registered Address (CIPC / SARS)` is therefore added with `createSubscriptionItem` when the subscription exists, type `recurring`, price 250, commitment equal to the applicant's commitment (at least 3). If that item is already on the subscription it is not added again. The product description in Spacebring may still say 12 months; the charge this automation writes is the 3-month minimum (or the longer commitment the applicant chose).

## Netlify environment variables

| Variable | Value |
|---|---|
| `SPACEBRING_PROVISIONING` | `off` (default), `dry` (records the steps, sends nothing) or `live` |
| `SPACEBRING_CLIENT_ID` | Spacebring > Network settings > Developers (owner only, needs the API & webhooks add-on) |
| `SPACEBRING_CLIENT_SECRET` | Same page. Enter it in Netlify yourself; it must never be pasted into chat or committed. |
| `SPACEBRING_TEMPLATE_VIRTUAL_OFFICE` | Id of the "Virtual Office Agreement" contract template |
| `SPACEBRING_TEMPLATE_VIRTUAL_OFFICE_REGISTERED` | Id of the agreement template with the registered address mandate |
| `SPACEBRING_REGISTERED_ADDRESS_PRODUCT_REF` | Optional. Defaults to the Registered Address product `a3ec6ad3-05cd-486a-98b1-104157dbfb36`. Set to `none` for a custom line with no product link. |
| `SPACEBRING_REGISTERED_ADDRESS_OPTION_REF` | Optional. The Monthly option `c7336c09-8f78-4ed5-904d-2ee89ce3397f`. Recorded for reference; the subscription item API takes the product and the price, not the option. |
| `SPACEBRING_REGISTERED_ADDRESS_PRICE` | Optional. Defaults to `250` (ZAR, excl. VAT). |
| `SPACEBRING_REGISTERED_ADDRESS_TITLE` | Optional. Defaults to `Registered Address (CIPC / SARS)`. |
| `SPACEBRING_REGISTERED_ADDRESS_COMMITMENT_CYCLES` | Optional fallback only. The applicant's commitment is what is sent. |
| `VETTING_REQUIRED` | `true` to refuse approval and set-up until a BizProfile check is recorded and has passed. Unset: the check is optional. |
| `MAIL_DESK_EMAILS` | Comma-separated. Who runs the mail desk. Unset: the notice goes to the staff list. |

## Going live

1. Apply the migrations, in order, and do not skip one:
   - `supabase/migrations/20261123100000_onboarding_automation.sql`
   - `supabase/migrations/20261123150000_application_vetting.sql`
   - `supabase/migrations/20261124120000_cipc_bizprofile_and_commitment.sql` (`cipc_bizprofile` on `document_type`, and `applications.commitment_months` defaulting to 3)
2. Merge and deploy. With `SPACEBRING_PROVISIONING` unset nothing automatic happens; the document ticks, the BizProfile upload, the progress bar and the BCC rule are live straight away.
3. Upload both agreement templates in Spacebring (Location settings > Billing > Contracts) and set the two template ids. The registered-address template should state the R250/month excl. VAT add-on and the 3-month minimum.
4. Set the client id and secret, set `SPACEBRING_PROVISIONING=dry`, approve a test application and read the recorded steps.
5. Set `live` and run one internal test application end to end, watching Spacebring, before the first real client.

## Not verified against the live API yet

Written from Spacebring's published API reference and from real records read through the connector. No write call has been made. Watch these on the first live run:

- Whether creating a member whose email already exists is refused. The flow treats a refusal as "already a member" for companies and carries on.
- That the contract `endDate` is accepted and does not also cancel the subscription. The commitment lives on the subscription item; the subscription should keep billing month to month after it.
- That the first invoice is issued when the agreement is signed and the start date has arrived. The registered-address item is billed from the next invoice after it is added, which is the same sync that sees the signature. If the first invoice was already issued without the line, add R250 to that invoice in Spacebring. Retry will not add the line a second time.
- That a BizProfile upload succeeds only after the `cipc_bizprofile` enum value is applied. Until then the upload says so and does not leave a broken row.
