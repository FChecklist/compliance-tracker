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

**Audit 2**: (pending)
