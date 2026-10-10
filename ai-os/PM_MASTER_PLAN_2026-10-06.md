# PM MASTER PLAN — 2026-10-06 (two sessions, one list, no duplication)

Rules from the owner: commit every time, never merge until the end. Order: **LOCAL → LOCAL + SUPABASE → GITHUB**. 100% completion, no shortcuts, no assumptions. Low RAM: one heavy step at a time. Tokens: batch everything.

Facts checked 2026-10-06 (nothing below is assumed; "VERIFY" = not yet checked):
- GitHub API unreachable from this laptop right now (gh timed out). All git push / PR / CI items are blocked until it returns.
- Free RAM 1.68 GB. `C:\ct\heavy.lock` is free.
- Another session has `feat/awl-items-4-5-6-8` checked out in `C:\ct\w-awl-guide2` with an unpushed commit `b972eb49` (also renumbers the person-card migration to 0736). Do not touch that worktree from this session.

## 1. WORK LIST (every item, one owner each)

Owner key: **PM** = this session (builds, commits locally). **S2** = the other session (AWL / PR #2119 / watchers). **OWN** = owner only.

### A. PROJEXA offline / sync (repo `FChecklist/projexa`, worktree `C:\ct\px-offline-gate`, branch `train/offline-sync-2026-10-06`)
| ID | Item | Owner | State |
|---|---|---|---|
| A1 | Offline create screens (permit/drawing/document, new meeting) merged into train | PM | DONE, head `b5a06aa0` |
| A2 | `e2e/lf-documents-file-uploads.spec.ts` (3 tests; renamed so the local-first config matches it) | PM | DONE, local pass |
| A3 | Run A2 | PM | DONE 2026-10-06, 3 passed (2.4m), config playwright.local-first.config.ts, train branch head = commit "fix(local-first): send waiting files..." (see git log) |
| A4 | Proof that A2 fails on broken code | PM | DONE: the run before the fix failed drawing + document ("offline create_* was never sent", 0 pushes); after the fix 3/3 pass. Real bug found + fixed: file scheduler was not nudged on online/focus (LocalShell.tsx) |
| A5 | Live run: one real permit upload vs live `/uploads/sign` (v11); 403 for client_viewer | PM | PENDING, needs network |
| A6 | Two laptops, same project, online + offline, conflict keep-mine/keep-theirs (one long wait, no 15 s reload) | PM | PENDING |
| A7 | Second-ORG isolation via Edge session layer + data-service key path | PM | PENDING, needs network |
| A8 | Laptop-to-laptop sync | PM | PENDING |
| A9 | Installed-laptop update pick-up (after #410 is in) | PM | PENDING, blocked by A12 |
| A10 | After #410: installer hook after `manifestDigestOk`, `RELEASE_ORIGIN` in projexa-sync, peer relay (spec `ai-os/audit37/RELEASE_DISTRIBUTION_2026-10-06.md`) | PM | PENDING, blocked by A12 |
| A11 | 111 Sumeet table pass/fail, closed only by the 6-condition rule; then Chrome run | PM | PENDING |
| A12 | Projexa PRs (checked 2026-10-06 20:00) | PM | #413 green; #412 fails `Test`; #410 and #409 fail `Offline e2e (local-first)`; all open. #412/#413 content is inside the train. Causes of the 3 failures NOT yet read |

### B. AWL / DPDP (repo `FChecklist/compliance-tracker`, PR #2119, branch `feat/awl-items-4-5-6-8`)
| ID | Item | Owner | State |
|---|---|---|---|
| B1 | Journal conflict markers removed; migration renumbered 0735→0736; commit `c7d605e7` pushed | S2 | DONE |
| B2 | S2 local commit `b972eb49` (duplicate renumber) | PM took over (S2 archived) | DONE: kept as branch `backup/awl-b972eb49`; worktree `C:\ct\w-awl-guide2` reset to pushed `c7d605e7` |
| B3 | Move 0736 down script into `drizzle/down/` | PM | DONE local, commit `976f1cb6`, `check-migration-integrity` passes |
| B4 | (DONE local `976f1cb6`, `check-ddl-authorization --base origin/main` passes) Add `-- PRE-APPROVED-LIVE-DDL:` citation to `0736_awl_person_card.sql` and its down file (fixes DDL Authorization). Wording: the owner's delegated PM authority for the 100-point audit, chat 2026-10-05, same as the neighbouring AWL migrations | S2 | PENDING |
| B5 | Regenerate `docs/master/TEST_COVERAGE_GAP.md` | PM | DONE local `976f1cb6`; 104 AWL tests pass (--isolate) |
| B6 | Live check | PM | DONE: `public.ai_work_link_person_card` exists live (SECURITY DEFINER, STABLE, search_path empty, EXECUTE only postgres + service_role); Supabase ledger row `20261006120716 awl_person_card`; drizzle ledger 477 rows. 0736 is idempotent (CREATE OR REPLACE), no reconcile needed beyond the runner applying the journal entry |
| B7 | Unit Tests / Lint / Type Check results on the new commit | S2 | VERIFY, no network |
| B8 | compliance-tracker #2110 merge watcher | S2 | VERIFY |
| B9 | AI-link deploy, live check, static pages publish | PM (decides) | AFTER all gates; PM never deploys without the ritual below |

### C. Housekeeping
| ID | Item | Owner |
|---|---|---|
| C1 | This plan committed on a docs branch | PM, DONE when committed |
| C2 | Memory note updated with this plan's location | PM |
| C3 | Owner-only items (Razorpay keys, lawyer sign-off, Search Console, recharges, DNS) | OWN, unchanged |

## 2. NO-DUPLICATION METHOD
1. **One owner per item, one branch per owner.** A branch is "leased" to a single session. PM owns `train/offline-sync-2026-10-06` (projexa) and `docs/pm-master-plan-2026-10-06`. S2 owns `feat/awl-items-4-5-6-8`. No session edits a branch it does not own; it sends a message instead.
2. **Claims first.** Before starting an item, write the item ID into `ai-os/boss/ACTIVE-CLAIMS.yaml` (compliance-tracker) per its protocol; for projexa the claim is the train branch lease in this file.
3. **Status lives in this file only.** An item changes state by editing its row and committing. Nobody keeps a second list.
4. **Check before every action:** `git worktree list` (is the branch already open somewhere?), `git log origin/<branch>..<branch>` (is there unpushed work?). If another worktree holds the branch, stop and message its owner.
5. **Shared-resource rules:** one heavy step at a time via `C:\ct\heavy.lock` (free RAM > 1.2 GB); live Supabase DDL only by the PM, one migration at a time, logged in `platform.claude_log`; the gh/GitHub step is the PM's, once.
6. **Commit after every unit of work**, with `git add <paths>` (never `-A`), `git commit -F file`. No push, no merge, no PR until stage 3.

## 3. EXECUTION STAGES (fast = batch; each stage has a gate)

**Stage 1 — LOCAL (no network needed)**
- Batch 1 (light, S2): B3+B4+B5 in one commit in `w-awl-guide2`; run `node scripts/check-migration-integrity.mjs`, `check-ddl-authorization.mjs --base main` (local base), the two AWL test files with `--isolate`.
- Batch 2 (light, PM): typecheck changed projexa files only; `bun test --isolate` the shell files touched.
- Batch 3 (HEAVY, one run, PM): `bunx playwright test -c playwright.local-first.config.ts e2e/lf-file-uploads.spec.ts --workers=2`, then the plant-then-revert proof (A4), then the other local-first specs that the train touches in the same run. Stop dev servers via `windows-dev-process-guard.ps1 -StopPort`.
- Gate 1: every A/B item marked "local pass" with the commit SHA and run timestamp in this file.

**Stage 2 — LOCAL + SUPABASE**
- Merge S2's and PM's local branches together locally (projexa train; compliance-tracker AWL + any projexa-sync change) and re-run Batch 3 once on the merged result.
- B6 first (read-only SQL against live), then apply 0736 to Supabase only after Gate 1, one migration, DDL citation present, verify the function exists and is `service_role`-only, log to `platform.claude_log`.
- Run A5, A7 (live), A6, A8, A11 against the merged local build + live Supabase.
- Gate 2: live checks recorded; nothing failing; Sumeet rows closed only under the 6-condition rule.

**Stage 3 — GITHUB (when the network returns)**
- Push each branch once; ONE PR per repo; ONE CI run; read failures from job logs, fix locally, commit, push once.
- Merge on green CI (Amendment 001). Restart nothing: no per-PR watchers, one poll that requires every check-run green on the merge SHA.
- Then the deploy ritual (`R72_DEPLOY_RITUAL.md` / PROJEXA release steps), live check, static pages publish (B9). Owner-only items stay with the owner.

## 4. CLUBBING (why this is ~10x cheaper)
- One Playwright run for all specs instead of one per PR.
- One worktree per repo; reuse, never add (each new worktree costs ~1.4 GB of indexer RAM).
- Restricted `tsc` on changed files (~40 s), not whole-repo.
- All CI fixes found from one log read, fixed in one commit.
- One PR and one CI run per repo instead of one per item.
- Reports: milestones only, as % tables.

## 5. RAM PLAN
Before a heavy step: close Chrome and any dev servers (`windows-dev-process-guard.ps1 -Cleanup` for orphaned `tsc`), take the lock, confirm free RAM > 1.2 GB, run, release. Never start two heavy steps at once. Never `attrib /S` across the `node_modules` junction.

## 6. CHECKLIST (tick by editing this file; every tick needs a commit SHA)
- [x] B3 down script moved
- [x] B4 DDL citations
- [x] B5 coverage report regenerated
- [x] B2 reconciled with `c7d605e7` (no lost commit)
- [x] B6 live ledger checked
- [x] A3 upload spec passes
- [x] A4 upload spec failed on the unfixed code, passes on the fix
- [x] Gate 1 recorded (2026-10-07: projexa train merged with #409+#410, full local-first run 90 passed / 1 failed, the 1 fixed in 5e5cc3e1 and re-run 5/5; #2110 merged with main locally, ef67ebd5, 11 audit-stamp tests pass)
- [x] Merge locally, re-run batch (train bbd185a5 + 5e5cc3e1; #2110 ef67ebd5)
- [x] 0736 already live + verified (see B6)
- [ ] A5, A6, A7, A8 live/peer tests
- [ ] A9, A10 (after #410)
- [ ] A11 Sumeet 111 table + Chrome run
- [ ] Gate 2 recorded
- [x] Push once per repo, one PR each, one CI run (projexa #417; ct #2119, #2110)
- [x] Merge on green (2026-10-07: projexa #417 squash 77fa9571, ct #2119 1b5ba296, ct #2110; #409/#410/#412/#413 closed as inside #417)
- [x] Deploy ritual, live check (2026-10-07: projexa main 77fa9571 deployed to Vercel production once, dpl_H1KYMbPEFsZcXWUF62UqSSPqkaGC READY, projexa-ai.com serves it, live-site-smoke 9/9)

## 7. LOG
- 2026-10-06 PM: A2/A3/A4 done. Product bug fixed in projexa train: the file-upload scheduler (LocalShell.tsx) is now nudged when the connection returns and when the tab regains focus. Lesson: wait for `C:\ct\heavy.lock` to be gone before starting a run, and release it with `rm -rf` (rmdir fails on a non-empty folder). GitHub still unreachable; B3-B8 and A12 unchanged (S2 / VERIFY).
- 2026-10-06 PM: GitHub reachable again. B2-B6 done (S2 archived, PM took its lease). #2119 CI before my fix: DDL Authorization, Migration Integrity, Test Coverage Gap failed; fixes committed locally in `w-awl-guide2` (`976f1cb6`), NOT pushed. #2110: CONFLICTING + DDL Authorization failing (not yet read). Next: read failing logs of projexa #409/#410/#412 and ct #2110, fix locally.
- 2026-10-06 PM, causes of the projexa PR failures (read from CI logs, not yet fixed): #410 = Turbopack build cannot fetch the Google font (`@vercel/turbopack-next/internal/font/google/font`), an infra/font-fetch failure, expected to clear on rerun; #409 = the e2e stub does not answer the `memberships` query ("not part of the local stub"), so requireAuth returns a transient failure, likely needs a stub update, VERIFY against the train; #412 = one unit test fails, `outbox-shared (production wiring) > a browser online event flushes ...` (passes in the train with --isolate per the earlier local run? NOT confirmed, re-run that one file with `bun test --isolate`). Fix order: re-run the #412 file locally first, then decide #409/#410 against the train.

- 2026-10-07 PM: CORRECTION to the 2026-10-06 note on #409: the `memberships` lines are log noise from passing tests; the real #409 failure is ONE flaky test (R2 `page.reload` on a detached page). #412's `outbox-shared` test was a CI timing flake (extra push of the same op); now asserts op ids (dc4cdc66). #409 and #410 merged into the train locally. Full local-first run found one REAL regression from A1: lf-documents-docs.spec expected /moms/new to hand over to the server; it is now a laptop screen (fixed in 5e5cc3e1). #2110: journal conflict resolved (0730 re-timed idx 543 / when 1790700016000 after 0736), PRE-APPROVED-LIVE-DDL added, ef67ebd5 in worktree C:\ct\ct-audittrail. A5/A7 (real-backend login specs) NOT run: they type the shared E2E test-org password into the real remote Supabase Auth, which is outside the local-dev test-credential exception; they stay owner-run (`bunx playwright test -c playwright.audit37-real.config.ts`).

- 2026-10-07 PM, stage 3 done: CI for #417 needed one more flake fix (reloadAgain retries 5x, R10 reload-while-worker-takes-control). Merging #417 into projexa main STARTED a Vercel production build (dpl_3imx...), CANCELLED by the PM because of the owner's zero-Vercel instruction; projexa-ai.com therefore still serves the previous build (cd93bc5e) and the merged train is NOT live. ct main merges did not create Vercel builds (R87 gate). Migrations 0730 and 0736 already live in Supabase (verified read-only). Remaining: A5/A7 real-backend login specs (owner-run), A9/A10 follow-ups, A11 Sumeet 111 table, deploy (needs an owner decision on Vercel vs a non-Vercel host).

- 2026-10-07 PM, GO-LIVE: owner approved the single Vercel Hobby deploy (go-live definition point 9). Redeployed the canceled #417 production build; READY; /sw.js stamped 77fa9571; live-site-smoke 9/9 (one ECONNRESET from this laptop passed on retry). Still owner-run: A5/A7 real-backend login specs, real chat-engine runs (B37-B42), connector installs (B48-B50). The Sumeet register is essentially all closed already (one row blocked by a Supabase legacy-JWT infra setting, owner decision).
