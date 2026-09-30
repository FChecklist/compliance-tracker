# Legal audit of VERIDIAN's published legal documents — 2026-09-30

**Status: drafted and audited by an AI acting as a careful drafter. NOT signed off by an advocate.** Nothing here is legal advice to the Company, and no page on the site says a lawyer reviewed it. The owner asked for a lawyer-grade rewrite that protects Shobha Kamal Solutions Private Limited (the Company), its directors, officers, employees and associates, and that says plainly that VERIDIAN DPDP is DPDP implementation and compliance-management software, not a cyber or data-cleaning system. This file records what was wrong and what was done.

## What was audited

| Document | Where | Verdict |
|---|---|---|
| Disclaimer v2.0 | `src/app/disclaimer/page.tsx` (main app) | Strong on liability, but unfinished and wrong for this product (F1–F4, F8) |
| Terms & Conditions, 7 July 2026 | `src/app/terms/page.tsx` | Thin; inconsistent with the Disclaimer; contradicts the DPDP product (F3, F5, F6, F7, F10) |
| Privacy Policy, 7 July 2026 | `src/app/privacy/page.tsx` | Wrong roles for a compliance tool; overclaims; stale providers (F5, F6) |
| Lawyer review pack | `dpdp-app/docs/LAWYER-REVIEW-PACK.md` | Honest (says "NOT REVIEWED"); 21 citations still carry open verify notes (F11) |
| Public DPDP site | `veridian-aios.com` | Had **no** Terms, Privacy or Disclaimer of its own (F12) |

## Findings

| # | Severity | Finding | Fix |
|---|---|---|---|
| F1 | High | The live Disclaimer still shows `[INSERT CONTACT EMAIL]`, `[INSERT WEBSITE]`, `[INSERT DATE]`. A notice with blanks invites an argument that it was never finalised or accepted. | New pages carry real contact (dpdp@veridian-aios.com), website and effective date. **The main app's page still has the blanks — see Open items.** |
| F2 | High | Scope mismatch. The Disclaimer covers "the VERIDIAN AI OS ERP platform"; it never names VERIDIAN DPDP and never says what the product is not. Nothing said it is not a security system or a tool that finds/cleans/deletes data. A customer hit by a breach or a missed erasure could say the product implied it would prevent or fix that. | New Disclaimer §1 and Terms §2: a plain "is / is not" statement and a table of eight things the Service does not do (cybersecurity, data discovery/cleaning/deletion, document store, Consent Manager, DPO/Grievance Officer/auditor, law firm, certification, breach response). |
| F3 | High | Terms and Disclaimer disagree. Liability cap: 12 months' fees (Terms) vs 3 months' (Disclaimer). Forum: Indian courts exclusive, no arbitration (Terms) vs arbitration at Ghaziabad (Disclaimer). Two inconsistent rules let the customer pick the better one and argue ambiguity against the drafter. | One cap (12 months' fees, ₹1,000 if free), one dispute clause, an order of precedence (Terms §1.5), and the Disclaimer expressly incorporates Terms clause 11 rather than restating it. |
| F4 | High | Arbitrator is "appointed by the Company". Indian courts do not enforce a clause letting one party unilaterally appoint the sole arbitrator (*TRF Ltd v Energo Engineering Projects Ltd*, 2017; *Perkins Eastman Architects DPC v HSCC (India) Ltd*, 2019; the Supreme Court has since looked at the same problem in the Constitution Bench decision on panels). It risks the whole arbitration clause being set aside. | Sole arbitrator appointed by agreement, failing which by the court under the Arbitration and Conciliation Act, 1996. Seat Ghaziabad kept. |
| F5 | High | The Privacy Policy makes the Company "the data controller" for all business data and says it trains models on customer data. For a DPDP compliance tool the customer is the Data Fiduciary and the Company is its Data Processor; DPDP s.8(2) requires a contract for that, and s.8(1) keeps the customer responsible regardless. Claiming control and training on customer data is inconsistent with what the product says about itself ("never stores documents") and exposes the Company as a fiduciary for data it should only process. | New Privacy Notice splits the two roles. Terms §6.2–6.3 are drafted as the s.8(2) processor contract (instructions, confidentiality, safeguards, sub-processors, breach notice, return/erasure). "We do not train AI models on Customer Data" is stated. |
| F6 | Medium | Terms say systems are "designed and operated in accordance with GDPR principles and SOC 2 trust-service criteria" and lean on subprocessors' SOC 2. The Privacy page itself says the Company is not SOC 2 certified. Loose compliance claims in marketing-adjacent text risk a misleading-advertisement complaint and will be quoted back in any dispute. Also names Vercel as the host; this product is on Cloudflare and Supabase Mumbai. | Removed. New pages state only what the site's own facts file supports: Supabase Mumbai, Cloudflare, Resend (US), a Google operator mailbox. |
| F7 | High | Protection of directors is one sentence in Terms §7, but directors are not parties to the contract. Indian law has no general third-party-rights statute, so they cannot simply enforce it. A customer could sue a director personally in tort. | "Protected Persons" defined broadly (directors, officers, employees, shareholders, associates, affiliates, contractors, licensors, sub-processors, successors). Covenant not to sue; the Company holds the benefit **as agent and trustee** for each; indemnity covers their defence costs; carve-out for liability a statute imposes on an individual directly (which no contract can remove). |
| F8 | Low | "You will not assert consumer rights" cannot bind a real consumer under the Consumer Protection Act, 2019. | Replaced by a business-use representation (Terms §3); the product is sold to organisations only. |
| F9 | Medium | No duty clauses tied to the product's real features: emailed links and AI work links are credentials; school/parent consent pages; reminders not excusing deadlines. | Terms §4, §6.4–6.7, §9; Disclaimer §5–6. |
| F10 | Medium | "May amend at any time, effective on publication." One-sided changes to a standard-form contract invite an unconscionability argument. | 30 days' notice for changes that materially reduce rights (Terms §15.1). |
| F11 | Medium | 21 of 44 legal citations in the job library carry open "verify" notes (rule numbers moved between the January 2025 draft and the notified Rules). Checked this session against published commentary: the notified Rules' structure (rule 3 notice, 6 safeguards, 7 breach, 8 erasure, 14 grievance/90 days; rule 4 from 13 Nov 2026, rules 3 and 5–16 from 13 May 2027) matches the library. Not every sub-rule was confirmed. | Not changed. The new pages cite **only** section and rule topics already in the library and say the library is not lawyer-reviewed. |
| F12 | High | After the domain moved to Cloudflare, `veridian-aios.com` served the DPDP app with no Terms, Privacy or Disclaimer. A notice-and-consent product with no privacy notice is a DPDP s.5 problem in itself. | Three static pages at `/terms/`, `/privacy/`, `/disclaimer/`, linked from every public footer. |
| F13 | Low | Grievance Officer is a mailbox, not a named person. The SPDI Rules (rule 5(9)) ask for a name and contact on the website. | Open item for the owner; the pages say "the Grievance Officer of the Company" so nothing is invented. |

## Decisions made on the owner's behalf (please confirm or change)

1. **Liability cap** — 12 months' fees; ₹1,000 if the customer paid nothing.
2. **Arbitration** — sole arbitrator by agreement/court; seat Ghaziabad.
3. **Data return** — 30 days to export after the account ends, then deletion or de-identification.
4. **No AI training** on Customer Data, stated as a promise.
5. **Payment** — invoices due in 15 days; suspension after 7 days' notice.
6. The Terms cover VERIDIAN DPDP only. The ERP/AI-OS products keep the older pages until they are brought up to the same standard.

## Open items (not done, and why)

- **Advocate sign-off.** These pages are drafted to a lawyer's standard but no advocate has read them. The site does not claim otherwise, and the job-library "reviewer" field stays empty. Recommended before the 13 May 2027 deadline and before any paid customer.
- **Main-app pages** (`src/app/disclaimer|terms|privacy`) still carry F1–F10. They serve the other products. Their blanks and the Terms/Disclaimer conflict should be fixed in a separate change.
- **Named Grievance Officer** (F13) and **GSTIN** for invoices.
- **Facts file / lawyer pack** still say "not reviewed"; correct as it stands.
