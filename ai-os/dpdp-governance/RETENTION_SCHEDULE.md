# DPDP retention schedule (draft for the lawyer)

Status: DRAFT. The periods below are what the Privacy Notice (v1.6) promises and what the daily sweep (`drizzle/0724`) enforces. The sweep ships in dry-run mode (`dpdp.retention_setting.live = false`): it counts and writes a report to `dpdp.retention_run`, it deletes nothing. Going live is one owner step (see "Switching it on").

| Data | Kept for | Clock starts | Done by | Lawyer question |
|---|---|---|---|---|
| Sign-in codes (`login_token`) | 30 days | after the code expires | daily sweep | Is 30 days enough for an investigation of a sign-in complaint? |
| Sessions (`session`) | 30 days | after the session expires | daily sweep | Same. |
| E-mail confirm links (`email_token`) | 30 days | after the link expires | daily sweep | Same. |
| Log of e-mails we sent (`mail_outbound`) | 13 months | sent | daily sweep | Is 13 months right for proof of delivery of statutory notices? |
| Mail received at dpdp@ (`mail_inbound`) | open: until closed. Closed: 24 months | ticket closed | daily sweep | Grievance and rights-request limits: does 24 months cover them? |
| Network-prefix and tool records for AI links (`ai_link_seen`) | 90 days | first seen | daily sweep | None expected. |
| An ended organisation's data | 30 days after we tell the owner the export is ready | operator starts the offboarding | daily sweep, only after an export was made | Is 30 days enough notice? What must be kept for a customer after the contract ends? |
| The dated history record (`event`, `access_log`, `daily_seal`) | not deleted by the sweep or by offboarding | n/a | n/a | How long must it be kept, and may it be de-identified at the end? |
| Invoices and accounting records | the period the tax and company laws require | invoice date | not automated | Confirm the period (GST and Companies Act). |
| Back-ups | their normal cycle | n/a | the provider | Confirm the provider's cycle for the privacy page. |

## Offboarding, step by step

1. Operator runs `dpdp_operator_offboard_start('<org id>')`. The export period starts (30 days).
2. Operator runs `dpdp_operator_offboard_export('<org id>')` and hands the JSON to the customer. This stamps `exported_at`.
3. After the period, and only if an export was made, the daily sweep deletes the organisation's rows, children before parents, and the organisation row last. The append-only records stay; if one still points at the organisation row, that row stays and the report says so.
4. People who belonged only to that organisation keep an identity row (a person, not an organisation's data). Removing identities with no memberships left is NOT done here: open question for the lawyer and the owner.

## Switching it on

1. Read two or three dry-run reports: `select ran_at, report from dpdp.retention_run order by id desc limit 5;`
2. If the counts look right: `update dpdp.retention_setting set live = true, updated_at = now() where id = 1;`
3. To stop at any time: set `live = false`. `public.dpdp_timer_retention_sweep(true)` forces a dry run.

## Known limits (honest)

- Tables that refer to an organisation by another column name (for example `relationship.from_org`, `referral_event.referred_org_id`) are not reached by the offboarding delete; the report lists anything left, and a kept reference keeps the organisation row.
- The periods are the engineer's proposal. Nothing is final until the owner and the lawyer agree them.
