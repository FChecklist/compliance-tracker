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
| A2 | `e2e/lf-file-uploads.spec.ts` (3 tests) | PM | WRITTEN + committed `52a5b7c7`, NOT RUN |
| A3 | Run A2 once (needs lock, RAM > 1.2 GB) | PM | PENDING |
| A4 | Plant-then-revert proof that A2 fails on broken code (R74-RULING-03) | PM | PENDING |
| A5 | Live run: one real permit upload vs live `/uploads/sign` (v11); 403 for client_viewer | PM | PENDING, needs network |
| A6 | Two laptops, same project, online + offline, conflict keep-mine/keep-theirs (one long wait, no 15 s reload) | PM | PENDING |
| A7 | Second-ORG isolation via Edge session layer + data-service key path | PM | PENDING, needs network |
| A8 | Laptop-to-laptop sync | PM | PENDING |
| A9 | Installed-laptop update pick-up (after #410 is in) | PM | PENDING, blocked by A12 |
| A10 | After #410: installer hook after `manifestDigestOk`, `RELEASE_ORIGIN` in projexa-sync, peer relay (spec `ai-os/audit37/RELEASE_DISTRIBUTION_2026-10-06.md`) | PM | PENDING, blocked by A12 |
| A11 | 111 Sumeet table pass/fail, closed only by the 6-condition rule; then Chrome run | PM | PENDING |
| A12 | Projexa PRs #409 #410 #412 #413: state | S2 (watchers) | VERIFY, no network |

### B. AWL / DPDP (repo `FChecklist/compliance-tracker`, PR #2119, branch `feat/awl-items-4-5-6-8`)
| ID | Item | Owner | State |
|---|---|---|---|
| B1 | Journal conflict markers removed; migration renumbered 0735→0736; commit `c7d605e7` pushed | S2 | DONE |
| B2 | Local commit `b972eb49` (merge with main + renumber) in `w-awl-guide2` | S2 | UNPUSHED, relation to B1 VERIFY |
| B3 | Move `0736_awl_person_card.down.sql` into `drizzle/down/` (fixes Migration Integrity AR-12) | S2 | PENDING |
| B4 | Add `-- PRE-APPROVED-LIVE-DDL:` citation to `0736_awl_person_card.sql` and its down file (fixes DDL Authorization). Wording: the owner's delegated PM authority for the 100-point audit, chat 2026-10-05, same as the neighbouring AWL migrations | S2 | PENDING |
| B5 | Regenerate `docs/master/TEST_COVERAGE_GAP.md` (`node scripts/report-test-coverage-gap.mjs`) | S2 | PENDING |
| B6 | Check whether `0735_awl_person_card` was ever applied live under its old name; reconcile ledger before 0736 runs (query `drizzle.__drizzle_migrations` + the live function) | S2 | VERIFY |
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
- [ ] B3 down script moved
- [ ] B4 DDL citations
- [ ] B5 coverage report regenerated
- [ ] B2 reconciled with `c7d605e7` (no lost commit)
- [ ] B6 live ledger checked
- [ ] A3 upload spec passes
- [ ] A4 upload spec fails on planted bug, then reverted
- [ ] Gate 1 recorded
- [ ] Merge locally, re-run batch
- [ ] 0736 applied live + verified
- [ ] A5, A6, A7, A8 live/peer tests
- [ ] A9, A10 (after #410)
- [ ] A11 Sumeet 111 table + Chrome run
- [ ] Gate 2 recorded
- [ ] Push once per repo, one PR each, one CI run
- [ ] Merge on green
- [ ] Deploy ritual, live check, static pages
