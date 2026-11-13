# DPDP product: ICP gap analysis (13-14 Nov 2026)

Method asked for by the owner: **Identify -> Classify -> Prove (ICP)**, run as a complete, repeating **weekly** lifecycle.
Labels: **VERIFIED** (read in the primary text), **SECONDARY** (law-firm/news/vendor page), **UNVERIFIED**.
Nothing here is legal advice; every legal reading below is still subject to the owner-only lawyer-review gate.

## A. The product as it was (independent read-only audit, 14 Nov 2026, repo at `58edc3b6`)

Verdict: **FOLLOWS ICP PARTLY.** The live product is a compliance task tracker (59 jobs, one Yes button each, Monday e-mail chase, hash-chained History, parent-consent page, billing).

| ICP step | State before this work | Evidence |
|---|---|---|
| IDENTIFY | WEAK: the 14 "know your data" jobs are single Yes clicks. `dpdp.data_category` / `data_location` exist but nothing in the live path writes them; the working data-map screen is in the Next.js module that is not served live. | `drizzle/0415`, `src/app/dpdp/(app)/data-map/page.tsx`, `dpdp-app/DEPLOY.md` |
| CLASSIFY | WEAK: only static labels on the job library; no per-organisation principal type, purpose, lawful basis, sensitivity, retention; nothing derived. The Terms disclaim "inventory, classify, tag". | `dpdp-app/public/terms/index.html:65` |
| PROVE | PARTIAL: strong chain + consent records; 58 of 59 jobs are bare declarations; the only "doc" job has no upload path; the "fingerprint" line has no live writer; breach clocks exist but nothing sets the notified timestamps; evidence pack is jobs+history JSON only. | `0604`, `0725`, `0726`, `0734`, `App.tsx` |
| WEEKLY | The Monday e-mail chases open jobs. It does not run an Identify/Classify/Prove cycle. | `supabase/functions/dpdp-monday-email` |

## B. The Act and Rules (primary text read; see sources)

Primary: DPDP Rules 2025, G.S.R. 846(E), egazette.gov.in `WriteReadData/2025/267650.pdf` (English text read in full, VERIFIED). The Act was read as the Bill "as introduced" (PRS, Bill No. 113 of 2023); the enacted text could not be fetched (meity/indiacode returned 403), so Act section numbers are VERIFIED-Bill only and need a lawyer's diff.

| Duty | Provision | What it asks | Label |
|---|---|---|---|
| Phased start | Rule 1(2)-(4) | Board rules on publication; consent managers 13 Nov 2026; main duties (Rules 3, 5-16) 18 months after publication = **13 May 2027** (some firms say 14 May: the gazette signing date). | VERIFIED (computed) |
| Notice | s.5, Rule 3 | Standalone notice; **itemised** data; purposes; how to withdraw, exercise rights, complain to the Board; English or Eighth Schedule language. s.5(2): legacy consents need a notice "as soon as reasonably practicable". | VERIFIED / VERIFIED-Bill |
| Consent + proof | s.6, s.6(10) | Free, specific, informed, unambiguous; withdrawal as easy as giving; **the fiduciary must prove notice was given and consent obtained**. | VERIFIED-Bill |
| Legitimate uses | s.7 | (a) voluntary-provision, (b)/(c) State, (i) employment etc. There is no "educational emergency" limb. | VERIFIED-Bill |
| Accuracy | s.8(3) | Completeness/accuracy/consistency where data decides something about the person or is disclosed (results, transcripts, references). | VERIFIED-Bill |
| Security | s.8(5), Rule 6 | Encryption/masking, access control, logs and monitoring, backups, **keep logs and data one year**, processor contract clause. | VERIFIED |
| Breach | s.8(6), Rule 7 | Each affected person without delay (nature, consequences, mitigation, safety steps, contact); Board at once, then **72 hours** detail incl. cause, remediation, report on what people were told. | VERIFIED |
| Erasure / retention | s.8(7), Rule 8 | Erase on withdrawal or purpose over; processors too. Rule 8(3): retain data, traffic data and logs **at least one year**. The 3-year/48-hour rule applies only to large e-commerce/gaming/social platforms, **not** schools, universities or CA/CS firms. | VERIFIED |
| Contact + grievance | s.8(9)-(10), Rule 9, Rule 14(3) | Publish a contact; grievance redress with a **published period not over 90 days**. | VERIFIED |
| Children | s.9, Rules 10-12 | Verifiable parental consent before processing any child's (<18) data; no detrimental processing; no tracking/behavioural monitoring/targeted ads. Rule 10: check the adult is an adult and identifiable via details already held or volunteered / **virtual token from an authorised entity (e.g. DigiLocker)**. | VERIFIED |
| Educational institutions | Fourth Schedule Part A item 3 | Exempt **only** from s.9(1) and (3) for "tracking and behavioural monitoring" for the institution's educational activities or the safety of enrolled children. Admissions, fees, attendance, results and parent portals are **not clearly exempted**; s.9(2) is never exempted. | VERIFIED text / analysis |
| SDF | s.10, Rule 13 | DPO in India, independent auditor, annual DPIA + audit, algorithmic due diligence. No SDF class for education or CA/CS found. | VERIFIED-Bill / UNVERIFIED notifications |
| Rights | ss.11-14, Rule 14 | Access, correction/erasure, grievance, nominee; publish how to ask. No fixed time other than the 90-day grievance ceiling. | VERIFIED |
| Processors | s.8(1), 8(2), Rule 6(1)(f) | Valid contract; the fiduciary stays responsible. | VERIFIED |
| CA/CS firms | s.2 | No profession-specific provision; a firm is a fiduciary for its own staff/marketing and a processor for client data it handles on instruction (engagement-specific). | analysis (SECONDARY practitioner view) |

Penalties (as introduced): security-safeguard failure up to Rs 250 crore; failure to notify breach Rs 200 crore; children's obligations Rs 200 crore; SDF Rs 150 crore (VERIFIED-Bill, Schedule table garbled in extraction).

**Cannot verify:** the enacted Act text; Board appointment status; whether any SDF class / Rule 13(4) / Rule 15 specification has been notified; case law on whether item 3 covers general student administration; the Hindi text.

## C. Similar products on the internet (vendor pages, 13 Nov 2026)

Cells state what the vendor's own page says; "-" = not stated, not absent. Prices as published or "not published".

| Product | Target | Map/classify | Consent / children | Rights + SLA | Breach | Vendors | Evidence | Weekly cadence | Multi-client | Price |
|---|---|---|---|---|---|---|---|---|---|---|
| Consentin (Leegality) | BFSI, lending | AI PII scan, RoPA | 22-language notices; children not stated | SLA tracked | register + notice drafts | partial | tamper-proof trail | - | - | free 3,000 consents/mo, then quote |
| PrivacyEngine | banks, SaaS | RoPA, flows | ledger; parental flow, method unstated | SLA tracked | playbooks | logs | board reports | - | - | not published |
| Privy (IDfy) | enterprise | RoPA (+ classification per listings) | age/parent notices | DSAR (listing) | listing | listing | audit trails | - | - | contract |
| ConsentOS | SMEs | inventory (Growth) | consent engine | portal (Growth) | register (Growth) | roadmap | audit packs (top tier) | - | roadmap | Rs 2,999-34,999/mo + setup |
| OnePlaceHQ School ERP | private schools | - | admission consent, per-purpose revoke (vendor claim) | parent portal | 72h templates | - | access log | weekly retention flags | multi-school trust | none listed |
| PrivacyOps CA | small CA firms | PII scan | register | - | register + ZIP | register | ZIP pack | - | not described | not stated |
| OneTrust / Sprinto / Securiti | enterprise | yes (S) | yes (S) | yes (S) | yes (S) | yes (S) | yes | - | - | USD modules / gated |
| CookieYes / Secure Privacy | websites | no | cookies only | no | no | no | consent log | - | per-domain agency dashboard | $0-55 per domain/mo |

Unverified: Sprinto details (page 403), NitiBharat (Capterra only), OneTrust prices, Securiti/TrustArc/Truyo features (not read). Several named products (Zoho privacy, ClearTax DPDP, Cuspera) were not found; treat as non-existent.

**What the survey shows.** No single vendor states a combination of: parent-consent flow, rights requests with the statutory ceiling, breach register with the 72-hour clock, vendor register, **and a recurring weekly cadence**. Nobody states a weekly routine as a feature. Multi-client roll-up exists only per domain (cookie tools). Enterprise tools are priced out of reach of a school or a small CA firm. Only OnePlaceHQ addresses schools (vendor claims), and it is an ERP add-on.

## D. Feature-gap table: product (before) vs Act duty vs market

| # | Capability | Act/Rule | Market | Before | Gap rank |
|---|---|---|---|---|---|
| 1 | Live data register (what, where, who holds) | s.5 itemised notice needs it; s.8(4) | table stakes | none live | **1** |
| 2 | Classification (principal, children, purpose, basis, retention) | s.4/7/9, Rule 8 | table stakes | none | **2** |
| 3 | Derived rules (children data -> children jobs, vendor w/o agreement) | s.8(2), s.9 | rare | none | 3 |
| 4 | Weekly ICP cycle + e-mail that drives it | none (differentiator) | nobody | task chase only | **4** |
| 5 | Evidence with file fingerprint, reference, date | s.6(10), Rule 6 | table stakes | bare Yes | **5** |
| 6 | Consent campaign, links, parent verification method stored | s.6, s.9, Rule 10 | table stakes | no way to create/send; typed guardian name | **6** |
| 7 | Rights + grievance intake with 90-day clock | ss.11-13, Rule 14 | table stakes | no live writer | 7 |
| 8 | Breach register with Rule 7 fields and notified timestamps | s.8(6), Rule 7 | table stakes | hidden, thin | 8 |
| 9 | Vendor/processor register with agreement | s.8(2), Rule 6(1)(f) | table stakes | Yes/No job | 9 |
| 10 | Retention + erasure log | s.8(7), Rule 8 | table stakes | declaration job | 10 |
| 11 | One-click evidence pack | s.6(10) | table stakes | jobs+history JSON | 11 |
| 12 | Per-client ICP roll-up for CA/CS | none | nobody | counts only | 12 (differentiator) |
| 13 | Accuracy s.8(3) job; SDF s.10 / Rule 13 job; nominee s.14; itemised notice Rule 3 | listed | - | missing from library | 13 |
| 14 | History chain safe under concurrent writes | integrity | - | forkable (no lock) | **fix now** |

Duties deliberately **not** built (stated, not hidden): consent-manager registration (Rule 4); significant-data-fiduciary DPIA/audit tooling (no SDF class found for these sectors); cross-border specification (Rule 15, none notified); automatic identity verification of a parent against DigiLocker (needs an authorised-entity integration and the owner's go).

## E. Overclaims found and the fix

| Where | Wording | Why it overclaims | Fix |
|---|---|---|---|
| `dpdp-firm/index.html:330`, institution :337 | "Your DPDP proof - not just your DPDP policy ... The proof stays." | proof was a click | reworded to what the code stores |
| `dpdp-institution/index.html:142,278,312` + FAQs | "We keep a fingerprint, a name and a date" | no live writer | true once evidence is built (Round 2); reworded to say what is stored |
| institution :267 | "Parents' consent, on a link" | no way to create/send a campaign | true once campaigns exist (Round 3) |
| institution :272 | "A Grievance Officer, published" | no publish path | reworded |
| both | "Every control is mapped to its legal source" | 4 of 59 jobs are good practice; 21 of 44 citations unverified | reworded |
| `src/lib/weekly-routine.ts` | "the helper reads your list of data" | it does not | replaced by the ICP module |
| `audit` rows | deleted at day 365 | Rule 8(3) / Rule 6(1)(e): keep **at least one year** | keep longer than a year |

The lawyer-review gates (pricing page, refund page, Terms clause 7) stay owner-only and untouched.
