# Personal data breach runbook (draft for the lawyer)

DRAFT. Not legal advice. Every clock below must be confirmed by the lawyer before this is relied on. Clock start = the moment anyone at VERIDIAN becomes aware of the breach.

## The clocks

| Who | What | By when | Source to confirm |
|---|---|---|---|
| CERT-In | Report the incident (the CERT-In Directions of 28 April 2022 list the types) | 6 hours | CERT-In Directions 2022, para 1 and Annexure I |
| Customer (we are their Data Processor) | Tell the customer's owner what we know | 24 hours | Our DPA text (`CUSTOMER_DPA.md`); this is a contract promise, not a statutory number |
| Data Protection Board | Intimate the breach without delay: what happened, its nature, extent, timing, location, and the likely impact | without delay | DPDP Rules 2025, rule 7(2)(a) |
| Data Protection Board | Detailed report: broad facts, events and reasons, mitigation, who caused it (if known), steps to prevent a repeat, and the report on what each affected person was told | within 72 hours (the Board may allow longer) | DPDP Rules 2025, rule 7(2)(b) |
| Each affected person | Plain notice: what happened, nature, extent, timing, location, likely consequences, what was done, what they can do, who to contact | without delay | DPDP Rules 2025, rule 7(1) |

Where VERIDIAN is the Data Fiduciary (its own sign-up, billing and support data) all five rows apply to us. Where a customer is the Data Fiduciary, the customer owes the Board and the people; we owe the customer row and CERT-In.

## Steps

1. **Contain (first hour).** Revoke the affected links and sessions, rotate keys in the Supabase and Cloudflare dashboards, stop the affected edge function. Write down the time you became aware.
2. **Open the record.** Insert a row in `dpdp.breach` with `became_aware_at`. The Rule 7 columns (`drizzle/0726`) hold the facts as they become known. `deadline_at` is the 72-hour mark; `customer_notice_due_at` is the 24-hour mark; `cert_in_due_at` is the 6-hour mark.
3. **CERT-In (6 hours).** Report at incident@cert-in.org.in (confirm the address and the form). Store the reference in `cert_in_reference` and the time in `cert_in_reported_at`.
4. **Customer (24 hours).** E-mail the customer's owner from dpdp@veridian-aios.com: what we know, what we are doing, what we need from them. Set `processor_notified_customer_at`.
5. **Board (without delay, then 72 hours).** The customer (or VERIDIAN, as Data Fiduciary) files through the Board's portal when it is published. Fill the Rule 7(2) columns first; the filing is a copy of them. Set `board_notified_at` and `board_detailed_at`.
6. **People (without delay).** Use the Rule 7(1) columns (`individual_consequences`, `individual_mitigation`, `individual_contact`) for the notice. Set `individuals_notified_at`. Short sentences, no jargon.
7. **Close.** Root cause, fix, what changes so it cannot repeat. Keep the whole record: it is the evidence.

## Roles

- Decision maker: the owner (Rajat Agarwal).
- Anyone can start step 1.
- The lawyer is called at step 2, not step 7.

## Open questions for the lawyer

- Does a breach of only a customer's data that never leaves our systems still trigger CERT-In?
- Who files with the Board when the customer is the Data Fiduciary: only the customer, or also us?
- Is "without delay" read as a number of hours in practice?
