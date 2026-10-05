# Compliance calendar (draft for the lawyer)

DRAFT. Dates and periods marked (confirm) need the lawyer. 13 May 2027 is the date the DPDP obligations apply to data fiduciaries (as the product's own pages state).

## Always running
| What | When | Who | Where |
|---|---|---|---|
| Retention sweep (dry run until switched on) | daily 02:10 UTC | system | `dpdp.retention_run` |
| Monday e-mail and retry jobs | weekly | system | Supabase cron |
| Unfamiliar-use alerts | on use | system | `dpdp_ai_link_note_use` |

## Monthly
| What | When | Who |
|---|---|---|
| Read the last month of retention reports; switch to live once, when right | month 1, then monthly | owner |
| Sales Partner payouts and statements | 11th (cron `statements`) | owner |
| GST return and tax invoice check (confirm) | as the CA says | owner / CA |
| Access review: who has Supabase, Cloudflare, Resend, Razorpay, Google access | monthly | owner |

## Quarterly
| What | Who |
|---|---|
| Test a restore from back-up (confirm the provider's cycle) | owner |
| Review sub-processor list (`/subprocessors/`) against reality | owner |
| Breach drill with the runbook (tabletop, 30 minutes) | owner |

## Yearly
| What | When | Who |
|---|---|---|
| Review the Privacy Notice, Terms, DPA, retention schedule, DPIA | each October | owner + lawyer |
| Companies Act and income tax filings (confirm) | per statute | CA |
| Rotate keys: payout key, Resend, Razorpay, Supabase service role | each January | owner |

## Event driven
| Event | Clock |
|---|---|
| Breach | CERT-In 6 hours, customer 24 hours, Board without delay then 72 hours, people without delay (`BREACH_RUNBOOK.md`) |
| Rights request or grievance | reply 7 days, resolve 30 days, outer limit 90 days (as the Privacy Notice states) |
| Customer ends | 30 days export, then deletion (`RETENTION_SCHEDULE.md`) |
| New sub-processor | change `/subprocessors/` first, tell customers (confirm notice period in the DPA) |
