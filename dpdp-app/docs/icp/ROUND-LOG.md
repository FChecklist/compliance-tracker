# ICP rounds: log

Each round: FIX -> TEST -> AUDIT (fresh independent read-only auditor). Verdict lines are copied from the auditor's own report.

## Round 1: IDENTIFY + CLASSIFY + weekly record (migration 0761)

**Fixed / built**
- `drizzle/0761`: `dpdp.icp_item` register (names of things only; e-mail/phone-like names refused), classification columns, `icp_item_flags` derived flags, `dpdp_icp_apply_rules` (children's-data jobs switched ON, never off), `dpdp.icp_run` append-only weekly record, `dpdp_icp_status` checklist, History-chain advisory lock. Data sets mirror into `dpdp.data_category` / `data_location` so the AI link's data-map read and the CA client list see the register.
- App: `IcpWeek` screen (three stages, register, classify editor), offline mock engine `icp-mock.ts`, API calls. The Discover/Act/Confirm draft (PR 2206) and its proposed migration 0760 are replaced.

**Tests (run locally, `--isolate`)**
- `src/lib/services/dpdp-icp-identify-classify.pglite.test.ts`: 20 pass at the time of the commit (since extended, below; incl. a 288-case TS/SQL parity run of the flag rules, with and without a parent answer; migration runs twice; rollback).
- `dpdp-app/src/lib/icp.test.ts`: 26 pass.
- `tsc --noEmit` on dpdp-app: clean.
- `dpdp-app/e2e/icp-week.spec.ts`: written; NOT run locally (needs a build and Chromium with > 2 GB free RAM); CI is the proof surface.

**Audit 1** (fresh read-only adversarial subagent): **AUDIT: FAIL.** Its ranked findings, and what was done about each (all in the same working tree before Round 2's audit; 0761 is a file only, never applied):
1. *A staff member could read the register* (it names where children's data sits). Fixed: every read now needs the same "whole organisation" viewer as a write (`dpdp__icp_member(org, true)`); the browser and the mock follow it.
2. *The weekly record stored the person's e-mail address* in `actor_label`, and could not be deleted when an organisation is offboarded (0724). Fixed: the label is the role (`Owner`), the person is held only as `actor_identity_id`; the append-only guard allows DELETE only while `dpdp.org_offboarding.state = 'exporting'`.
3. *Free text could carry a person's e-mail or phone* (where held, holder, purpose, retention note, recipients, agreement reference, retire reason, sign-off note). Fixed: one guard (`dpdp.icp_not_contact`) on every free-text field, as a function check and as a table check.
4. *Children's-data rules too narrow*: the Act's school exemption (tracking or monitoring for education or safety only) had no value to record, so an honest school was pushed to "consent". Fixed: `child_exemption` basis, new flag `children_basis_check` for any other non-consent basis; "consent" stays flagged until EVERY issued parent link is answered (was: any one).
5. *The sign-off could tick another step* ("anything new this week" was ticked by any Identify sign-off). Fixed: only a person's `skipped` run ticks it; `dpdp_icp_log` takes an outcome (ok / partial / skipped); the software's own record moved to `dpdp_icp_run_software` (service role only).
6. *Mirror into the older tables* could downgrade a confirmed location and delete a shared category. Fixed (a confirmed location stays confirmed; the category goes only when no location remains).
7. *Smaller*: `icp_week()` is `stable`; rename-to-duplicate refused; check/cast errors become plain sentences; `apply_rules` takes the History lock before row locks; job keys for children's data are now institution-07, 08, 11, 12, 13, 21, 22, 25, 27; header comment named the wrong function.

Accepted and recorded, not fixed: (a) the History writer's per-organisation advisory lock cannot be shown deadlock-free on a single-connection PGlite; `apply_rules` now takes it first, but older flows (e.g. the 0605 first-visit loop) take row locks before it, so a theoretical deadlock-detect error remains; (b) the not-a-person guard is a heuristic ("asha at example dot com" passes); (c) PGlite tests run as the superuser, so grants are asserted from `information_schema`, not by switching role; (d) vendors are a separate list from `dpdp.relationship.agreement_signed_at`.

**Tests after the Audit-1 fixes** (local, `--isolate`): `dpdp-icp-identify-classify.pglite.test.ts` 23 pass (360-case TS/SQL parity incl. `child_exemption`); `icp.test.ts` 28 pass; `tsc --noEmit` and `eslint` clean on dpdp-app (the lint pass also fixed `set-state-in-effect` in `IcpWeek`, which Round 1 had missed).

## Round 2: PROVE (migration 0762)

**Built**
- `drizzle/0762`: `dpdp.icp_evidence` (append-only; one withdraw, never an edit or a delete; fingerprint computed in the browser, the file never leaves the organisation, so the wording is "recorded by you", never "verified"); `dpdp.icp_erasure`; `grievance.received_at`.
- Public RPCs (all whole-organisation only, role labels, no free text in History): evidence add / withdraw, breach log / update (72-hour Board report and 6-hour CERT-In clocks from the existing 0726 columns; set-once timestamps; closed is closed), request log / close (access, correction, erasure, nominee, grievance; 90-day ceiling, past due only after the due day), erasure log / close, `dpdp_icp_prove_overview`, `dpdp_icp_evidence_pack`. The pack leaves out the breach description and the grievance summary and carries a re-computed History-chain check (`dpdp.icp_chain_check`) and its limits.
- `dpdp.icp_prove` now has seven steps (jobs not late, evidence this week, agreements on record, breach clocks, requests on time, erasures on time, week signed off). A job that is `submitted` is not late.
- Reuses the existing `breach`, `rights_request` and `grievance` tables, so the AI-link register (0694) keeps seeing them.
- App: `ProvePanel` (records with a browser-side SHA-256, helpers' agreements, breaches, requests, erasure, the printable evidence pack), `icp-prove.ts`, `icp-prove-mock.ts`, API calls.

**Tests** (local, `--isolate`): `src/lib/services/dpdp-icp-prove.pglite.test.ts` 16 pass (real 0726 + 0761 + 0762, 0762 run twice, rollback restores the 0761 placeholder; evidence append-only; offboarding delete; breach clocks; 90-day boundary; chain tamper detection); `dpdp-app/src/lib/icp-prove.test.ts` 9 pass; `tsc` and `eslint` clean. `dpdp-app/e2e/icp-week.spec.ts` extended; NOT run locally (needs a build and Chromium with > 2 GB free RAM); CI is the proof surface.

**Audit 2** (fresh read-only adversarial subagent, on HEAD de09708d): **AUDIT: FAIL**, 3 HIGH, 7 MEDIUM, a list of LOW, and a list of test gaps. All three HIGH were reproduced on PGlite by the auditor.

Fixed in this pass (all in 0762 unless said otherwise; each has a regression test in `dpdp-icp-prove.pglite.test.ts`, "what the Audit 2 found"):
1. **H1** the pack and overview leaked legacy free text (`rights_request.answer_text`, `grievance.officer_decision`, written by older flows). `outcome` is now one of six fixed words, otherwise `answered`; never the stored text. The pack's "no name" line was reworded to what is true ("built not to contain ... e-mail address or phone number"; the organisation's own titles are shown as written).
2. **H2** older grievances (`G-0001`) could not be closed from the new screen, and their received date was invented as due minus 90 days. `request_close` now looks the reference up in `grievance`, then `rights_request`, instead of reading the prefix; an older grievance's received date is `null` ("received date not recorded"), never worked backwards.
3. **H3** closing a breach made the late-report step green with no Board report. A breach now cannot be closed until `board_detailed_at` is set (or is set in the same call).
4. **M1** the breach list now shows the description (the e2e spec reads it); **M2** the four legal-duty writes (breach log/update, request log/close) set the `dpdp.allow_locked` flag, as 0734 decided; **M3** the pack carries `totals` and `truncated`, the chain check says `truncated`; **M4** fingerprint wording changed to what is true ("a file giving the same fingerprint today is the same file ... VERIDIAN did not see the file") and the pack shows "Recorded in VERIDIAN" beside the organisation's own entered date; **M5** see H1; **M6** `becameAwareAt` with an offset is honoured and stored as UTC, a date one day ahead of UTC is accepted, the page sends "now" instead of a future midnight; **M7** a recorded officer decision is never overwritten.
5. LOW fixed: a retired line takes no new evidence; an empty erasure close or breach update does nothing; non-boolean flags give a plain sentence; the breach update re-checks `state` in the UPDATE and locks the row; the erasure "Pick why" message is a real sentence (guide catalog updated).
6. Test gaps closed: a second organisation (every write refuses another organisation's ids), pack content for legacy rows, truncation. Mock divergences fixed: close rule, empty erasure close, date window, `receivedOn` null.

Accepted, recorded, NOT fixed: (a) CERT-In's 6-hour overdue never turns a step red and the first Board intimation has no clock (the Rules fix no hour for it; the step follows the 72-hour report only); (b) 90 days is used as the default period (Rule 14(3) makes it a ceiling; an organisation that published a shorter one must reply within it) and the existing grievance ladder is 30 plus 30: not unified; (c) no statement-level TRUNCATE trigger on the append-only tables (a superuser can truncate; no application role can); (d) `RR-`/`GR-` use 8 hex characters under a global unique key (a collision gives a raw duplicate-key sentence); (e) `breach_log` and `evidence_add` have no idempotency key (the screen's busy flag only); (f) the free-text guard is a heuristic: a name with no contact detail is accepted, which is why the wording says "built not to contain", not "contains none"; (g) the mock pack is canned (status 0/0/0, no notices, chain always intact); (h) `drizzle/meta/_journal.json` already lists 0761/0762/0763 although they are "file only": the next `db:migrate` dispatch applies them, which is the owner's go-live step anyway; (i) the weekly record in the pack is capped at 200 lines and the register items are not capped.

**Tests after the Audit-2 fixes** (local, `--isolate`): `dpdp-icp-prove.pglite.test.ts` 23 pass; dpdp-app 839 pass, `tsc --noEmit` and `eslint src` clean; the three other root DPDP ICP files still pass (67 in total with this one).

## Round 3: the weekly e-mail drives the cycle, public wording (migration 0763)

**Built**
- `drizzle/0763` (file only; +down): `public.dpdp_timer_icp_weekly(org, now, record)`, service role only. Returns the week's status cut into Identify / Classify / Prove with their steps, carry-over (not done now and not done in the latest earlier record), the active memberships that may see it (the same whole-organisation rule as the screen: never staff or parent), and, for a Professional (firm) organisation, a per-client roll-up (counts only, worst first, 100 at most). When `record` is true it writes one software "Monday snapshot" per stage per week (once, a retry adds nothing).
- `supabase/functions/dpdp-monday-email/icp-block.ts` (pure renderer), `render.ts` (block before "Your controls"; subject gains "routine X of Y"; a whole-organisation member with nothing due still gets the e-mail while the block is present; the statutory-only view and an AI-changes-only e-mail never carry it), `index.ts` (per-organisation fetch, only recorded on a real send, fail-open switch `DPDP_EMAIL_ICP_ENABLED`, off only when exactly "0"), `README.md`.
- The block's links open the signed-in page at the stage (`#icp-stage-*`): honest deep links, they carry no credential, so the e-mail does not claim a one-tap action it cannot safely give.
- Public wording (owner-approved sentences, applied everywhere they appear, the surfaces regenerated from `data/veridian-facts.yaml`): "The proof stays" / "Your DPDP proof, not just your DPDP policy"; "We keep a fingerprint, a name and a date"; "Parents' consent, on a link"; "A Grievance Officer, published"; "Every control is mapped to its legal source"; the helper-reads-your-list wording. `CLM-004` in the claims register carries the changed sentence: the owner must re-approve it (the `owner_approved` flag was not touched by this work).
- Guide catalog: about ten new "weekly routine" entries so every message a person can meet has a plain-words guide.

**Tests** (local, `--isolate`): `dpdp-icp-monday-block.pglite.test.ts` 7 pass; `dpdp-icp-email-block.test.ts` 14 pass; with the Audit-2 fixes, 23 + 23 + 7 + 14 pass at the root and 839 in dpdp-app. The whole dpdp-app build gate ran green locally: `tsc`, public-facts `--check`, `vite build`, PWA build, sitemap, `check-public-surface` (3106 checks), `check-claims` (0 banned words in 2089 sentences), `check-two-doors` (559 checks).

**Audit 3**: (pending)
