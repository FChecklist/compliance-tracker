# Records of processing (draft for the lawyer)

DRAFT. Built from the code and the Privacy Notice v1.6, not from interviews. Two roles: VERIDIAN is the Data Fiduciary for its own data (rows 1-6) and the Data Processor for what a customer records (rows 7-9).

| # | Activity | Data | People | Purpose | Basis | Recipients | Where | Kept |
|---|---|---|---|---|---|---|---|---|
| 1 | Sign-up and sign-in | name, business e-mail, phone (optional), organisation | users | account, sign-in | consent, contract | Supabase, Resend | Mumbai; mail via Resend (Tokyo) | account life; sign-in codes 30 days after expiry |
| 2 | Billing | invoice details, payment reference, proof file if uploaded | customers | invoice, tax duty | legal obligation, contract | Razorpay, Supabase | India | tax period |
| 3 | Support and grievance mail | message, attachments, sender address | anyone who writes | answer, grievance record | request, legal obligation | Cloudflare, Resend, operator mailbox (Google) | Tokyo / Google | closed tickets 24 months |
| 4 | Service e-mails | address, send log | users | weekly e-mail, reminders, receipts | consent, contract | Resend | Tokyo | send log 13 months |
| 5 | Security and measurement | IP prefix, tool family, page speed, errors | visitors, users | secure use, fix faults | reasonable security | Cloudflare | global | prefixes 90 days |
| 6 | Sales Partner payouts | PAN (optional), bank account, IFSC, UPI id | partners | pay commission | contract, legal obligation | Supabase | Mumbai, stored encrypted | tax period |
| 7 | Customer work records | jobs, answers, notes, hashes of evidence, staff and vendor names | customer's staff, vendors, clients | the customer's DPDP programme | the customer's | Supabase | Mumbai | per customer; 30 days export after the account ends |
| 8 | Consent collection for a customer | answers per purpose, guardian name and relationship for a child, notice version | the customer's data principals, children | record consent and withdrawal | the customer's | Supabase | Mumbai | per customer |
| 9 | AI work link | what a link reads or changes, call log | the link owner | let the user's own AI help | consent of the user | the user's chosen AI (not our sub-processor) | the AI's | call log per customer |

Gaps to close before this is final: confirm each retention figure (see `RETENTION_SCHEDULE.md`); add the legal basis the lawyer prefers per row; add the customer-side categories each customer declares.
