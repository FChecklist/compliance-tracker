# WHAT was built

## 1. The weekly cycle: Identify, Classify, Prove

Weeks run Monday to Sunday (UTC). Each stage is a checklist of routine steps; a step not done last week shows as "still open from last week". The weekly score is a count ("N of M steps"), never a rating, and the wording never says "compliant", "certified" or "guaranteed".

| Stage | Steps (as built) | What is recorded |
|---|---|---|
| **Identify** (3 steps) | Start the register; check each line is still true; add anything new or say there is nothing new | The register (`dpdp.icp_item`): data sets, outside helpers, places, groups. Names only. A dated line each time something is added, changed or retired |
| **Classify** (4 steps) | Classify every line (whose data, children or not, why, basis, how long, who receives it); settle the basis for children's data; outside helpers have an agreement on record; children's-data jobs switched on where the register lists children | The classification plus derived flags (no basis for children, consent not collected, helper without agreement, unclassified). The rule switches children's-data jobs **on**, never off |
| **Prove** (7 steps) | No job is late; records attached this week (or "nothing to attach"); each signed helper agreement has its record; no open breach is past its 72-hour report; no request or complaint past its due date; no erasure past its due date; a person signs off the week | Append-only records chained into the existing History: evidence, breaches, requests, erasures, the weekly sign-off |

Prove in detail:
- **Documents.** The browser works out a fingerprint (SHA-256). VERIDIAN stores the fingerprint, the name given, where the original is kept and a date. The file never leaves the organisation, so the wording is "recorded by you", never "verified". A record can be withdrawn once; never edited or deleted.
- **Breaches.** Two clocks: 72 hours for the detailed report to the Board and 6 hours for CERT-In. A breach cannot be closed until the Board report is recorded.
- **Requests and complaints.** Access, correction, erasure, nominee and grievance; 90 days is the ceiling; "past due" only after the due day. Only the kind of request and dates are logged, never the person.
- **Erasure.** What, why, by when, and a close note.
- **Evidence pack.** One page (and a JSON download) with register, records, notices, consent counts, breaches, requests, agreements, erasures, jobs, the weekly record and a re-computed check of the History chain, including that check's limits. It is built not to contain a person's name, e-mail or phone number. It is not a certificate.

## 2. What each kind of person sees

| Person | Sees |
|---|---|
| Visitor | The sign-in page (a link by e-mail; no password) |
| **Owner / whole-organisation member** (school, university or firm owner, grievance officer and similar) | First visit: the ready-made list of jobs (seven parts) to confirm, then "who looks after what". Then the weekly page: the three stages with counts, the register, classify editor, Prove panels, sign-off, evidence pack |
| **CA partner** | Welcome from the firm that named them, "Your clients" (every organisation that named them as its CA, with steps done), "How it works"; "My clients" page |
| **CA manager** | Same welcome and "My clients"; then the weekly page for the organisation they check |
| **Client owner** (set up by a CA) | A confirmation screen showing what the CA entered; confirms it before it counts |
| **Staff** | A welcome, the three-step "AI work link", and only their own controls with due dates and a "Yes, it is done" button. Staff and parent members never see the register's status |

A firm-level roll-up (counts only, worst first, at most 100) lists clients **only for the person who acts for them** (the same set their own "My clients" page shows). No firm owner or member sees another CA's clients.

The screens, in order, with a one-sentence caption each, are in the UI/UX flow file kept outside the repository (see `05-LIVE-STATE-AND-OPEN-ITEMS.md`, "left out").

## 3. The Monday e-mail

One block, "This week's routine: Identify, Classify, Prove":
1. A headline: "N of M steps of this week's routine", and "Week of <Monday>. This counts the steps of the routine; it is not a rating of <organisation>'s legal position."
2. Three stages with "Done" / "To do" lines and a button ("Do the N steps left in Identify", or "Open Identify" when done). Buttons open the signed-in app at that stage with `?org=<id>` as a hint; they carry no credential, so the person must still sign in. The e-mail does not claim a one-tap action it cannot safely give.
3. "Still open from last week".
4. A line saying a snapshot was added to the weekly record.
5. Firms only: "Your clients this week" (counts, worst first), shown only to people who act for those clients.

Only whole-organisation members get the block. When the switch `DPDP_EMAIL_ICP_ENABLED` is exactly `0` the block is not added to any e-mail. **Today it is `0`.**

## 4. The three migrations (`drizzle/0761`, `0762`, `0763`; down files in `drizzle/down/`)

| File | Adds |
|---|---|
| `0761_dpdp_icp_identify_classify.sql` | The register `dpdp.icp_item`, the append-only weekly record `dpdp.icp_run`, classification fields and flags, the status function the screen calls, the children's-data rule, an advisory lock in `dpdp__append_event` for History; data sets mirror into the older data-category and location tables |
| `0762_dpdp_icp_prove.sql` | `dpdp.icp_evidence` (append-only), `dpdp.icp_erasure`, a received date on grievances, and the functions for evidence, breaches, requests, erasure, the Prove overview and the evidence pack; the Prove stage becomes seven steps |
| `0763_dpdp_icp_monday_block.sql` | `public.dpdp_timer_icp_weekly` (service role only), the internal helper `dpdp.icp_clients_of`, and a unique index so a Monday snapshot is written once per organisation, stage and week. No new table |

All three are additive and re-runnable; none touches existing customer data. New tables have row security on and no grants to the anonymous or signed-in roles; every access goes through functions that check the person is a whole-organisation member.

## 5. Public wording

The public pages were corrected so they say only what the product does (for example the parent-consent link and the published Grievance Officer page are not yet automatic, and the pages now say so). The sentence recorded as claim `CLM-004` in `dpdp-app/data/claims-register.yaml` is set to "not approved" until the owner re-approves it.

## 6. Deliberately not built

Consent campaign creation and parent links; the guardian verification method; some new library jobs (accuracy, nominee, itemised notice); log retention of one year or more; sign-in-free one-tap actions in the e-mail; erasure on a locked account; consent-manager registration; significant-data-fiduciary DPIA tooling; cross-border specification; automatic parent identity check; file storage of evidence documents.
