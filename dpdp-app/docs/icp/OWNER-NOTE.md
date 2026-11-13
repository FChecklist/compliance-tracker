# VERIDIAN DPDP: the weekly Identify, Classify, Prove cycle. Owner note

Written for the owner, in plain words. PR: https://github.com/FChecklist/compliance-tracker/pull/2207 (not merged).
**Nothing has been applied to any database, deployed or e-mailed. Every step below waits for your go.**

## 1. What it does for a customer (a school, a university, a CA or CS firm)

Once a week the customer works through three short stages. Each stage is a checklist of routine steps.

| Stage | What the customer does | What is recorded |
|---|---|---|
| **Identify** | Lists what personal data the organisation holds and where: a register of data (student records, staff files, CCTV), of the outside helpers who touch it (vendors) and of the places it sits. Names only, never the data itself. | The register lines, with a dated line each time something is added, changed or retired. |
| **Classify** | For each register line: whose data it is, why it is held, on what basis, how long it is kept, whether it is about children, whether an outside helper has it and whether there is a signed agreement. | The classification, plus flags that say what still needs attention (for example children's data without a parent-consent answer). |
| **Prove** | Keeps dated proof: documents (the file never leaves the organisation; only its fingerprint is stored), a breach log with the two clocks (72 hours to the Board, 6 hours to CERT-In), requests and grievances answered within the 90-day ceiling, an erasure log, and a printable evidence pack. | Append-only records, linked in the History chain, which the pack checks. |

- The **weekly score** is a count: "N of M steps of this week's routine". It is never called "compliant" or "certified", and it is not a rating of the organisation's legal position.
- Weeks run Monday to Sunday (UTC). A step not done last week shows as "still open from last week".
- A **Professional (CA/CS firm)** organisation also sees its clients ranked worst first (counts only). "Clients" means the same organisations the firm already sees in "My clients".

## 2. What the Monday e-mail says

One block, "This week's routine: Identify, Classify, Prove":
1. A headline: "N of M steps of this week's routine", and "Week of <Monday date>. This counts the steps of the routine; it is not a rating of <organisation>'s legal position."
2. Three stages, each with its checklist ("Done" / "To do") and a button "Do the N steps left in Identify" (or "Open Identify" when finished). The button opens the app at that stage; the person must still sign in.
3. "Still open from last week", when there is carry-over.
4. A line saying a snapshot of the list was added to the weekly record, so there is a dated line for the week even if nobody opens the page.
5. For firms only: "Your clients this week", worst first, with a note that these are counts and not a rating of any client.

Who gets it: only whole-organisation members (owner, grievance officer and similar). Staff and parent members never receive the register's status.
Safety switch: set the edge function secret `DPDP_EMAIL_ICP_ENABLED=0` to hide the block from every e-mail at once. Any other value, or no value, leaves it on.

## 3. The three migrations (files only: `drizzle/0761`, `0762`, `0763`)

| File | What it changes | Roll back with | What the rollback loses |
|---|---|---|---|
| `0761_dpdp_icp_identify_classify.sql` | Adds the register table (`dpdp.icp_item`), the weekly record (`dpdp.icp_run`), classification fields and flags, the register and status functions the screen calls, and an advisory lock in `dpdp__append_event` for History. | `drizzle/down/0761_*.down.sql` | Deletes the register lines and weekly records written since, and the mirrored data-category and location rows it made. Run the 0762 and 0763 down files first. |
| `0762_dpdp_icp_prove.sql` | Adds the evidence table (`dpdp.icp_evidence`), the erasure log (`dpdp.icp_erasure`), a received date on grievances, and the functions for evidence, breaches, requests, erasure, the Prove overview and the evidence pack. Replaces the 0761 placeholder Prove stage with 7 steps. | `drizzle/down/0762_*.down.sql` | Deletes evidence and erasure rows. Breach, request and grievance rows already in the existing tables stay, because they are the organisation's own records. History events stay (the chain is append-only). Run the 0763 down file first. |
| `0763_dpdp_icp_monday_block.sql` | Adds one function for the e-mail (`public.dpdp_timer_icp_weekly`, service role only), an internal helper that finds a firm's clients, and a unique index so the Monday snapshot is written once per organisation, stage and week. No new table. | `drizzle/down/0763_*.down.sql` | Nothing else changes. The Monday snapshot rows already written stay in the weekly record. |

Order to apply: 0761, then 0762, then 0763. Order to undo: 0763, then 0762, then 0761. All three are re-runnable and additive; none touches existing customer data.

## 4. Exact deploy steps (all wait for your go)

1. **Read the three down files** in `drizzle/down/`.
2. **Record a rollback id first.** Note the latest migration name or version from the Supabase project's migration list (`list_migrations`) and the time, and write both in the PR. If the Supabase plan allows it, also take a backup or branch at that moment. This is the id you go back to.
3. **Apply 0761, 0762, 0763 in that order** through the Supabase MCP (`apply_migration`). After each, check that it succeeded before the next.
4. **Check on the live database**: the new functions exist, and a test organisation can open the weekly page.
5. **Deploy the edge function** `dpdp-monday-email` (new file `icp-block.ts` is part of it). Do a dry run for one test organisation first and read the e-mail.
6. **Deploy dpdp-app** to Cloudflare Pages, and publish the regenerated public pages.
7. **Decide on PR 2206** (the older Discover, Act, Confirm draft with migration 0760). This PR replaces it; close 2206 or tell me to.
8. **Approve or reword the public sentences** that differ from your brief. `CLM-004` in `data/claims-register.yaml` is set to "not approved" until you approve it.

**Rollback**: first set `DPDP_EMAIL_ICP_ENABLED=0` (instant, hides the e-mail block). Then redeploy the previous edge function and app. If the database must go back: run the down files in the order 0763, 0762, 0761 (accepting the data loss in section 3), or restore to the rollback id from step 2.

## 5. What was and was not verified

Verified here: automated tests on real Postgres (as WASM), type check, lint, and the full build gate. Independent fresh audits were run in four rounds; every blocker found was fixed (see `ROUND-LOG.md`).
Not verified: the live database (nothing applied), real e-mail delivery, a lawyer's review of the wording.
Deliberately left for later: consent campaign creation, parent links, some new library jobs, one-tap actions in the e-mail without sign-in, and erasure on a locked account.
