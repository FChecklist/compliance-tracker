# DPDP product: the ICP weekly lifecycle plan

Owner's method: **Identify -> Classify -> Prove**, as a complete lifecycle that repeats **every week**, driven by the Monday e-mail.
Gaps are in `GAP-ANALYSIS.md`. This plan is ranked by the gap table (D) and sliced into three fix-test-audit rounds; the gap list shrinks each round.

## The weekly cycle (what a school principal or a CA sees)

| Stage | The week's question | What the person does (about 15 minutes) | What the system does |
|---|---|---|---|
| IDENTIFY | What do we hold, where, who holds it, what is new? | Check each register line is still true; add anything new (system, vendor, data set, group) or say "nothing new" | Starter list from the library; stale flag after 3 weeks; weekly record |
| CLASSIFY | Whose data, children or not, why, on what basis, how long, who receives it? | Fill the five facts for each new or changed line | Derived flags (no basis for children, consent not collected, vendor without agreement, unclassified); switches the children's-data jobs **on** when the register lists children; never switches a job off |
| PROVE | Can we show it? | Attach evidence (file fingerprint + reference + date); send/collect parent consent; log breaches, rights requests, grievances, erasures; sign off the week | Hash-chained History; evidence pack in one click; weekly snapshot (counts at sign-off) |

The **Monday e-mail** carries one checklist per stage (links that act), the weekly routine score ("N of M steps"; **not** a legal rating), what is carried over from last week, and, for a CA with many clients, a per-client ICP roll-up.

## Rounds

| Round | Slice | Closes gaps (GAP-ANALYSIS D) |
|---|---|---|
| 1 | Migration 0761: register (`icp_item`), classification columns, derived flags, children-job rule, weekly record (`icp_run`) and `dpdp_icp_status`, History-chain lock. App: the `IcpWeek` screen replaces the Discover/Act/Confirm draft; offline mock engine. | 1, 2, 3, 4 (screen part), 14 |
| 2 | Migration 0762: PROVE. Evidence (hash, reference, date; append-only), vendor agreement evidence link, breach register RPCs (Rule 7 fields, notified timestamps, close), rights + grievance intake with the 90-day ceiling, erasure log, evidence pack, `dpdp.icp_prove` replaced with the real steps. App screens. | 5, 7, 8, 9, 10, 11 |
| 3 | Migration 0763: consent campaign + links + guardian verification method; library jobs (s.8(3) accuracy, s.10 / Rule 13, s.14 nominee, Rule 3 itemised notice) as a new library row; log retention >= 1 year. Monday e-mail ICP block and per-client roll-up. Public wording fixes. | 6, 12, 13, 4 (e-mail part), overclaims |

## Method per round

FIX -> TEST (unit, PGlite SQL, TS/SQL parity, e-mail render tests; `--isolate` as in CI; counts recorded in `ROUND-LOG.md`) -> AUDIT by a **fresh, independent, read-only adversarial subagent** that did not write the code and is given the code and the Act/gap list, not conclusions. Blocking findings are fixed and re-tested before the next round.

## Not built (and said so)

Consent-manager registration (Rule 4); significant-data-fiduciary DPIA/audit tooling (no class found for these sectors); Rule 15 cross-border specification (none notified); automatic parent identity check through DigiLocker (needs an authorised-entity integration and the owner's go); file storage of evidence documents (the first version records the fingerprint, name and reference; the file stays with the organisation).

## Rules kept

No migration applied to live Supabase and no deploy without the owner's explicit go plus a recorded rollback id. Lawyer-review gates (pricing page, refund page, Terms clause 7) untouched. Payments only through IT Services by Rajat Agarwal via Razorpay; the product never moves money. Never "compliant", "certified" or "guaranteed". No personal data in prompts, URLs or logs; the register holds names of things, never a person's data.
