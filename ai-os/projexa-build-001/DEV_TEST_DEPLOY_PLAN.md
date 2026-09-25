# DEV_TEST_DEPLOY_PLAN - PROJEXA-BUILD-001

Development, testing and deployment plan for PROJEXA-BUILD-001.

| Field | Value |
|---|---|
| Date | 2026-09-25 |
| Written by | writer/architect agent for the project manager (Claude Code), owner Rajat Agarwal |
| Status | PLAN. Nothing in this file has been executed by its writer. Every command below is for the PM (or an agent the PM assigns) to run later. |
| Authority | PM_DECISIONS.md (PMD-01..PMD-21) wins over the work order where they differ; MERGE_MAP.md unified ids U-00..U-49; REGISTER_CONVENTIONS.md for register rows. PMD-21: the repo copy under `ai-os/projexa-build-001/` wins over the Drive copy. |
| Register ids | This file names register ids only as ranges (BR-1xx .. BR-5xx). The exact ids live in BOOLEAN_REGISTER.csv. |
| Commands | Git Bash syntax unless marked PowerShell. Inside tables, `\|` is the Markdown escape for a pipe `\|`; type a plain pipe when running the command. `<...>` marks a value filled in at run time. |

## How to read this document (plain language, for the owner)

- **Where work happens.** Code is written on this laptop, one small change at a time, each in its own folder (a git "worktree"). Tests that are cheap run on the laptop. Heavy checks (typecheck, full build, browser tests) run on GitHub's free servers, because this laptop has 8 GB of RAM and often less than 1 GB free.
- **What counts as "done".** A change is done only when a written yes/no check passes, the check was shown to FAIL when the change is removed, and the proof (commit id, PR number or a dated database reading) is written into the register.
- **What "deploy" means today.** Merging to GitHub, applying a database change to Supabase after a rehearsal, and publishing Supabase Edge Functions. **Vercel is not used.** Vercel stays locked until you, the owner, say "go live" in chat; every Vercel step in this plan is marked `blocked_owner`.
- **What can never happen without you.** Vercel recharge, anything that raises spend (for example a paid Supabase branch), and DNS changes (Amendment 001, PMD header).
- **Memory limit.** No new test run starts below 1.0 GB free RAM; below 1.5 GB free the PM reports it and starts nothing heavy (PMD-14).

## 0. Facts this plan stands on

Abbreviations for sources: DTDF = DEV_TEST_DEPLOY_FACTS.md; INV = INFRA_INVENTORY.md; LF = LIVE_FACTS_D09_D10_D11_RLS.md; IEF = IDENTITY_AND_EDGE_FINDINGS.md; BRD = BROWSER_READINESS.md; MM = MERGE_MAP.md; ADD-A = ADDENDUM_A; WO = WORK_ORDER; HO = PROMPT_PROJEXA_MASTER_HANDOFF; GM = gaps_master.json ids (F-..., M-...); LIVE-0925 = a read-only check made while writing this file on 2026-09-25 (git/gh/PowerShell, output quoted).

| # | Fact | Source |
|---|---|---|
| K-01 | compliance-tracker `main` = `d072b6ad` (PR #1836, the BUILD-001 claim, merged 2026-09-25T07:04:08Z). The evidence files were read at the earlier `025eea08`. | LIVE-0925 `gh api repos/FChecklist/compliance-tracker/commits/main`; `gh pr view 1836` |
| K-02 | projexa `main` = `e88b53e1` | LIVE-0925 `gh api repos/FChecklist/projexa/commits/main` |
| K-03 | compliance-tracker required checks, strict = true, 10 contexts: Lint; Type Check; Build; Unit Tests; Migration Number Collision Check; Migration Integrity Check (AR-12); Governance YAML Parse Check; Migration Schema Drift Check; Screen Definition Label Check; Graph Drift Check. 0 approving reviews, enforce_admins on. | LIVE-0925 `gh api .../branches/main/protection`; INV s3 |
| K-04 | projexa required checks: Lint; Type Check; Test; Build; Secret Scanning (strict true). | LIVE-0925; INV s3 |
| K-05 | Not required on compliance-tracker: Secret Scanning, E2E Tests, E2E Tests (Env-1, cross-repo), the route-error check job (ci.yml:169-170; its display name contains a word this package's linter bans, so it is cited by line), New Test Coverage Check, Register Consistency Check, Test Coverage Gap Report Check, Migration Replay From Empty (report-only). | INV s3 |
| K-06 | Required-check critical path is about 6 min; the non-required Env-1 job fails at about 28 min and makes the workflow report `failure`. | DTDF s2 (run 35967296740) |
| K-07 | Both repos are public; GitHub Actions minutes on standard runners are free for public repos (policy); live billing usage UNVERIFIED (API 404). | DTDF s2 |
| K-08 | No local Postgres (Docker, WSL, native Postgres absent). No deno. Local `supabase functions serve` needs Docker, so Edge Functions cannot run locally. `supabase functions deploy --use-api` works without Docker. supabase CLI 2.107.0, bun 1.3.14, node v26.3.1. | DTDF s1, s4 |
| K-09 | `bunfig.toml`: test root = `src`, preload `src/lib/db/test-guard-preload.ts` refuses to run unless DATABASE_URL / APP_RUNTIME_DATABASE_URL point at localhost or the known dev project. CI uses placeholder localhost URLs. `scripts/` tests need an explicit path. | DTDF s1; ci.yml:132, :136 |
| K-10 | Typecheck and `next build` need a 6144-8192 MB heap; they are CI-only on this laptop. | DTDF s1; CLAUDE.md Local Dev gotcha 3 |
| K-11 | Free RAM measured at 0.36 GB and 0.48 GB while this plan was written (below the 1.0 GB hard stop). | LIVE-0925 `Win32_OperatingSystem.FreePhysicalMemory` |
| K-12 | `C:\ct\ct-worktrees\b001-p1\node_modules` and `...\b001-u01\node_modules` are Junctions to `C:\ct\ct\node_modules`. `bun.lock` and `package.json` are identical between `C:\ct\ct` HEAD (`4679ef67`) and origin/main (`git diff --quiet` exit 0). | LIVE-0925 |
| K-13 | Worktree branches already in use: `feat/build-001-phase1` (b001-p1, commit `12def0de`, PR #1837 open) and `feat/build-001-u01-redaction` (b001-u01, at `025eea08`, no PR yet). | LIVE-0925 `git branch --show-current`, `gh pr list` |
| K-14 | Draft PR #1808 `golive/cost001-vercel-json` is open and draft; its body says "DO NOT MERGE until the owner says go live". | LIVE-0925 `gh pr list`; DTDF s3 |
| K-15 | Both `vercel.json` files carry `ignoreCommand: sh -c 'exit 0'` (every Vercel build skipped). | DTDF s3; INV s1 |
| K-16 | Rollback convention exists: `docs/ROLLBACK_RUNBOOK.md` (6811 B on origin/main) and `drizzle/down/0217_...down.sql`, `drizzle/down/0220_...down.sql`. | LF (b); LIVE-0925 `git ls-tree` |
| K-17 | Latest migration on `d072b6ad`: `drizzle/0612_dpdp_wo010_my_clients_stage_fix.sql`; journal has 442 entries (last idx 443). Next free number today is 0613. | LIVE-0925 `git ls-tree`, `_journal.json` |
| K-18 | Four migration ledgers disagree: 449 drizzle files, 442 journal entries, 438 drizzle ledger rows, 655 Supabase ledger rows. | LF (b); F-A05-4 |
| K-19 | Whole-folder PGlite replay applies only 50 of 360 entries (first failure at position 3). | DTDF s4; CLAUDE.md Commands |
| K-20 | A Supabase branch costs 0.01344 per hour (spend increase, owner-only; PMD-10). | DTDF s4; LF (b) |
| K-21 | [removed from the public copy: see the private KT folder] | IEF s1; F-A12-5 |
| K-22 | `tsconfig.json` excludes `supabase/functions`, so the Type Check job never type-checks Edge Function code. | LIVE-0925 `git cat-file blob origin/main:tsconfig.json` |
| K-23 | GitHub Actions has never connected to Supabase successfully from db-migrate.yml (0 successes, password authentication failure). | DTDF s4 |
| K-24 | No feature-flag module exists on origin/main (`git grep -i "feature.?flag\|kill.?switch"` under src/lib hits only a schema comment). | LIVE-0925 |
| K-25 | In Git Bash on this laptop, `git cat-file blob origin/main:<path>` and `git show origin/main:<path>` fail or truncate unless `MSYS_NO_PATHCONV=1` is set, and `git show` truncated a 6262-byte file to 2224 bytes. | LIVE-0925 (error `Not a valid object name origin\main;...`); F-A12-3 |
| K-26 | pg_cron 1.6.4 and pg_net 0.20.3 run on verdian-ai; cron.job holds `dpdp-monday-digest` (30 0 * * 1) and `dpdp-legal-clocks` (30 3 * * *). PROJEXA's own project has no `cron` schema. | INV s6; IEF s2 |

## 1. Environments and wiring parity

### 1.1 The five environments

| Env | What it is used for | What runs there | What never runs there |
|---|---|---|---|
| E1 Local laptop (`C:\ct\ct`, `C:\ct\projexa`, worktrees under `C:\ct\ct-worktrees\`) | Writing code; single-file unit tests; node migration checks; SQL assertions (SELECT only) against live Supabase; git; gh reads; Edge Function deploy CLI; plan linter | `bun test --isolate <one file>`; `node scripts/check-migration-collision.mjs --base origin/main`; `node scripts/check-migration-integrity.mjs`; `node scripts/verify/sql-assert.mjs ...`; `python ai-os/projexa-build-001/lint_plan.py ai-os/projexa-build-001`; `supabase functions deploy ... --use-api` | Whole-suite tests, typecheck, `next build`, Playwright, `bun run db:push`, `bun run db:migrate` against live, any Vercel CLI command |
| E2 Supabase verdian-ai `pcrjmlpuqsbocqfwoxod` | The only database for compliance-tracker data (all BOQ/construction data), production and development at once (no staging exists, K-20) | SELECT reads; aborted-transaction rehearsals; `apply_migration` after rehearsal; PROJEXA-owned Edge Functions (`projexa-*`); PROJEXA-owned pg_cron jobs (`projexa-*`) | [removed from the public copy: see the private KT folder] |
| E3 Supabase projexa `evpckeuxgvahguwsaeul` | PROJEXA sign-in (114 auth users), PROJEXA's own 22 public tables, JWKS used by the identity gateway | Reads of `/auth/v1/.well-known/jwks.json` (public); projexa-repo migrations that pass projexa's "Migration guard (additive-only)" job | compliance-tracker migrations; pg_cron (not installed, installing needs an ACTIVE-CLAIMS entry first, INV s6) |
| E4 GitHub (both repos, `ubuntu-latest`) | Source of truth; CI: lint, typecheck, build, whole unit suite with `--isolate`, Playwright, migration checks, secret scan | ci.yml jobs (K-03, K-05); sentinel.yml `secret-scan`; projexa ci.yml | Database connections for SQL assertions (K-23: the verify SQL rows therefore run on E1 by the PM); any Vercel deploy |
| E5 Vercel (both projects) | Production web hosting, **locked** | Nothing. `ignoreCommand: sh -c 'exit 0'` (K-15) | Any deploy, unpause, setting, env or DNS change (PMD-11); every item that needs it is `blocked_owner` |

### 1.2 Wiring: what connects to what

| From | To | How | Allowed in BUILD-001 |
|---|---|---|---|
| E1 unit test | database | Placeholder localhost URLs; DB layer faked in the test; the preload guard refuses real remote URLs (K-09) | yes |
| E1 PM script | E2 | `node scripts/verify/sql-assert.mjs --project ct` with `VERIFY_DATABASE_URL` set in the PM's shell (never committed, never printed); SELECT only; exit 3 when the variable is unset | yes, SELECT only |
| E1 PM | E2 | Supabase MCP `execute_sql` (SELECT, and the always-aborted rehearsal DO block of s2.6), `apply_migration` (after rehearsal), `list_edge_functions`, `get_edge_function`, `query_logs` | yes, per s2.6 and s4 |
| E1 PM | E2 Edge | `supabase functions deploy <name> --project-ref pcrjmlpuqsbocqfwoxod --use-api` from a clean worktree at the merge SHA | yes, `projexa-*` names only |
| E2 pg_cron | E2 Edge | `net.http_post` with URL and bearer read from `vault.decrypted_secrets` (reference `dpdp-legal-clocks`, 3 of 3 runs HTTP 200) | yes, one job per PR (PMD-12) |
| PROJEXA browser | E2 Edge `projexa-read` | PROJEXA ES256 access token verified against E3 JWKS; person resolved via `compliance.users.auth_user_id`; query as `app_runtime` with `app.current_org_id` set (PMD-01) | yes, Phase 3-4 |
| PROJEXA server | compliance-tracker `/api/v1/projexa/*` | Per-org Bearer API key plus `X-Acting-User` headers (IEF s3b) | code changes yes; runs only locally or after go-live |
| E4 CI | E2 | Migration Integrity job uses the `DATABASE_URL` secret read-only and degrades to a warning when unreachable (ci.yml comment) | unchanged |
| anything | E5 | none | no |

### 1.3 Parity gaps and how each is closed or accepted

| Gap | What differs | Decision | Boolean check (exit 0 = holds) |
|---|---|---|---|
| P-01 | No local Postgres (K-08) | ACCEPTED. Unit tests fake only the DB layer (reference `src/app/api/v1/construction/boq/route.test.ts`, PR #1606); live facts come from SELECT-only `sql-assert.mjs`; schema changes are rehearsed in an aborted transaction on E2 and replayed on PGlite (s2.6). | `test -f scripts/verify/sql-assert.mjs` (created by a BR-1xx row) |
| P-02 | No local typecheck or build (K-10, K-11) | ACCEPTED. Type Check and Build are required contexts on every PR. | `test "$(gh api repos/FChecklist/compliance-tracker/branches/main/protection --jq '.required_status_checks.contexts \| index("Type Check") != null')" = "true"` |
| P-03 | No local Playwright | ACCEPTED. Browser tests run only in CI (E2E Tests; E2E Tests (Env-1, cross-repo)). U-24 makes the PROJEXA half a required check. | BR-3xx U-24 rows |
| P-04 | No local Edge runtime (K-08) | CLOSED by design: every Edge Function keeps its logic in plain TypeScript modules that bun can import and test; `index.ts` only wires `Deno.serve` to them. After deploy, a curl smoke check hits the Supabase URL (not Vercel). | `test "$(curl -s -o /dev/null -w '%{http_code}' https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/<name>)" = "401"` for a function that demands a token |
| P-05 | Edge Function code is outside Type Check (K-22) and outside the bun test root (K-09) | CLOSED in part: the first PR that adds `supabase/functions/projexa-*` also adds a step `bun test --isolate ./supabase/functions` to the Unit Tests job of ci.yml. Type checking of Edge code stays ACCEPTED as a gap (no deno on the laptop; a CI deno check is UNVERIFIED and not planned). | `test "$(git grep -c -F 'bun test --isolate ./supabase/functions' -- .github/workflows/ci.yml \| awk -F: '{s+=$2} END {print s+0}')" = "1"` |
| P-06 | Four migration ledgers disagree (K-18) | ACCEPTED. Rollback proof compares schema hashes before and after on the SAME database, never branch against production (F-A05-4). No BUILD-001 PR hand-edits a ledger. | BR-2xx rehearsal rows |
| P-07 | Whole-folder PGlite replay breaks at entry 3 (K-19) | CLOSED for BUILD-001 migrations only: `scripts/verify/rollback-replay.sh` seeds PGlite with the CREATE statements of the tables each migration touches, then applies forward and down files and compares hashes (M-A11-5). | `bash scripts/verify/rollback-replay.sh` prints `SCHEMA_HASH_MATCH` (BR-2xx) |
| P-08 | Development and production share one database (E2) | ACCEPTED. Controls: SELECT-only verification; migrations only after merge and rehearsal; additive before restrictive (s2.6 M-12); every behaviour change behind a named flag (s2.7). | s2.6 and s2.7 rows |
| P-09 | CI cannot reach Supabase (K-23) | ACCEPTED. SQL-form register rows (F1) run on E1 by the PM with a dated result; in CI they exit 3 and are not used as CI gates. | n/a (process rule) |
| P-10 | E2E Env-1 job fails on every run (K-06) | OPEN, fixed by U-24 (Phase 3). Until then it is informational and does not block merge. | BR-3xx U-24 exit row |
| P-11 | Scheduled workflows fail on every run: compliance-tracker Domain Ownership Drift Check (cause UNVERIFIED), projexa Email Digest Poll (secrets unset), projexa Claude Nightly Maintenance (F-A12-1) | Phase 1 read-only diagnosis of the drift-check failure from its run log; projexa Email Digest Poll stays failing until U-21/E-05 replaces its path. No spend impact (public repos, K-07). | `test "$(gh run list --repo FChecklist/compliance-tracker --workflow domain-drift-check.yml --limit 1 --json conclusion --jq '.[0].conclusion')" = "success"` (after diagnosis and fix) |
| P-12 | Local `.env.local` may point at the wrong Supabase project (CLAUDE.md R72 item) | CHECK at session start: compliance-tracker worktrees must reference `pcrjmlpuqsbocqfwoxod`, never `evpckeuxgvahguwsaeul`. The check prints a count only, never a value. | `test "$(grep -c evpckeuxgvahguwsaeul C:/ct/ct/.env.local)" = "0"` |
| P-13 | Node on the laptop is v26.3.1; the Vercel runtime version is UNVERIFIED | ACCEPTED until go-live; recorded as a go-live check (s4.6 V-08). | n/a |
| P-14 | No Sentry telemetry locally (R72 parity register) | ACCEPTED. | n/a |
| P-15 | Git Bash path conversion breaks `origin/main:<path>` (K-25) | CLOSED by rule: every such command is prefixed `MSYS_NO_PATHCONV=1`, and file reads use `git cat-file blob` with a byte-size check (`git cat-file -s`). | `test "$(MSYS_NO_PATHCONV=1 git cat-file -s origin/main:R72_DEPLOY_RITUAL.md)" = "6262"` (value from DTDF s3 at `025eea08`; re-read if the file changes) |
| P-16 | Worktrees with full node_modules copies (F-A12-6) | CLOSED for BUILD-001: every BUILD-001 worktree uses a Junction (s2.3). Old worktrees are not touched by this plan. | s2.3 W-4 |

## 2. Development plan

### 2.1 Session start (run in this order, every session, every day)

| Step | Command (Git Bash unless marked) | Pass condition |
|---|---|---|
| S-1 RAM above hard stop | `powershell -NoProfile -Command "if ((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory -ge 1048576) {exit 0} else {exit 1}"` | exit 0 (at least 1.0 GB free). Exit 1 = start no bun process and no agent burst; report the number. |
| S-2 RAM above warn line | same command with `1572864` | exit 0 (at least 1.5 GB). Exit 1 = report it; reads, docs and git only. |
| S-3 Orphaned `tsc` processes removed | `powershell -NoProfile -File C:/ct/ct/scripts/windows-dev-process-guard.ps1 -Cleanup` | exit 0 (script exists on origin/main, LIVE-0925) |
| S-4 No bun process running | `powershell -NoProfile -Command "if (@(Get-Process bun -ErrorAction SilentlyContinue).Count -eq 0) {exit 0} else {exit 1}"` | exit 0 before any new bun command |
| S-5 Local main equals GitHub main | `git -C C:/ct/ct fetch origin main && test "$(git -C C:/ct/ct rev-parse origin/main)" = "$(gh api repos/FChecklist/compliance-tracker/commits/main --jq .sha)"` | exit 0 |
| S-6 BUILD-001 claim present on main | `MSYS_NO_PATHCONV=1 git -C C:/ct/ct cat-file blob origin/main:ai-os/boss/ACTIVE-CLAIMS.yaml \| grep -q 'BUILD-001'` | exit 0 (LIVE-0925: 2 matches on `d072b6ad`) |
| S-7 No conflicting fresh claim | PM reads the `active:` entries newer than 4 hours with a python slice (the file is 450 KB, never read whole; DTDF s5) and checks `gh pr list` for their PRs | no active entry claims the files of the PR about to start; any conflict is reported, not worked around |
| S-8 Env points at the right project | P-12 command | exit 0 |

### 2.2 Claim first, as its own PR

- The BUILD-001 claim was registered by PR #1836 (merged, `d072b6ad`, K-01).
- Before each phase starts, the PM opens one docs-only PR that edits only `ai-os/boss/ACTIVE-CLAIMS.yaml`, updating the BUILD-001 entry's scope to that phase's files (keys `session_label`, `claimed_at`, `claim`; DTDF s5 format). That PR merges on green before the phase's first code PR.
> [removed from the public copy: see the private KT folder]
- When a phase's work merges, its entry moves to `recently_completed:` with `completed_at` in the same kind of docs-only PR.
- Boolean check (M-A12-6): `MSYS_NO_PATHCONV=1 git -C C:/ct/ct cat-file blob origin/main:ai-os/boss/ACTIVE-CLAIMS.yaml | grep -q 'BUILD-001'` exit 0.

### 2.3 Worktree and branch discipline

| Rule | Exact form |
|---|---|
| W-1 One worktree per PR | `git -C C:/ct/ct worktree add C:/ct/ct-worktrees/b001-<uid>-<slug> -b feat/build-001-<uid>-<slug> origin/main` (naming follows K-13). projexa: `git -C C:/ct/projexa worktree add C:/ct/projexa-b001-<uid>-<slug> -b feat/build-001-<uid>-<slug> origin/main`. |
| W-2 Lockfile parity before a junction | `git -C C:/ct/ct diff --quiet origin/main HEAD -- bun.lock package.json` exit 0 (K-12). For projexa the same command in `C:/ct/projexa`. If exit 1, the PM first brings the base checkout's node_modules in line in a separate step (one `bun install`, S-1..S-4 first) or the PR runs no local tests. |
| W-3 Junction node_modules, never copy | PowerShell: `New-Item -ItemType Junction -Path C:\ct\ct-worktrees\b001-<uid>-<slug>\node_modules -Target C:\ct\ct\node_modules` (projexa: target `C:\ct\projexa\node_modules`, precedent `C:\ct\projexa-coldload-remaining`, DTDF s1) |
| W-4 Junction check (M-A12-1) | `powershell -NoProfile -Command "if ((Get-Item C:\ct\ct-worktrees\b001-<uid>-<slug>\node_modules -Force).LinkType -eq 'Junction') {exit 0} else {exit 1}"` exit 0 |
| W-5 No dependency change on a junction | A PR that changes `package.json` or `bun.lock` is its own PR, runs no local bun command, and is verified by CI only. BUILD-001 feature PRs add no dependencies unless the U-item states why. |
| W-6 Remove after merge | `git -C C:/ct/ct worktree remove C:/ct/ct-worktrees/b001-<uid>-<slug>` after the merge SHA is recorded (the junction goes with it; the shared node_modules stays). |
| W-7 Existing BUILD-001 worktrees | `b001-p1` (PR #1837) and `b001-u01` (U-01, no PR yet) already follow W-1..W-4 (K-12, K-13). |
| W-8 Never on the base checkout | No BUILD-001 commit is made in `C:\ct\ct` itself (it sits on `chore/vercel-zero-spend-lockdown`, gitStatus). |

### 2.4 PR size and merge-on-green (Amendment 001)

- **One U-item per PR** (a U-item may need several PRs; a PR never carries two U-items). Plan and register edits go in docs-only PRs under `ai-os/projexa-build-001/`.
- **Size cap:** at most 20 files and at most 600 added plus deleted lines, not counting `*.test.ts`, test fixtures and `ai-os/projexa-build-001/**`. Check: `test "$(git diff --numstat origin/main...HEAD -- . ':(exclude)*.test.ts' ':(exclude)*.test.tsx' ':(exclude)ai-os/projexa-build-001/**' ':(exclude)**/fixtures/**' | awk '{s+=$1+$2} END {print (s<=600)?"ok":"over"}')" = "ok"`. A PR over the cap is split before it is opened.
- **Green means (M-A12-2):** all 10 required contexts of K-03 concluded `success` on a head SHA that contains current `main` (strict = true). Command: `gh pr checks <n> --repo FChecklist/compliance-tracker --required` exit 0. projexa: the 5 contexts of K-04.
- **Also required by this plan, on top of branch protection:** (a) every check-run on the head SHA is `success`, `skipped` or `neutral`, except the two informational ones `E2E Tests (Env-1, cross-repo)` and `Migration Replay From Empty (E-103, report-only)`; this closes the gap where exact-name polling misses suffixed job names (owner memory note "PR merge poll check-name gap"). (b) Secret Scanning is `success` even before U-07 makes it required. (c) the PR's own register rows were run by the PM (s3.4).
- **Merge:** `gh pr merge <n> --repo FChecklist/compliance-tracker --squash --delete-branch` (recent history is squash merges, for example `6ea52079 ... (#1791)`). No human approval step exists (0 reviews required, K-03; Amendment 001).
- **After merge:** confirm the check-runs on the merge SHA. The workflow-level conclusion cannot be used while the Env-1 job fails (K-06), so count failed check-runs other than Env-1: `test "$(gh api repos/FChecklist/compliance-tracker/commits/<merge_sha>/check-runs --paginate --jq '[.check_runs[] | select(.conclusion=="failure") | .name] | map(select(. != "E2E Tests (Env-1, cross-repo)")) | length')" = "0"` exit 0.
- **Audit comment:** every code PR gets a review by a different agent than the author (AGENTS.md Rule 7(c)); the verdict is a PR comment whose first line is `AUDIT: PASS` or `AUDIT: FAIL`. A PR with `AUDIT: FAIL` does not merge.
- **PR body lines (fixed):** `U-id:`, `Register rows:` (BR ids), `Flag:` (name and default, or `none - security fix`), `Mutation:` (name, exit code with the fix removed), `Rollback:` (command), `RAM free at start/end:` (GB).

### 2.5 Per-phase development task list with file scopes

File paths are on origin/main unless marked NEW. "ct" = compliance-tracker, "px" = projexa. Evidence for each path is in MM s0/s5, LF, IEF, BRD, GATE_2_8_FINDINGS.md.

**Phase 1 - ground observable**

| U-id | Work | Files | Schema change | Owner-blocked |
|---|---|---|---|---|
| U-00 | Amendment log | ct `ai-os/projexa-build-001/AMENDMENT_LOG_BUILD-001.md` (NEW) | no | no |
| U-01 | Close the 4 role-dropping points (PMD-04) | ct `src/app/api/mcp/[token]/route.ts` (:58, :68), `src/lib/pipeline/executor.ts` (:372), `src/app/api/v1/projexa/assistant/route.ts` (:56, :77), `src/lib/task-execution/construction-tools.ts` (:95); test `src/lib/pipeline/financial-redaction.test.ts` (NEW) | no | no |
| U-02 | Sitemap with provenance header | ct `ai-os/projexa-build-001/PROJEXA_ROUTE_SITEMAP_projexa_main.md` (NEW, from the staging file built on px `e88b53e`) | no | no |
| U-03, U-04, U-05, U-08, U-09, U-10, U-12 | Plan package files | ct `ai-os/projexa-build-001/` (CONTRADICTIONS_RESOLVED.md, REQUIREMENTS_111_REGISTER.csv, BOOLEAN_REGISTER.csv, lint_plan.py, CRON_PLACEMENT.csv, EDGE_CANDIDATES.csv, reference note, surface_matrix.json) | no | no |
| U-05 support | SQL assertion runner and its self-test | ct `scripts/verify/sql-assert.mjs`, `scripts/verify/sql-assert.test.ts` (NEW) | no | no |
| U-06 | Speed Insights charge reads 0.0000 (date-gated, Pacific day from 2026-09-26T07:00Z; one billing call per day, F-A08-3/4) | ct read-only billing script under `scripts/verify/` (NEW, named in its BR-1xx row) | no | no (reading only) |
| U-07 | Make Secret Scanning a required context; committed self-test | GitHub branch-protection setting (gh api, records the previous list first); ct `scripts/verify/secret-scan-selftest.sh` (NEW) | no | no |
| U-11 | Shared boundary file | ct `ai-os/SHARED_BOUNDARY.md` (NEW) | no | no |
| U-13 | DPDP-track questions Q-D1/Q-D2 recorded; PROJEXA guard row only | none in PROJEXA scope | no | no |
| U-14 | Provider gate decision recorded (PMD-02); gate tests | ct `src/lib/ai/adapter.gate-2-8.test.ts`, `src/app/api/v1/projexa/tasks/route.gate.test.ts` (PR #1837, open) | no | yes for the openrouter switch only |
| U-15 | De-advertise the 13 unimplemented MCP tools | ct `src/app/api/mcp/route.ts` (getToolDefinitions :252-284) | no | no |
| U-43 | External AI link makes zero server-side model calls | ct `src/app/api/mcp/[token]/route.ts`, `src/lib/pipeline/run-submission.ts` | no | no |
| (flags) | Flag module used by every later behaviour change | ct `src/lib/flags/build001.ts` + test (NEW, first PR that needs a flag) | no | no |
| (docs) | Correct stale deploy docs (F-A12-2) | ct `R72_DEPLOY_RITUAL.md`, `VERCEL_DEPLOY_OWNER_GUIDE.md` | no | no |

**Phase 2 - identity, scope, attribution**

| U-id | Work | Files | Schema change | Owner-blocked |
|---|---|---|---|---|
| U-16 | Q5/Q6 answers recorded (PMD-07, PMD-08; owner may override) | ct `ai-os/projexa-build-001/OWNER_QUESTIONS.md` | no | yes (override only) |
| U-17 | Rollback tooling | ct `scripts/verify/schema-hash.sql` (with grants section, M-A05-6), `scripts/verify/rollback-rehearsals.sh`, `scripts/verify/rollback-replay.sh` (NEW) | no | no |
| U-18 | `platform.user_ai_links.project_id` + cross-project 403; revoke the 2 legacy org-wide links | ct `drizzle/0NNN_*.sql` + `drizzle/down/0NNN_*.down.sql` (hand-written, platform schema), `src/lib/db/schema.ts`, `src/app/api/mcp/[token]/route.ts`, the link-mint code path (file located by `git grep -n user_ai_links` at PR time) | yes | no |
| U-19 | `compliance.api_keys.project_id` NULLABLE + `key_kind` check (org_service / project_ai) | ct migration pair, `src/lib/db/schema.ts`, `src/lib/supabase/auth-guard.ts` (validateApiKey), shared dispatch in `src/lib/pipeline/executor.ts` | yes | no |
| U-20 | Per-request actor attribution | ct `src/lib/audit.ts` (:114-116), `src/lib/supabase/auth-guard.ts` (resolveActingUser), the `apiKey: {` logActivity call sites (48 lines, LF (a)) | maybe (a column for key id plus user together; stated in the PR) | no |
| U-21 | One cron ported: exchange-rate-refresh to pg_cron -> pg_net -> Edge Function (PMD-12) | ct `supabase/functions/projexa-exchange-rate-refresh/` (NEW), migration pair creating the job and `projexa_*` vault secret names (values set by the PM, never committed) | yes (cron.job row) | no |
| U-44 | Universal AI work link spec + audit | ct `ai-os/projexa-build-001/UNIVERSAL_AI_WORK_LINK_SPEC.md` + audit file | no | no |
| U-45 | Conformance harness committed (from the staging `ai_link_conformance.py`, `ai_link_mock_server.py`, `ai_link_selftest.py`: 20 checks H01-H20, self-test with named breaks) | ct `src/lib/ai-links/conformance.test.ts` + harness files (NEW) | no | no |
| U-49 | Gate compares the acting person; level1 telemetry on every path; refusal text carries records | ct `src/lib/ai/adapter.ts`, `src/lib/pipeline/run-submission.ts` (:1297-1312), the 4 routes using `ctx.dbUser?.id ?? ctx.apiKey!.id` | no | no |

**Phase 3 - evidence standard**

| U-id | Work | Files | Schema change | Owner-blocked |
|---|---|---|---|---|
| U-22 | Evidence columns on `platform.sumeet_requirements` (verify_command, evidence_ref; F-A11-3) and the 31 EXC-ITEM rows | ct platform migration pair; data rows written by a committed script | yes | no |
| U-23 | `verify:all` (bun, not npm; M-A07-3) | ct `package.json` script, `scripts/verify-all.mjs`, `scripts/verify/verify-all-local.sh`, `scripts/verify/verify-all-deployed.sh` (NEW) | no | deployed half yes |
| U-24 | PROJEXA Playwright half runs and is required | ct `.github/workflows/ci.yml` (e2e-env1 job), branch-protection contexts | no | no |
| U-25 | Identity gateway spike then `projexa-read` (PMD-01) | ct `supabase/functions/projexa-read/` (NEW), `scripts/check-projexa-identity-links.mjs` (NEW), `scripts/e2e/projexa-gateway-isolation.mjs` (NEW); data: link the 22 unlinked users (IEF s3b) | data only | no |
| U-26 | Zero service_role in browser bundles, measured on the built bundle (F-A10-1) | ct `.github/workflows/ci.yml` job "Browser Bundle Service-Role Scan" (NEW) | no | no |

**Phase 4 - one record type (BOQ line item, PMD-20) on four surfaces**

| U-id | Work | Files | Schema change | Owner-blocked |
|---|---|---|---|---|
| U-27 | Keyset pagination on (boq_id, id) | ct `src/lib/services/construction-boq-service.ts` (listBoqs :753-847, getBoq :1091, listBoqLineOptions :1011-1037), `src/app/api/v1/construction/boq/route.ts`; px `src/app/api/scope/route.ts`, `scope/[id]/route.ts`, `scope/lines/route.ts` | maybe (index on (boq_id, id)) | no |
| U-28 | BOQ registry entries; `executeCreateBoqRevision` forwards lineItems / allowScopeReductionOverride / sourceChangeOrderId | ct `src/lib/pipeline/executor.ts` (:485-492, :672-685) | no | no |
| U-29 | Surface 1: AI-prepared approval page | ct route `src/app/api/v1/projexa/projects/[id]/approvals/route.ts` (NEW); px page (NEW) | no | no |
| U-30 | Q3 recorded (PMD-05 proposals only); Q4 DNS records prepared | ct `ai-os/projexa-build-001/OWNER_QUESTIONS.md` | no | yes (DNS) |
| U-31 | Email bridge: read Resend attachments, promote into EXECUTORS as proposals | ct `src/lib/services/email-intelligence-service.ts` and the inbound route (located at PR time) | maybe | live half yes (DNS) |
| U-32 | One record id on 4 surfaces with 4 attributed audit rows | ct `compliance.audit_logs` surface column migration pair; proof runner | yes | surface 4 yes |
| U-33 | Browser-first BOQ (offline, Web Worker filter) | px `src/components/.../BoqDualViewGrid.tsx`, `ScopeObjectClient.tsx`, a Worker file (NEW), `src/app/sw.js/route.ts` | no | E-11/E-12 rows yes (need Vercel live) |
| U-46 | Link endpoints on Supabase Edge (Markdown manual, OpenAPI, MCP, REST; project + user scoped) | ct `supabase/functions/projexa-ai-link/` (NEW; name fixed in the U-46 PR) | maybe | no |
| U-47 | Paste-back fallback page | ct and px page (NEW) | no | no |

**Phase 5 - replicate, then perception**

| U-id | Work | Files | Schema change | Owner-blocked |
|---|---|---|---|---|
| U-34 | Q1 recorded (PMD-03 order) | OWNER_QUESTIONS.md | no | yes (override only) |
| U-35 | COST_BUDGET.csv with per-call ceilings | ct `ai-os/projexa-build-001/COST_BUDGET.csv` | no | no |
| U-36 | Extend `document-extraction-service.ts` (xlsx multi-sheet, BOQ/project schema, idempotent, schema-validated) and host the LLM call in `projexa-document-extract` | ct `src/lib/services/document-extraction-service.ts`, `src/lib/ingest/parser.ts`, `supabase/functions/projexa-document-extract/` (NEW); `llm-client.ts` Node-only path stays server-side (F-A10-4) | maybe (idempotency key) | no |
| U-37 | POST projects/from-document reusing createProject()/createBoq() | ct route (NEW) | no | no |
| U-38 | Remaining registry entries incl. create_drawing (createDrawingRecord, document-service.ts:224) and create_mom (createVeriMeeting, veri-meeting-service.ts:279) | ct `src/lib/pipeline/executor.ts` | no | no |
| U-39 | Implement or drop the 13 MCP tools with role threading | ct `src/app/api/mcp/route.ts` (handleTool) | no | no |
| U-40 | Scheduler bridge pg_cron -> Edge -> runSubmission | ct `supabase/functions/projexa-scheduler-bridge/` (NEW), migration pair for the job | yes (cron.job row) | no |
| U-41 | At most 2 Vercel crons, none `*/N`; lockdown test guards the crons array (F-A07-6) | ct `src/lib/vercel-lockdown.test.ts`; `vercel.json` in both repos (edit prepared only; merged together with the owner release because `vercel.json` is under the COST-001 claim and PR #1808) | no | merge of vercel.json yes |
| U-42 | All 28 surface cells proven | proof runner + surface_matrix.json | no | s4 cells yes (DNS) |
| U-48 | Owner acceptance run across 9 AI families | `AI_FAMILY_ACCEPTANCE.csv` | no | yes |

### 2.6 Migration discipline

Every schema change follows M-1 to M-12. A step that fails stops the item; the failure is reported (s3.5).

| Step | Rule | Command / pass condition |
|---|---|---|
| M-1 Number | Next free number on current main (0613 on `d072b6ad`, K-17). | `node scripts/check-migration-collision.mjs --base origin/main` exit 0 |
| M-2 Forward file | `drizzle/NNNN_<tag>.sql`, wrapped in BEGIN/COMMIT, LF line endings (`.gitattributes` forces LF for new drizzle SQL), header with U-id, BR ids, "additive: yes/no", lock notes. compliance schema: `bun run db:generate` (one bun process, S-1..S-4 first); platform schema: hand-written (CLAUDE.md Commands). Journal entry with a `when` greater than every earlier entry. | `node scripts/check-migration-integrity.mjs` exit 0 (its DB-free leg checks the `when` order) |
| M-3 Down file | `drizzle/down/NNNN_<tag>.down.sql`, BEGIN/COMMIT, header states data-loss conditions (convention of 0217/0220, K-16). BUILD-001 requires a down file for EVERY migration, additive or not (stricter than ROLLBACK_RUNBOOK.md). | `test -f drizzle/down/NNNN_<tag>.down.sql` |
| M-4 schema.ts in the same PR | Every added or changed column is declared in `src/lib/db/schema.ts` (CLAUDE.md drift note). | reviewer check plus the U-item's unit test importing the table object |
| M-5 No DPDP objects | The diff adds no line naming a dpdp object (PMD-18). | `test "$(git diff origin/main...HEAD -- drizzle | grep -c -i -E '^\+.*dpdp')" = "0"` |
| M-6 Schema hash | `scripts/verify/schema-hash.sql` = the LF (b) hash query plus a grants section from `information_schema.role_table_grants` (M-A05-6), returning one text column. | two runs in a row on an idle database print the same md5 |
| M-7 Aborted-transaction rehearsal on E2 | Supabase MCP `execute_sql` with the LF (b) DO block: `set local lock_timeout = '3s'`; h0; forward body; h1; down body; h2; `raise exception 'PASS_ROLLED_BACK ...'`. Nothing persists (DDL is transactional). Run outside the cron minutes 00:30 UTC Monday and 03:30 UTC daily (K-26). | returned error text starts with `PASS_ROLLED_BACK`; h1 differs from h0; h2 equals h0; h0/h1/h2 written into the PR body |
| M-8 PGlite replay | Seeded with the CREATE text of the touched tables only (P-07). | `bash scripts/verify/rollback-replay.sh` prints `SCHEMA_HASH_MATCH` |
| M-9 CI | Migration Number Collision, Migration Integrity (AR-12), Migration Schema Drift are required contexts (K-03). | `gh pr checks <n> --required` exit 0 |
| M-10 Apply after merge | PM only. Re-run the hash; if it no longer equals h0 (another session changed the schema, LF (b) note), re-run M-7 first. Then Supabase MCP `apply_migration` on `pcrjmlpuqsbocqfwoxod`, name `NNNN_<tag>`, body = forward file without its BEGIN/COMMIT. Record h1 after apply. | the item's F1 SQL rows pass; `node scripts/check-migration-integrity.mjs` (read-only DATABASE_URL) reports 0 orphaned entries. Whether an MCP apply writes a `drizzle.__drizzle_migrations` row is UNVERIFIED: if the check reports the new entry as unapplied, the PM stops and reports; nobody hand-inserts ledger rows. |
| M-11 Forbidden | `bun run db:push`; `bun run db:migrate` against live (it applies EVERY journal entry missing from the ledger, including other sessions' entries); Supabase branches (PMD-10); applying anything under `supabase/prepared/cost001/` (COST-001 claim, F-A07-2). | reviewer check |
| M-12 Order for restrictive changes | Expand then contract: (1) additive migration (nullable column, new table, new index) applied; (2) code that writes it merged; (3) data backfill or revocation (for U-18: revoke the 2 legacy org-wide links, PMD-08) with before-image ids in the PR body and the inverse UPDATE in the down file; (4) only then the NOT NULL or CHECK step as its own migration with its own M-7 rehearsal. | each of the 4 steps has its own BR-2xx row |

### 2.7 Feature flags and kill switches

**Mechanism (none exists today, K-24).**
- ct and px each get one module `src/lib/flags/build001.ts` (NEW) holding a table of flag names and code defaults. A flag reads `process.env.<NAME>` when set, else the code default.
- Vercel env changes are owner-only (PMD-11), so **the code default is the production value**. Flipping a flag in production = a one-line PR changing the default, merged on green. Locally and in tests the env variable sets either side.
- Edge Functions read `Deno.env.get('<NAME>')` with a code default; the PM flips them with `supabase secrets set <NAME>=true|false --project-ref pcrjmlpuqsbocqfwoxod` (values never printed). Whether a running function sees a changed secret without a redeploy is UNVERIFIED; after every flip the PM runs the function's curl smoke check and redeploys from the same merge SHA when the check shows the old value.
- pg_cron jobs are switched off with `select cron.alter_job(job_id := (select jobid from cron.job where jobname = '<job>'), active := false);` and removed with `select cron.unschedule('<job>');`.
- **Every flag is tested on both sides** (one test case with the flag on, one with it off). A flag whose off side has no test does not merge.
- **Security fixes carry no switch that re-opens the defect.** For U-01 and U-26 the only rollback is `git revert`. Security-relevant switches fail closed: "off" refuses the request instead of restoring the old, open behaviour.
- Flag inventory check (register F4 form): `test "$(git grep -c -E '^  BUILD001_[A-Z0-9_]+: (true|false),' -- src/lib/flags/build001.ts | awk -F: '{s+=$2} END {print s+0}')" = "<n>"`, with n = number of ct flags in the table below at that point in time.

| Flag (repo / place) | U-id | Default at merge | Effect when OFF (kill) |
|---|---|---|---|
| none - security fix | U-01 | n/a | rollback = `git revert <merge_sha>` in a new PR |
| `BUILD001_MCP_IMPLEMENTED_TOOLS_ONLY` (ct) | U-15 | true | tools/list returns the old 22 worker_agents rows |
| `BUILD001_EXTERNAL_LINK_ZERO_SERVER_L1` (ct) | U-43 | true | fail closed: `submit_task`/`ask` on the external link return the Level 0 candidate list only and never call the old internal Level 1 path |
| `BUILD001_LINK_PROJECT_SCOPE` (ct) | U-18 | true | fail closed: every `/api/mcp/[token]` call returns 503 |
| `BUILD001_API_KEY_PROJECT_CHECK` (ct) | U-19 | true | fail closed: `project_ai` keys are refused (401); `org_service` keys (PROJEXA proxy) unaffected |
| `BUILD001_ACTOR_ATTRIBUTION` (ct) | U-20 | true | audit rows written the old way (user_id null for API-key callers) |
| `PROJEXA_EXCHANGE_RATE_REFRESH_ENABLED` (Edge secret) + cron job `projexa-exchange-rate-refresh` | U-21 | true | function answers 200 `{"skipped":true}`; job set `active := false` |
| `BUILD001_GATE_ACTING_PERSON` (ct) | U-49 | true | fail closed: Level 1 served only when the resolved person's id equals `RAJAT_USER_ID` |
| `PROJEXA_READ_ENABLED` (Edge secret) | U-25 | true | gateway answers 503 to every call |
| `BUILD001_BOQ_READ_VIA_GATEWAY` (px) | U-25/U-33 | false until the Phase 4 E-09/E-10 rows pass | browser reads go through the existing px `/api/scope/*` path |
| `BUILD001_BOQ_KEYSET_PAGINATION` (ct) | U-27 | true | old unpaginated list (known 7.6 MB body on the largest project, LF (c)) |
| `BUILD001_BOQ_REVISION_FORWARD_LINES` (ct) | U-28 | true | `executeCreateBoqRevision` forwards only boqId/title (old) |
| `BUILD001_REGISTRY_BOQ_ENTRIES` (ct) | U-28 | true | `create_boq` and `get_boq_line_items` absent from EXECUTORS |
| `BUILD001_SURFACE1_APPROVALS` (ct, px) | U-29 | true | approval route returns 404 |
| `BUILD001_EMAIL_BRIDGE` (ct) | U-31 | false until DNS is live (PMD-06) | inbound email creates no proposal |
| `BUILD001_BOQ_BROWSER_FIRST` (px) | U-33 | false until the Phase 4 exit rows pass | BOQ screen renders from the server path |
| `PROJEXA_AI_LINK_ENABLED` (Edge secret) | U-46 | true | every link endpoint answers 503 |
| `BUILD001_PASTE_BACK` (ct, px) | U-47 | true | paste-back page returns 404 |
| `PROJEXA_EXTRACT_ENABLED` (Edge secret) + `BUILD001_EXTRACT_VIA_EDGE` (ct) | U-36 | true / true | extraction refused with a fixed error; no LLM call anywhere |
| `BUILD001_PROJECT_FROM_DOCUMENT` (ct) | U-37 | false until the 5.2 and 5.3 rows pass | route returns 404 |
| `BUILD001_REGISTRY_PHASE5` (ct) | U-38 | true | Phase 5 registry keys absent from EXECUTORS |
| `BUILD001_MCP_CONSTRUCTION_TOOLS` (ct) | U-39 | false until the U-01 and U-20 exit rows still pass | the 13 tools stay unlisted |
| `PROJEXA_SCHEDULER_BRIDGE_ENABLED` (Edge secret) + cron job `projexa-scheduler-bridge` | U-40 | true | function answers 200 `{"skipped":true}`; job inactive |
| none - config file | U-41 | n/a | `git revert`; `vercel.json` has no effect until an owner release |

### 2.8 Rollback per artifact

| Artifact | Rollback action | Proof of rollback |
|---|---|---|
| Code PR (squash-merged) | New branch, `git revert <merge_sha>`, PR, merge on green | the item's register rows return to their pre-change result; the mutation partner row passes again |
| Behaviour change | Flag off (s2.7) first, revert second | the flag's OFF test case passes on main |
| Migration | Supabase MCP `apply_migration` with name `NNNN_<tag>_down` and the down file body, only after the same M-7 rehearsal run in reverse order passes | schema hash equals the h0 recorded in the forward PR (`node scripts/verify/sql-assert.mjs --project ct --sql "<hash query>" --equals <h0>` exit 0) |
| Data backfill / revocation | Inverse UPDATE from the down file, using the before-image ids in the PR body | F1 count row equals the pre-change count |
| Edge Function | `supabase secrets set <FLAG>=false` first; then redeploy the previous source: worktree at the previous merge SHA, `supabase functions deploy <name> --project-ref pcrjmlpuqsbocqfwoxod --use-api` | `get_edge_function` file contents equal `git cat-file blob <prev_sha>:supabase/functions/<name>/<file>` after CRLF normalisation (method of F-R10-10) |
| pg_cron job | `cron.alter_job(... active := false)`, then `cron.unschedule('<job>')` | `node scripts/verify/sql-assert.mjs --project ct --sql "select count(*) from cron.job where jobname = '<job>' and active" --equals 0` exit 0 |
| Vault secret (`projexa_*`) | `select vault.update_secret(...)` or delete by id through MCP `execute_sql` | `select count(*) from vault.secrets where name = '<name>'` equals the expected value |
| Branch-protection change | `gh api -X PUT` with the context list recorded in the PR body before the change | `gh api .../protection --jq '.required_status_checks.contexts \| join(";")'` equals the recorded string |
| Docs / register | `git revert` | lint_plan.py exit 0 |

## 3. Testing plan

### 3.1 Test types per item type

| Item type | Test layers (bottom to top) | Where | Example |
|---|---|---|---|
| Route or service change (ct/px) | (1) unit route test that runs the real route handler and the real service code, faking ONLY the DB layer with real stage/commit/rollback semantics (CLAUDE.md R74 reference test `src/app/api/v1/construction/boq/route.test.ts`, PR #1606); (2) mutation partner; (3) CI whole suite | E1 per file; E4 whole suite | U-01 `financial-redaction.test.ts` |
| Schema change | (1) M-6/M-7 rehearsal; (2) M-8 PGlite replay; (3) F1 SQL assertion on live after apply; (4) CI migration checks | E1 + E2 (SELECT and aborted DO block only) | U-18, U-19, U-22 |
| Gate / security rule | (1) gate test matrix over every identity kind (owner, non-owner, org key, link token, none) with the rule both on and off; (2) mutation partner (rule removed -> test fails) | E1 per file; E4 | `src/lib/ai/adapter.gate-2-8.test.ts` (30 pass), `src/app/api/v1/projexa/tasks/route.gate.test.ts` (6 pass), PR #1837 |
| Browser behaviour (px) | Playwright spec (offline load, Worker long-task limit, approval page) | E4 only (P-03) | E-09, E-10 rows |
| AI work link | Conformance harness: a plain-AI script starting from one pasted link, 20 checks H01-H20, exit 0 only when every selected check passes, last line `RESULT: <p> passed, <f> failed`; self-test restarts the mock server with one rule broken at a time and must detect every break (last line `SELFTEST: clean <p>/<n> pass; <d>/<b> breaks detected`) | E1 against the mock (python stdlib); E1 against the Edge URL after deploy (Supabase URL, never Vercel) | BR-2xx U-45, BR-5xx U-46 |
| Edge Function | pure-module unit tests (`bun test --isolate ./supabase/functions/<name>`); after deploy a curl status check and a file comparison | E1 + E4 (after P-05 step) | `projexa-read` isolation curls ID-02 (IEF s3e): expected `200 404 401 401` |
| pg_cron job | F1 rows on `cron.job`, `cron.job_run_details` and `net._http_response` (kept about 6 h) after the first scheduled slot; `succeeded` alone proves only that the request was queued (IEF s2) | E1 SELECT | U-21 rows, date-gated |
| Plan / register / docs | `python ai-os/projexa-build-001/lint_plan.py ai-os/projexa-build-001` (F7); F4 git counts; F6 file tests | E1 (python) | BR-1xx lint row |
| Billing / cost | committed read-only script, one billing call per Pacific day (07:00Z boundaries, F-A08-3/4), date-gated title | E1 | U-06 row `[DATE 2026-09-27]` |
| Attribution counts (vacuity) | the count row plus a non-vacuity partner that needs a fixture write in the window (LF (a)); a zero produced by no traffic is not a pass | E1 SELECT | D-09 amended rows |

### 3.2 What runs locally versus only in CI

The exact local test line (K-09, same placeholders as ci.yml:132-139), written here once and called LOCAL-TEST below:

> [removed from the public copy: see the private KT folder]

| Check | Local (E1) | CI (E4) |
|---|---|---|
| One test file | LOCAL-TEST, one at a time, after S-1 and S-4 pass | inside Unit Tests |
| One `scripts/` test file | LOCAL-TEST with `./scripts/<file>.test.ts` | Unit Tests step `bun test --isolate ./scripts` |
| One Edge Function test file | LOCAL-TEST with `./supabase/functions/<name>/<file>.test.ts` | Unit Tests (after the P-05 step is added) |
| Whole unit suite | never (a bare or whole run is not used on this laptop) | Unit Tests (`bun test --isolate`) |
| Typecheck | never (K-10) | Type Check |
| `next build` | never | Build |
| Lint | never whole-repo; peak memory of a single-file eslint run is UNVERIFIED, so it is not planned | Lint |
| Playwright | never | E2E Tests; E2E Tests (Env-1, cross-repo) |
| Migration checks (collision, integrity DB-free leg) | yes (node) | required contexts |
| Whole-folder PGlite replay | no | Migration Replay From Empty (report-only) |
| Per-migration PGlite replay | yes, S-2 must pass first (memory use UNVERIFIED) | not wired |
| SQL assertions (F1) | yes, PM only, SELECT only, dated result | not usable (P-09) |
| Conformance harness vs mock | yes (python) | via the bun wrapper test of the U-45 row |
| Plan linter | yes | not wired (optional later) |
| gh / curl reads (F5, F9) | yes | n/a |

### 3.3 Falsifiability (R74-RULING-03) as boolean steps

A requirement or register row reaches `pass` only when every step returns YES. No partial credit.

| Step | Question | Boolean form |
|---|---|---|
| F-1 | Is the test a committed file? | `git ls-files --error-unmatch <test path>` exit 0 on the merge SHA |
| F-2 | Does it go through the real surface? | route items: the test imports the route handler module (for a sibling `route.test.ts`: `git grep -c -F "./route" -- <test path>` prints at least 1); UI items: a Playwright spec; API-only items: the API call |
| F-3 | Was it seen to FAIL with the behaviour broken? | PM applies the named mutation locally, runs LOCAL-TEST, records the non-zero exit code in the PR body, reverts, then `git diff --quiet` exit 0 before commit |
| F-4 | Does it pass on a recorded commit SHA? | Unit Tests (or the owning CI job) `success` on the PR head SHA and on the merge SHA |
| F-5 | Does it prove the outcome PERSISTED? | the test re-reads the stored record (fake DB re-read, or an F1 re-select), not a success message; reviewer names the re-read line in the `AUDIT:` comment |
| F-6 | Is it recorded against the requirement id? | register `evidence_ref` = merge SHA or `PR#n`; for rows tied to `platform.sumeet_requirements`, the existing columns `closure_test_path`, `closure_commit_sha`, `closure_ci_run_id`, `closure_test_run_at` are filled (INV s1) |

### 3.4 Evidence recording and status transitions

- **Who:** only the PM changes a register status, after running the row's `verify_command` itself. An agent's report is never evidence on its own (WO s9).
- **pending -> pass:** exit 0 and stdout equal to `expected_output`, run on (a) origin/main after the merge for repo-state rows, (b) the live database for F1 rows. `evidence_ref` = the 8+ character merge SHA, or `PR#<n>`, or `SQL <YYYY-MM-DD>: <value>`.
- **pending -> fail / pass -> fail:** exit non-zero or stdout different. `evidence_ref` = `<sha8> exit=<code>` or `SQL <YYYY-MM-DD>: <actual value>`.
- **-> blocked_owner:** only when the row needs a recharge, a spend increase, DNS, an owner decision, or a deployed instance; `owner_blocked` = yes in the same edit (REGISTER_CONVENTIONS).
- **Never:** editing `verify_command` or `expected_output` to turn a fail into a pass. A test may change only through a new AMENDMENT_LOG row with evidence (WO s5 RISK).
- **Where recorded:** `ai-os/projexa-build-001/BOOLEAN_REGISTER.csv` in a docs-only PR, at most one per merged work PR, lint_plan.py exit 0 before it opens. The Drive copy follows (PMD-21).

### 3.5 Reporting a fail

A failing check is reported with the exact lines below, in the PM's report to the owner, the same day:

```
FAIL <BR-id> <title>
command: <verify_command, verbatim>
expected: <expected_output, verbatim>
actual: exit <code>; stdout "<last line, verbatim>"
ran on: <sha8 or SQL date>
next step: <one sentence, or "owner decision needed: <question>">
```

A phase with any EXIT row not `pass` is reported as not complete, with every such row listed (WO s12: "A phase reported complete with any exit test not YES is a false report").

## 4. Deployment plan

### 4.1 What "deploy" means for each artifact

| Artifact | Deploy = | Who | Allowed now |
|---|---|---|---|
| Source code (ct, px) | Squash merge to `main` after green (s2.4). Production (Vercel) does NOT pick it up (K-15). | PM | yes |
| Plan package and docs | Merge of `ai-os/projexa-build-001/**`; then the same files copied to the Drive KT folder `PROJEXA_BUILD-001_PLAN_2026-09-25` (PMD-21) | PM | yes |
| Database migration | Supabase MCP `apply_migration` on `pcrjmlpuqsbocqfwoxod` after merge and after M-7/M-8 (s2.6 M-10) | PM | yes |
| Edge Function (`projexa-*` only) | `supabase functions deploy <name> --project-ref pcrjmlpuqsbocqfwoxod --use-api` from a clean worktree at the merge SHA (s4.3) | PM | yes |
| pg_cron job (`projexa-*` only) | the job's migration applied (s4.4), one job per PR (PMD-12) | PM | yes |
| Vault / Edge secrets | `vault.create_secret` via MCP `execute_sql`; `supabase secrets set` | PM | yes, names prefixed `projexa_` / `PROJEXA_`, values never printed or committed |
| GitHub settings (required checks) | `gh api -X PUT repos/FChecklist/compliance-tracker/branches/main/protection/required_status_checks` with the full new list; old list recorded first | PM | yes (U-07, U-24) |
| Vercel (both projects) | owner-approved release only (s4.6) | owner | **no - blocked_owner** |

### 4.2 Migration apply

Exactly s2.6 M-10. In short: merged -> hash equals h0 -> rehearsal still PASS -> `apply_migration` -> h1 recorded -> F1 rows pass -> integrity check 0 orphans -> register updated.

### 4.3 Edge Function deploy

| Step | Command / rule | Pass condition |
|---|---|---|
| ED-1 Source first | The function's folder is merged to `main` with its unit tests (M-A12-5). | `MSYS_NO_PATHCONV=1 git cat-file -e origin/main:supabase/functions/<name>/index.ts` exit 0 |
| ED-2 Ownership | [removed from the public copy: see the private KT folder] | reviewer check |
| ED-3 Clean tree | `git -C C:/ct/ct worktree add C:/ct/ct-worktrees/b001-deploy-<name> <merge_sha>` | exit 0 |
| ED-4 Deploy | from that folder: `supabase functions deploy <name> --project-ref pcrjmlpuqsbocqfwoxod --use-api` plus `--no-verify-jwt` only for functions that check their own token (`projexa-read` verifies the PROJEXA JWT itself, IEF s3d option (e); cron-called functions check a bearer secret like dpdp-monday-email) | exit 0 |
| ED-5 Match | `get_edge_function <name>` files equal `git cat-file blob <merge_sha>:supabase/functions/<name>/<file>` after CRLF normalisation (F-R10-10 method) | all files equal |
| ED-6 Smoke | `test "$(curl -s -o /dev/null -w '%{http_code}' https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/<name>)" = "401"` (no token) | exit 0 |
| ED-7 Record | PR comment `DEPLOYED <name> version <n> from <merge_sha>`; register row updated | comment present |
| ED-8 Remove worktree | `git -C C:/ct/ct worktree remove C:/ct/ct-worktrees/b001-deploy-<name>` | exit 0 |

Cost note: Edge invocations count against the Supabase plan; the plan tier and its limits are UNVERIFIED (BRD s4). Any Supabase add-on or compute change is a spend increase and is owner-only.

### 4.4 pg_cron job enable (one per PR, PMD-12)

1. Edge Function deployed and smoke-tested (s4.3).
2. Vault secrets `projexa_<job>_url` and `projexa_<job>_secret` created by the PM (values never printed).
3. Migration with `cron.schedule('projexa-<job>', '<schedule>', $$ select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name = 'projexa_<job>_url'), headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'projexa_<job>_secret'))) $$)`, pattern copied from `dpdp-legal-clocks` (the proven reference, 3 of 3 runs HTTP 200; IEF s2), with its down file calling `cron.unschedule`.
4. The PR body states that enabling a prepared job re-enables writes silent since about 2026-08-23 (PMD-12, F-A07-2).
5. After the first scheduled slot: F1 rows on `cron.job_run_details` (status `succeeded`) and `net._http_response` (status_code 200, read within about 6 h).

### 4.5 Post-deploy checks (non-Vercel)

| Artifact | Check | Pass |
|---|---|---|
| Migration | item's F1 rows; hash h1 recorded; integrity 0 orphans | all exit 0 |
| Edge Function | ED-5, ED-6 | equal files; 401 without token |
| pg_cron job | s4.4 step 5 | 1 succeeded run; HTTP 200 |
| Code merge | s2.4 "after merge" command | 0 failed check-runs other than Env-1 |
| Docs | lint_plan.py | exit 0 |

### 4.6 Vercel go-live checklist - every step `blocked_owner`

None of these steps is taken by the PM or an agent. They are listed so the owner sees the whole path.

| Step | What | Boolean check (read-only, runnable today) |
|---|---|---|
| V-01 | Owner writes "go live" in chat; the words are quoted in the release PR body. | n/a (owner action) |
| V-02 | Owner restores Vercel credit / unpauses (recharge and spend are owner-only). | n/a (owner action) |
| V-03 | Batch-release policy (PMD-11, M-A12-3): `ignoreCommand` stays `sh -c 'exit 0'` on `main` in both repos, so no merge ever builds; each release is one owner-approved manual deploy of a named `main` SHA. | `gh api "repos/FChecklist/compliance-tracker/contents/vercel.json?ref=main" -H 'Accept: application/vnd.github.raw' \| grep -q "sh -c 'exit 0'"` exit 0 until the owner releases |
| V-04 | PR #1808 stays draft and unmerged (PMD-11). | `test "$(gh pr view 1808 --repo FChecklist/compliance-tracker --json state,isDraft --jq '.state + "," + (.isDraft\|tostring)')" = "OPEN,true"` |
| V-05 | Release SHA gate: on the release SHA all 10 required contexts plus E2E Tests are `success`. This replaces the local `node scripts/pre-deploy-gate.mjs`, which needs a local build (not possible here, K-10) and runs a non-isolated `bun test` (CLAUDE.md R76 note). | `test "$(gh api repos/FChecklist/compliance-tracker/commits/<sha>/check-runs --paginate --jq '[.check_runs[] \| select(.conclusion=="success") \| .name] \| map(select(. == "Lint" or . == "Type Check" or . == "Build" or . == "Unit Tests" or . == "Migration Number Collision Check" or . == "Migration Integrity Check (AR-12)" or . == "Governance YAML Parse Check" or . == "Migration Schema Drift Check" or . == "Screen Definition Label Check" or . == "Graph Drift Check" or . == "E2E Tests")) \| unique \| length')" = "11"` |
| V-06 | One owner-approved test deploy to measure build minutes of a prebuilt deploy (M-A12-4): `vercel build` inside a GitHub Actions job (free runner, K-07), then `vercel deploy --prebuilt`; the workflow file is drafted on a branch and merged only on the owner's yes. Then the Build CPU line for that Pacific day is read with the committed read-only billing script (one call per day). Whether a prebuilt deploy uses zero Vercel build minutes and whether `ignoreCommand` applies to CLI prebuilt deploys are both UNVERIFIED until this one measurement. | UNVERIFIABLE until V-01..V-02 (M-A12-4) |
| V-07 | Order: compliance-tracker first, then projexa (PR #1808 body plan). The 18 MOVE crons stay on Vercel until their replacements pass (DTDF s3); U-41's `vercel.json` edit ships with this release. | n/a |
| V-08 | Post-deploy checks within 15 minutes (R72_DEPLOY_RITUAL.md step 4): 3 route curls, runtime errors, migration state, one claude_log row; plus the deployed-instance rows (WO 3.4 `verify-all-deployed.sh`, E-11, E-12, E-15) and the Node runtime version check (P-13). | the BR rows named, all `blocked_owner` today |
| V-09 | Rollback: `vercel rollback <previous-deployment-id>`, owner-approved. | n/a (owner action) |
| V-10 | Cost watch after go-live: projected gross Vercel monthly charge at most 20.00 USD (PMD-13), read daily with the committed billing script. | BR-5xx cost row |

Allowed before go-live (not Vercel actions, status `pending`): correcting `R72_DEPLOY_RITUAL.md` and `VERCEL_DEPLOY_OWNER_GUIDE.md` (F-A12-2), and making `scripts/pre-deploy-gate.mjs` run `bun test --isolate` with a regenerated baseline (CLAUDE.md R76 note). Each is its own small PR.

### 4.7 Rollback after deploy

Per artifact, s2.8. Vercel rollback is V-09 and owner-only.

## 5. Resource policy

### 5.1 RAM (PMD-14)

| Level | Free RAM | What is allowed |
|---|---|---|
| Normal | at least 1.5 GB | one bun process at a time; agent bursts up to the limits in s5.3 |
| Warn | 1.0 GB to 1.5 GB | report the number; git, docs, gh reads, SELECT SQL only; no bun, no new agent burst |
| Hard stop | below 1.0 GB | start nothing new; run S-3 (orphan `tsc` cleanup); report; wait |

- Commands: S-1 and S-2 in s2.1. Check before every bun command, before every agent burst, and at the end of every phase (PMD-14). Free RAM at the start and end of each PR goes into the PR body.
- Today's readings while this plan was written were 0.36 GB and 0.48 GB (K-11): the laptop was at hard stop.
- Stop a Next server only with `powershell -NoProfile -File C:/ct/ct/scripts/windows-dev-process-guard.ps1 -StopPort <port>` (tree kill; CLAUDE.md gotcha 5). BUILD-001 plans no local dev server; if the PM starts one it counts as the one bun process and needs the Normal level (its peak memory on this repo is UNVERIFIED).

### 5.2 Process rules

- One bun process at a time on the laptop (S-4 before each).
- Typecheck, build, whole suite and Playwright run only in CI (s3.2).
- At most 2 local interactive sessions (WO s9).
- At most 12 concurrent agents (PMD-14).

### 5.3 Agents

- **Reading, verifying, auditing** go to agents. **git, merges, migration applies, Edge deploys, secret setting, register status changes and short scripts** stay with the PM on the laptop.
- Code-writing agents edit files only inside the worktree the PM assigned and return the diff; the PM runs the tests, commits, pushes and opens the PR.
- Agents requested as remote may fall back to local worktrees on this laptop (owner memory note "Remote agents run locally here"); every agent that runs bun counts toward the one-bun rule, and a fan-out starts only at the Normal RAM level.
- **Every claim an agent returns is re-verified by the PM** against the live source (git on the SHA, SELECT, gh api) before it enters the register or a report (WO s9).
- AGENTS.md Rule 8 (quality mandate through about 2026-10-08): the model is chosen for the work, not for the lowest price.

### 5.4 Model routing

| Work type | Model | Effort | Rule |
|---|---|---|---|
| Inventory and search (git grep counts, file lists, SELECT counts) | haiku | low | output is always re-run by the PM before use |
| Inventory needing judgement (which route calls which, call graphs across both repos) | sonnet | medium | |
| Code writing (routes, services, migrations, Edge Functions) | sonnet | high | |
| Code writing on security paths (U-01, U-18, U-19, U-20, U-25, U-43, U-46, U-49) | opus | high | |
| Test writing incl. the mutation partner | sonnet | high | the test author is not the reviewer |
| Security design (identity gateway, token lifecycle, redaction, RLS, fail-closed switches) | opus | max | |
| Adversarial review / audit (`AUDIT: PASS` or `AUDIT: FAIL`) | opus | high | never the author agent (AGENTS.md Rule 7(c)) |
| Mechanical CSV / YAML / register rows | haiku | low | lint_plan.py is the judge |

## 6. Definition of done

### 6.1 A work item (U-id) is done when every line is YES

1. Every register row whose `source` names the U-id is `pass` (or `blocked_owner` for its deployed-instance part only, see 6.3).
2. The code PR(s) merged by squash with all 10 required contexts `success`; merge SHA recorded.
3. F-1 to F-6 (s3.3) all YES, with the mutation name and its failing exit code in the PR body.
4. If a schema change: forward and down files exist, rehearsal `PASS_ROLLED_BACK` with h0/h1/h2 recorded, PGlite `SCHEMA_HASH_MATCH`, applied via MCP, F1 rows pass, integrity check 0 orphans.
5. If an Edge Function: deployed from the merge SHA, ED-5 files equal, ED-6 smoke passes.
6. If a behaviour change: its flag is in the s2.7 table with its default, and both sides are tested.
7. A non-author `AUDIT: PASS` comment exists on the PR.
8. The BUILD-001 claim scope covers the files touched.
9. `python ai-os/projexa-build-001/lint_plan.py ai-os/projexa-build-001` exit 0 after the register edit.

### 6.2 A phase is complete when every line is YES

1. Every `[ENTRY]` row of the phase passed before the phase's first code PR merged.
2. Every `[EXIT]` row of the phase is `pass`.
3. RAM check run and reported at phase end.
4. The phase report uses the WO s12 block, listing every row not `pass`.

### 6.3 Gate-open without completion

- A phase with one or more `[EXIT]` rows at `blocked_owner` is reported as **blocked on owner, not complete**, with each row listed.
- The next phase may start only when every `[EXIT]` row is `pass` or `blocked_owner`, AND no `blocked_owner` row belongs to a U-item that is a prerequisite (MM s4 graph) of a next-phase U-item. The next phase's `[ENTRY]` rows restate the previous `[EXIT]` rows that are not `blocked_owner` (register BR-5xx ENTRY wording already follows this).

## 7. The five phases at a glance

| Phase | Name | ENTRY rows | EXIT rows | Unified items | Owner-blocked parts |
|---|---|---|---|---|---|
| 1 | Make the ground observable | BR-1xx `[ENTRY]`: amendment log exists and is non-empty | BR-1xx `[EXIT]`: lint, sitemap provenance, contradictions, 111 ids, Speed Insights 0.0000 `[DATE 2026-09-27]`, Secret Scanning required, cron placement, shared boundary, surface matrix, SECURITY DEFINER guard, MCP tools list, 4 redaction points, zero-server-L1 | U-00..U-12, U-14, U-15, U-43 (U-13 DPDP track, non-gating) | U-14 openrouter switch only (PMD-02) |
| 2 | Identity, scope, attribution | BR-2xx `[ENTRY]` = Phase 1 `[EXIT]` rows restated | BR-2xx `[EXIT]`: rollback rehearsals, cross-project 403, amended D-09, gate on acting person, one `projexa-` pg_cron job, link spec audited | U-16..U-21, U-44, U-45, U-49 | U-16 only as owner override of PMD-07/08 |
| 3 | Evidence standard | BR-3xx `[ENTRY]` = Phase 2 `[EXIT]` restated | BR-3xx `[EXIT]`: 3.1, 3.2, 3.6 on the new columns, verify:all at least 111 checks, required-check list incl. Secret Scanning and the Env-1 job, gateway spike decision, browser-bundle scan job | U-22..U-26 | U-23 deployed half (WO 3.4) |
| 4 | One record type, four surfaces (BOQ line item) | BR-4xx `[ENTRY]` = Phase 3 `[EXIT]` restated (runner `scripts/verify/phase-gate.sh 3`) | BR-4xx `[EXIT]`: D-11 keyset paging, surface 1 route 200, 4 cells one record id, 4 attributed audit rows, E-09, E-10, E-11, E-12 | U-27..U-33, U-46, U-47 | U-30/U-31 email surface (DNS, PMD-06); E-11 and E-12 (need Vercel live) |
| 5 | Replicate, then perception | BR-5xx `[ENTRY]` = Phase 4 `[EXIT]` rows not `blocked_owner` | BR-5xx `[EXIT]`: cost budget at most 20.00 USD, injection rejected, idempotent extraction, E-13, MCP list equals handleTool, E-14 lockdown test, 28 cells (parts A, B, C), owner acceptance run | U-34..U-42, U-48 | U-34 override only (PMD-03); s4 cells (DNS); U-41 vercel.json merge; U-48 owner run; E-15 |

## 8. UNVERIFIED items in this plan

| # | Claim | How it gets verified |
|---|---|---|
| UV-1 | GitHub Actions usage is free for these public repos (policy stated, live usage unread) | owner reads GitHub billing (API needs the `user` scope) |
| UV-2 | An MCP `apply_migration` writes (or does not write) a `drizzle.__drizzle_migrations` row | first BUILD-001 migration: SELECT the ledger before and after (M-10) |
| UV-3 | A changed Supabase Edge secret takes effect without a redeploy | first flag flip: curl smoke before and after (s2.7) |
| UV-4 | A prebuilt Vercel deploy uses zero Vercel build minutes; `ignoreCommand` applies to CLI prebuilt deploys | V-06, owner-approved |
| UV-5 | Peak memory of `next dev`, single-file eslint, `bun run db:generate` and per-migration PGlite replay on this repo | first run of each at the Normal RAM level, reading free RAM before and after |
| UV-6 | Supabase plan tier and Edge invocation limits for verdian-ai | `get_organization` / `get_project` read |
| UV-7 | Cause of the Domain Ownership Drift Check failures | read-only log read of the latest failed run (P-11) |
| UV-8 | Vercel runtime Node version vs local v26.3.1 | V-08 at go-live |
| UV-9 | `gh pr checks <n> --required` exits 0 only when every required check passed (gh CLI behaviour, not exercised while writing this plan) | first BUILD-001 PR: compare its exit code with the K-03 list read by `gh api` |

## 9. Findings and amendments this plan acts on

| Id | What this plan does with it | Section |
|---|---|---|
| F-A12-1 | P-11 diagnosis and replacement path | 1.3 |
| F-A12-2 | docs PRs before go-live | 4.6 |
| F-A12-3 | P-15 rule (`MSYS_NO_PATHCONV=1`, `git cat-file blob`, byte check) | 1.3 |
| F-A12-4 | V-03 batch-release policy per PMD-11 | 4.6 |
| F-A12-5 | ED-1/ED-2 (source first for `projexa-*`; foreign functions recorded for their owners) | 4.3 |
| F-A12-6 | W-3/W-4 junction rule | 2.3 |
| M-A12-1 | W-4 check | 2.3 |
| M-A12-2 | green = 10 contexts | 2.4 |
| M-A12-3 | V-03 | 4.6 |
| M-A12-4 | V-06, UV-4 | 4.6, 8 |
| M-A12-5 | ED-1..ED-4 (limited to `projexa-*` by PMD-18) | 4.3 |
| M-A12-6 | s2.2 claim rule | 2.2 |
| M-A05-2, M-A11-5, F-A05-4 | M-6..M-8, P-06 | 2.6, 1.3 |
| M-A05-6 | M-6 grants section | 2.6 |
| M-A07-3 | U-23 bun `verify:all` | 2.5 |
| M-A07-4, M-A07-5 | U-07, U-24 required-check changes | 2.5, 4.1 |
| F-A07-2 | M-11 (prepared cost001 SQL not applied), s4.4 step 4 | 2.6, 4.4 |
| F-A07-6 | U-41 lockdown test guards crons | 2.5 |
| F-A10-1 | U-26 built-bundle scan in CI | 2.5 |
| F-A10-4 | U-36 keeps the Node-only path server-side | 2.5 |
| F-R10-10 | ED-5 comparison method | 4.3 |
| F-A08-3, F-A08-4 | one billing call per Pacific day, 07:00Z boundaries | 3.1 |
