# SUPERBOSS IMPLEMENTATION PLAN -- 2026-07-19

> **Owner**: Super Boss (Claude, GLM-5.2 seat), VERIDIAN-DEV
> **Task ID**: SUPERBOSS-EVALUATE-AND-PLAN
> **Scope**: cross-repo (compliance-tracker primary, projexa secondary, claude-control catalog)
> **Type**: EVALUATION + PLANNING ONLY. This file is the plan. It dispatches nothing.
> **Grounded in state read live on 2026-07-19 ~14:35 UTC** from: `ai-os/boss/ACTIVE-CLAIMS.yaml` (full read), `ai-os/MASTER-TRACKER.yaml` (full 1913-line read), `/opt/veridian/repos/claude-control/CONTROLLER.yaml` (full 3574-line survey), `gh pr list` for both repos, `systemctl --user` worker units, `ls /opt/veridian/ai-os/tasks/`, and a sample of real task `prompt.txt` files for the task-shape template.
>
> **How to read this file** (two audiences):
> - **Owner's assistant, checking in every 15 min**: read the **STATUS SNAPSHOT** at the top, then scan the **PRIORITY-ORDERED DISPATCH PLAN** checklist (`- [ ]` = not yet dispatched, the next item a supervisor process should pick up).
> - **A future dispatch script picking up the next task**: take the first `- [ ]` task in the **PRIORITY-ORDERED DISPATCH PLAN** whose `READY:` line says `yes`, paste its full block (TASK ID through DONE CRITERIA) as the dispatch prompt, and dispatch per its `SOFTWARE TEAM LEVEL` line. Do NOT take any task whose `READY:` says `blocked`.
>
> **Tier routing note (Owner's explicit instruction)**: every task below is dispatched through the Mother Router's `software_team` scope and resolves to **GLM-5.2 via the local OpenRouter proxy regardless of the L1–L4 level named**. The L1–L4 label is for *scope/granularity* classification only (per `ai-os/SOFTWARE_TEAM.md`'s level definitions, which as of 2026-07-19 is being authored by the in-flight AIROUTER-01 Phase 2 PR #483 — see collision note). The model is always GLM-5.2 via OpenRouter's cheapest provider, every tier, no exceptions.

---

## STATUS SNAPSHOT (2026-07-19 ~14:35 UTC)

**Open PRs on compliance-tracker (11):**
- `#484` SMOKE TEST: GLM-5.2 proxy routing — **CONFLICTING mergeable, contaminated** (worker swept in 6080-line generated `drizzle/0001_wakeful_reptil.sql` + 37k-line snapshot; collides with existing `0001_mcp_access_codes.sql`; un-runnable). Real content = one README.md one-liner. Needs the generated artifacts stripped before any merge.
- `#483` AIROUTER-01 Phase 2 (Software Team L0-L5) — **CONFLICTING, tier2, awaiting Owner sign-off**, reviewed+approved by independent GLM-5.2 supervisor. NOT free to dispatch around — this is in-flight tier2.
- `#481`, `#477` claim-registration PRs (PROJEXA E2E Phase 2 Batch C / Phase 1) — docs-only, blocked by `audit-check`/E2E; low priority, coordination artifacts.
- `#323` Governance closure: prompt-cache Phase 1 + FM photo digitization — green, no failing checks. Tier2 (touches drizzle) — awaiting Owner sign-off.
- `#305` sales-engine-audit claim registration — blocked by `audit-check` (stale claim PR).
- `#410`/`#409`/`#408`/`#407` dependabot bumps (eslint/pptxgenjs/sharp/checkout) — routine.
- `#151` typescript 7.0.2 bump — routine, old.

**Open PRs on projexa (1):**
- `#47` PROJEXA E2E Phase 2 Batch C (finance+sales+HR+chat commands) — in-flight, active claim.

**Systemd worker units:** ~45 `veridian-worker@*` units listed, **all `inactive dead`** at check time (no workers actively running right now — the 3-worker concurrency cap is empty; the gap-queue dispatcher would refill it). The AIROUTER Phase 2 task (`task-20260719-122711`) and smoke-test (`task-20260719-140432`) both completed their run and self-stopped.

**GLM-5.2 OpenRouter proxy state:** **DISABLED.** Confirmed by `/opt/veridian/shared/.env.backup-2026-07-18-glm-proxy-disable` — the proxy was taken down 2026-07-18. AIROUTER Phase 2's own pre-dispatch finding (CONTROLLER `AIROUTER-01` `.dispatched_2026_07_19`) independently confirmed: "no active GLM-5.2 OpenRouter proxy systemd service/script currently exists on the server (searched, found none)" — Phase 2 called GLM-5.2 **directly** via the OpenRouter API (`OPENROUTER_API_KEY`) for its audit rounds, not via a proxy. PR #484 was a smoke test to verify proxy routing that now has no proxy to route to. **Decision needed (flagged to Owner):** is the intended dispatch path "GLM-5.2 via OpenRouter API directly" (current reality) or "via a local proxy layer that needs to be (re)built"? Until answered, all dispatch prompts should target the OpenRouter API directly using `OPENROUTER_API_KEY` from `/opt/veridian/shared/.env`, exactly as PR #483's task already does.

**In-flight / protected scope (DO NOT dispatch into — see COLLISION CHECK):** AIROUTER-01 Phase 2, PROJEXA E2E Phase 2 (all 3 batches), the 9-workstream "VERIDIAN Review Framework implementation wave" (laptop-worktree BLOCKED), all `awaiting-owner-decision` CONTROLLER entries, all `tier2 awaiting-signoff` PRs.

---

## INVENTORY OF GENUINELY PENDING, ACTIONABLE ITEMS

Each row: **source id | real verified status | ready-to-dispatch-now?**. Verified against the live state above, not assumed from doc text. Items that are *not* ready are explicitly marked with their blocker.

### A. CONTROLLER.yaml entries with actionable (non-done, non-owner-blocked) status

| ID | Status (live) | Ready to dispatch now? |
|---|---|---|
| `AIROUTER-01` | Phase 1 merged (#433); Phase 2 PR #483 approved+tier2, awaiting Owner sign-off; Tables 2–4 (End User / Sales / Customer Success) NOT started | **NO** — Phase 2 in-flight (PR #483 held). Tables 2–4 are **blocked on Phase 2 merging first** (CONTROLLER explicitly sequences them after Table 1/Software Dev). Do not dispatch Tables 2–4 until #483 merges. |
| `ZERO-GAPS-CLOSURE-2026-07-19` | mostly-done; 4 sub-items done, one in-flight (#417 ajv/promptfoo real fix) | **PARTIAL** — only the `#417 ajv/promptfoo` fix is still open; it's already dispatched/running. No new dispatch. |
| `FINDING-PLAYWRIGHT-E2E-BROKEN-REPO-WIDE` | open; real, confirmed, repo-wide E2E CI breakage (bunx fetches unpinned `playwright@latest` which can't resolve `playwright.config.ts` self-import; not merge-blocking). | **YES** — small, real, mechanical fix (add `playwright` as a real devDependency, or pin bunx to a working version in `.github/workflows/ci.yml`). No file-scope collision with any active claim. |
| `PROJEXA-E2E-TESTING-PROGRAM-2026-07-19` | in-progress; Phase 1 done, Phase 2 (3 batches) running, Phases 3/4/5 not started | **NO (sequenced)** — Phases 3/4/5 are explicitly sequenced AFTER Phase 2's findings land. Active claims cover Phase 2. Do not dispatch 3/4/5 yet. |
| `PROJEXA-E2E-PHASE1-COMPLETE-PHASE2-STARTED` | in-progress (Phase 2 batches running) | **NO** — covered by active claims. |
| `UIKIT-01` | in-progress; kit built, compliance-tracker adopted tokens (#436 merged); **full package-level component swap for compliance-tracker NOT done** (flagged as separate larger follow-on); projexa PR #38 awaiting Owner review | **PARTIAL** — compliance-tracker full-swap is actively being worked (ACTIVE-CLAIMS entry "Bumping @fchecklist/veridian-ui-kit to v0.2.0…") — **collision, do not dispatch**. projexa PR #38 awaiting Owner review — not a dispatch item. |
| `PLATFORM-01` | wave_2_complete; all 6 workstreams done | **NO** — done. (`cross_references` notes one open question: veridian-client.ts fail-open shared-key fallback — small maintenance item, low priority.) |
| `PRIORITY-18` | in-progress; 18a merged, 18b (stage-0 self-serve signup) merged+live. Stage-0 design fully closed. | **NO** — the two main sub-items are done. One disclosed minor non-blocking finding (stage0Sources insert lacks try/catch on partial-unique-index — low likelihood, no data-integrity impact). Could be a tiny follow-up; not a priority. |
| `PRIORITY-16` | part_2_safe_fixes_complete | Appears largely done; no clear open software-dev item surfaced. |
| `PALETTE-01` | in-progress; PR #324 open, NOT merged; audit pass-with-notes (manual browser click-through not completed due to pre-existing CDP flakiness, flagged in PR). | **YES (verify-first)** — the code is built and PR-open; what's genuinely pending is **manual visual verification + merge**. Not a fresh dispatch — a review/merge action. Low priority (single feature, not blocking). |
| `REVIEW-FRAMEWORK-GAPS-QUEUE-01` | in-progress; autonomous queue system (gap_queue.yaml + queue-dispatcher.py cron every 10 min) built and live-tested. 111 rows decision-blocked (skipped), 1713 rows → 296 work units in the queue. | **NO (system-driven)** — this is already an autonomous cron dispatcher; it self-fills the 3-worker cap. New manual dispatch would duplicate its work. The right action here is **monitoring**, not dispatch. |
| `COST-ESTIMATE-50USER-01` | in-progress; dispatched as its own one-off worker | **NO** — already running. |
| `PRIORITY-19` | part_1_substantially_complete + Part 2 waves 1&2 done | Largely done; deep E2E test+fix pass for a 50-user Dubai company. No clear new dispatch item surfaced from the entry. |
| `AI-ROUTER-MODEL-AGNOSTIC-EVAL-2026-07-19` | in-progress | Closed by PR #475 (merged) per `ZERO-GAPS-CLOSURE` — appears effectively done. |
| Dependabot bumps (`#151`,`#407`,`#408`,`#409`,`#410`) | open | **YES (low)** — routine dependency bumps, no collision, but low business value; merge as housekeeping. |

### B. ai-os/MASTER-TRACKER.yaml `open_items` (genuinely open, not owner_blocked / not ratified)

| ID | Status | Ready to dispatch now? |
|---|---|---|
| `OPEN-09` (org/user data export — privacy policy promises it, no bulk export mechanism) | open, logged-not-priority per Owner 2026-07-14 | **YES (Owner-gated priority)** — real compliance-facing gap (written policy promise with no backing mechanism). Owner explicitly said "log as pending, NOT an immediate priority. Do not schedule build work until explicitly requested." → **do NOT dispatch until Owner asks.** Listed for completeness. |
| `GAP-DCMD` (Dynamic Chain Master Directory rich schema) | deferred_large; 8 sub-fields shipped (PR #326), governance sub-field still at Priority-9 depth; 0 new graph edges this pass | **NO** — deferred_large, needs graph-schema design pass first. Not a quick dispatch. |
| `GAP-CONNECTOR-LAYERS` (Office Add-in / Browser Extension / Desktop Companion) | Layer 2 Office Add-in built; Layer 3 & 4 unbuilt, DEC-09 "needs Owner prioritization" | **NO** — owner-prioritization-gated for Layers 3/4. |
| `GAP-AUTH-REBUILD` (4-digit passcode) | deferred_large; passcode half built additively (PR #363). Google sign-in half functionally unusable until Owner configures Google OAuth in Supabase. | **NO** — deferred_large / owner-blocked (Google OAuth client config is an Owner/dashboard action). |
| `GAP-MOM-VOICE-TICKETS` (voice/transcription) | owner_blocked — needs a speech-to-text provider decision + paid API key | **NO** — owner_blocked. |
| `GAP-LITERT-EDGE-INFERENCE` | deferred_large; Phase 0b embeddings spike hit real model-compatibility walls; Phase 1 explicitly recommended NOT to proceed until a fixed-shape+int32 tflite embeddings model or newer @litertjs/core lands | **NO** — blocked on external model/API maturity. |
| `GAP-NARROW-MONITOR-ESCALATION` Phase 1 | partially closed (11 of ~30 event types) as of task-20260719-004413 (merged). Remaining ~19 genuinely blocked (no real call site / no TenantDb at cron sites / zero discriminating power). Phase 2 open. | **PARTIAL** — Phase 1 remainder is blocked on real-infra changes (extend `logActivity()`/cron routes to support a system actor with a real transaction context) — a real but larger piece. Phase 2 (general Tier 2/3 executors) has a working precedent in `dispatch-completion-monitor.ts`. Could be dispatched but is deferred_medium and not urgent. |
| `GAP-AGENT-CAPABILITY-BRIDGE` (roster.ts ↔ workerAgents bridge) | deferred_medium; low urgency (closes a discoverability gap, not a data-integrity one) | **YES (low priority)** — real, scoped, no file-collision with active claims. Low business value. |
| `GAP-UMR-TABLE-COVERAGE` | ongoing XS-per-table; 129 registered / 280 exempted; long tail | **YES (low priority)** — onboarding more tables is a ~10-line migration each, mechanical. No collision. Low urgency (the mechanism is complete; this is optional extension). |

### C. Open PRs that are genuinely "done but held" (review/merge actions, NOT new dispatch)

| PR | Status | Action |
|---|---|---|
| `#483` AIROUTER Phase 2 | approved, tier2, awaiting Owner sign-off | Owner merge decision (tier2) — **not a dispatch item**. |
| `#323` prompt-cache Phase 1 + FM photo digitization | green, tier2 | Owner merge decision (tier2). |
| `#484` smoke test | contaminated (generated drizzle artifacts) | Strip generated artifacts, merge only the README one-liner — small cleanup, **tier1 after cleanup**. |
| `#477`/`#481` claim-registration PRs | docs-only, blocked by audit-check/E2E | Low-priority housekeeping merges. |
| `#305` sales-engine-audit claim | stale (audit-check failing) | Likely close — the audit itself is done and in recently_completed. |

---

## COLLISION / DUPLICATION CHECK (explicit, per task requirement)

For every candidate item, confirmed against `ai-os/boss/ACTIVE-CLAIMS.yaml` `active:` (full read) + `gh pr list` (both repos) that no other entry/PR covers the same file/module scope.

### Items EXCLUDED from the dispatch plan because they are already claimed / already open as a PR

1. **AIROUTER-01 Phase 2 (Software Team L0-L5)** — PR #483 open (tier2, approved, awaiting sign-off). CONTROLLER explicitly holds Tables 2–4 until Phase 2 merges. **Excluded.** A future "AIROUTER Tables 2–4" task is in the plan but gated on #483.
2. **PROJEXA E2E Phase 2** — 3 active claims (Batches A/B/C), PR #47 (projexa) open. **Excluded.**
3. **compliance-tracker veridian-ui-kit v0.2.0 full swap** — active claim `task-20260719-050016` (AI Router) and `task-20260719-034948`/`task-20260719-025216` (the migrate-to-uikit tasks, both in recently_completed and in-flight). **Excluded** — the full-swap is actively being done.
4. **RES-02 / GAP-NARROW-MONITOR Phase 1 expansion** — active claim `task-20260719-004413` (now merged/complete per MASTER-TRACKER status_update 2026-07-19). **Excluded** (done).
5. **DMP-04 FDE Dynamic Chain bundle** — active claim `task-20260719-004411`. **Excluded** (in-flight).
6. **Calculation Engine / Calculation Governance (5 findings)** — active claim `task-20260718-084003`. **Excluded** (in-flight).
7. **Checks & Balances / Risk, Fraud & Anomaly Detection** — active claim `task-20260718-091004`. **Excluded** (in-flight).
8. **AI Architecture / Explainability & Transparency (26 findings)** — active claim `task-20260718-053002`. **Excluded** (in-flight).
9. **AI Architecture / Governance & Audit (GP-06/09/26, ABAC, audit-trail)** — active claim `task-20260718-053004` + held tier2 PR #419. **Excluded** (in-flight + tier2-held).
10. **AI Architecture / AI Interaction Efficiency (11 findings)** — active claim `task-20260718-053002`-family + held tier2 PR #414. **Excluded** (in-flight + tier2-held).
11. **AI Architecture / AI Capability Registry coverage** — active claim (background sub-agent), done. **Excluded** (done).
12. **AI Architecture / Multi-Modal & Multi-Language** — active claim `task-20260718-053006` + held PR #418. **Excluded** (in-flight + tier2-held).
13. **Checks & Balances / Separation of Duties & Approval Controls** — active claim `task-20260718-092002`. **Excluded** (in-flight).
14. **Checks & Balances / Business Rule & Calculation Verification** — active claim `task-20260718-085003`. **Excluded** (in-flight).
15. **Calculation Engine / Formula Library & Customization** — active claim `task-20260718-084004`. **Excluded** (in-flight).
16. **CRM Accounts & Contacts business-rule + RBAC** — active claim `task-20260717` (Track 1). **Excluded** (in-flight) — AND it's one of the 9 laptop-worktree BLOCKED workstreams (see below).
17. **Shared ERP permission-check utility + Fixed Assets / Sales Orders / Quotations RBAC** — active claim `task-20260717` (Track 1). **Excluded** (in-flight) — AND Fixed Assets is one of the 9 laptop-worktree BLOCKED workstreams.
18. **Change Order e-signature auto-transition** — active claim `task-20260717` (background sub-agent). **Excluded** (in-flight).
19. **AIROUTER-01 Mother Router Phase 1** — merged (#433). Stale active entry. **Excluded** (done).

### The 9-workstream "VERIDIAN Review Framework implementation wave" — BLOCKED (laptop worktree conflict)

Per the task's explicit context, real **partial, uncommitted work exists on the Owner's laptop** (not this server, not GitHub, not visible here) for these 9 areas. Each is flagged **BLOCKED** — a server-side task must NOT touch the same scope until the Owner either pushes the laptop work or explicitly abandons it:

- [ ] **BLOCKED — 1. Security/bug fixes** (review-framework wave). Partial work on laptop. Do not re-do.
- [ ] **BLOCKED — 2. Marketing/docs fixes** (review-framework wave). Partial work on laptop. Do not re-do. *(Note: PROJEXA-MARKETING-02 is `done` and live on projexa-ai.com — distinct from this laptop workstream; confirm with Owner whether overlap.)*
- [ ] **BLOCKED — 3. CRM Accounts & Contacts** — partial work on laptop. (Also has an active server-side claim `task-20260717` Track 1 — real collision risk; the Owner must reconcile.)
- [ ] **BLOCKED — 4. HR Attendance & Manpower** — partial work on laptop.
- [ ] **BLOCKED — 5. Fixed Assets wiring** — partial work on laptop. (Also has an active server-side claim `task-20260717` Track 1 — real collision risk; the Owner must reconcile.)
- [ ] **BLOCKED — 6. Payment Entries approval flow** — partial work on laptop.
- [ ] **BLOCKED — 7. BYOB white-label branding** — partial work on laptop. *(BYOB subscription-tier gating is also named in AIROUTER-01 Phase 2 scope as PENDING — confirm with Owner whether these are the same scope.)*
- [ ] **BLOCKED — 8. BYOB bring-your-own-AI-model** — partial work on laptop. *(Same AIROUTER-01 overlap caveat.)*
- [ ] **BLOCKED — 9. Training LMS module** — partial work on laptop.
- [ ] **BLOCKED — 10. groq-vision-model sibling-file fix** — partial work on laptop.

> **Owner decision requested (one batch):** for each of the 10 items above, push the laptop worktree's contents to a branch (so this server can audit/finish it behind the normal PR/CI gate), OR explicitly abandon it so a server-side task can start clean. Do not silently pick one.

### Items with NO collision found (cleared for dispatch)

- `FINDING-PLAYWRIGHT-E2E-BROKEN-REPO-WIDE` (E2E CI fix — `.github/workflows/ci.yml` + `package.json` devDep; no active claim touches this).
- `GAP-AGENT-CAPABILITY-BRIDGE` (roster.ts ↔ workerAgents bridge — no active claim).
- `GAP-UMR-TABLE-COVERAGE` next tranche (additive migrations; no active claim on the specific tables).
- AIROUTER Tables 2–4 **after #483 merges** (gated, not current).
- `GAP-NARROW-MONITOR-ESCALATION` Phase 2 (general Tier 2/3 executors — no active claim; Phase 1 is done).
- Dependabot bumps (no collision).
- PR #484 artifact cleanup (no collision — the smoke test is a one-off).

---

## PRIORITY-ORDERED DISPATCH PLAN

Ordered list of what to dispatch first, each sized into a real task-shaped unit. A future dispatch script takes the first `- [ ]` with `READY: yes`.

### Tier routing (restated): every task → Mother Router `software_team` scope → GLM-5.2 via OpenRouter API (direct, since the proxy is disabled — see STATUS SNAPSHOT), cheapest provider, every level. The L1–L4 label is granularity/scope only.

---

- [ ] **TASK 1 — Fix repo-wide Playwright E2E CI breakage (add playwright as a real devDependency)**
  - **READY: yes**
  - **SOFTWARE TEAM LEVEL: L1 Code Worker** (single-file-ish mechanical fix: `package.json` devDep + one workflow tweak; no architecture; deterministic verify via CI run)
  - **Source:** CONTROLLER `FINDING-PLAYWRIGHT-E2E-BROKEN-REPO-WIDE` (status: open, confirmed reproduced on plain main ~2026-07-19T06:00 UTC)
  - **TASK ID: FIX-PLAYWRIGHT-E2E-CI-01**
  - **MODULE: compliance-tracker**
  - **OBJECTIVE:** Repair the 'E2E Tests' CI job that is currently broken for every PR. Root cause (confirmed, not assumed): `bunx fetches playwright@latest` (currently 1.61.1) fresh per-run with no version pin, and this version's config-loader cannot resolve `playwright.config.ts`'s self-referencing `import { defineConfig } from "playwright/test"` because the project has never had playwright as a real local devDependency. Not a required merge-blocking check today, but a real confirmed repo-wide regression.
  - **READ FIRST:** (1) `ai-os/boss/ACTIVE-CLAIMS.yaml` — register a claim before starting; confirm no active entry touches `.github/workflows/ci.yml` or `package.json`'s playwright/devDependencies (none do as of 2026-07-19). (2) `.github/workflows/ci.yml` 'E2E Tests' job — read the exact `bunx playwright test` invocation. (3) `playwright.config.ts` — read the self-referencing import that breaks under unpinned bunx. (4) `package.json` — confirm playwright is absent from devDependencies.
  - **WHAT TO BUILD:** Add `playwright` (and `@playwright/test` if the config imports that) as a real pinned `devDependency` in `package.json` at a known-working version (determine the last known-working version by testing config self-resolution locally first; do not pin to `latest`). Run `bun install` to populate `node_modules`/lockfile. Update the `ci.yml` 'E2E Tests' job to use the project's own `node_modules` playwright (e.g. `bunx --bun playwright test` or `./node_modules/.bin/playwright test` or `bun run` script) rather than `bunx playwright test` (which fetches fresh). Confirm the config self-reference now resolves against the project's own `node_modules`.
  - **CONSTRAINTS:** Read-only investigation except the fix. No new test files. No schema/migration. **CAUTION: this session's gh token lacks `workflow` scope** (memory: `gh-token-lacks-workflow-scope`) — a PR touching `.github/workflows/*.yml` cannot be pushed by this token. Either request a token with `workflow` scope for this specific task, or scope the fix to `package.json` + lockfile only and leave the `ci.yml` invocation change for a follow-up the Owner can push. Document which path was taken. Register ACTIVE-CLAIMS claim first. Commit+push incrementally. Branch + PR, not direct-to-main.
  - **DONE CRITERIA:** `package.json` pins a real playwright devDependency; lockfile updated; `bunx playwright test` (or the chosen fixed invocation) resolves `playwright.config.ts`'s self-import without a temp-fetched copy; CI 'E2E Tests' job no longer fails on the config-loader step (it may still be `--pass-with-no-tests` since real E2E files are in projexa, not compliance-tracker — that's fine, the job must merely *run* without the import error); PR open; ACTIVE-CLAIMS claim updated with PR number.

- [ ] **TASK 2 — Cleanup PR #484 (strip generated drizzle artifacts, keep only the legitimate README one-liner)**
  - **READY: yes** (but verify the GLM-5.2 proxy question with the Owner first — the smoke test's *purpose* was verifying proxy routing; if the proxy is disabled, the whole smoke test is moot. If the Owner confirms "no proxy, use OpenRouter API directly," this PR may just be closed unmerged rather than cleaned up.)
  - **SOFTWARE TEAM LEVEL: L1 Code Worker** (mechanical: delete 2 generated files + revert a `_journal.json` edit; no logic)
  - **Source:** open PR #484 (CONFLICTING, contaminated). Superboss review already documented the exact problem in the PR body.
  - **TASK ID: CLEANUP-PR-484-01**
  - **MODULE: compliance-tracker**
  - **OBJECTIVE:** Make PR #484 mergeable by removing the accidentally-committed generated Drizzle artifacts (`drizzle/0001_wakeful_reptil.sql` — 6080 lines, collides with existing `0001_mcp_access_codes.sql`; `drizzle/meta/0001_snapshot.json` — 37005 lines; and the `drizzle/meta/_journal.json` edit), keeping only the legitimate one-line HTML comment appended to `README.md` (the worker's actual intended output).
  - **READ FIRST:** (1) PR #484 body (Superboss review documents the exact files to remove). (2) Run `node scripts/check-migration-collision.mjs` to confirm the collision. (3) Confirm `0001_wakeful_reptil.sql` is a generated artifact (matches `bun run db:generate` output shape), NOT hand-authored work. (4) **Confirm with the Owner whether the GLM-5.2 proxy should be (re)built** — if yes, this cleanup proceeds and a real proxy-verification smoke test is re-dispatched; if no (use OpenRouter API directly), close #484 unmerged and skip.
  - **WHAT TO BUILD:** Delete `drizzle/0001_wakeful_reptil.sql` and `drizzle/meta/0001_snapshot.json` from the PR branch. Revert the `drizzle/meta/_journal.json` edit. Keep `README.md`'s appended one-liner. Force-push the cleaned branch (or open a replacement PR and close #484). Verify `node scripts/check-migration-collision.mjs` passes.
  - **CONSTRAINTS:** Read-only except the cleanup. No schema/migration added. Register ACTIVE-CLAIMS claim. Do not self-merge tier2 — but after cleanup this is tier1 (docs-only README change); still leave for supervisor audit per standing procedure.
  - **DONE CRITERIA:** PR #484 (or its replacement) contains ONLY `README.md` one-liner + PROGRESS.md; `check-migration-collision.mjs` passes; mergeable (no CONFLICTING); CI's migration-collision/guardrail checks green.

- [ ] **TASK 3 — Owner-decision batch: reconcile the 9-workstream laptop-worktree conflict + the 5 tier2-held PRs + the GLM-5.2 proxy question**
  - **READY: blocked (Owner decision required — this is a *decision* task, not a code task; surfaced to the Owner, not dispatched to a worker)**
  - **SOFTWARE TEAM LEVEL: L4 Coding Supervisor** (decision/coordination, not implementation)
  - **Source:** task prompt's laptop-worktree context + CONTROLLER `PR-RESCUE-TIER2-SIGNOFF-QUEUE-01` + `SECURITY-FLAG-RLS-DISABLED-*`
  - **TASK ID: OWNER-DECISION-BATCH-2026-07-19**
  - **MODULE: cross-repo governance**
  - **OBJECTIVE:** Collect every item currently awaiting an explicit Owner decision into one batched ask so the Owner can answer once and unblock multiple downstream dispatches. (This is a report to the Owner, NOT code work.)
  - **READ FIRST:** (1) This plan's COLLISION CHECK section (the 10 BLOCKED laptop-worktree items). (2) CONTROLLER `PR-RESCUE-TIER2-SIGNOFF-QUEUE-01` (5 tier2 PRs awaiting sign-off: #433 done, #419, #414, #412, #415). (3) CONTROLLER `SECURITY-FLAG-RLS-DISABLED-3-TABLES` + `...AGENT-REVIEW-RECORDS` (RLS-enable remediation SQL prepared, awaiting go-ahead — note: ZERO-GAPS-CLOSURE says these were closed live via Supabase MCP, so confirm whether this is still open). (4) STATUS SNAPSHOT's GLM-5.2 proxy question.
  - **WHAT TO BUILD:** A single concise decision-request document (to the Owner, in chat) listing: (a) the 10 laptop-worktree BLOCKED items with the ask "push or abandon each"; (b) the 5 tier2-held PRs with the ask "merge sign-off or reject"; (c) the GLM-5.2 proxy question "rebuild proxy or use OpenRouter API directly"; (d) any SECURITY-FLAG items still genuinely open. No code changes.
  - **CONSTRAINTS:** This task produces a message to the Owner, not a PR. Do not act on any of the decisions unilaterally.
  - **DONE CRITERIA:** Owner has answered each decision; answers recorded (in CONTROLLER.yaml status flips / a memory file); downstream tasks (e.g. AIROUTER Tables 2–4, a real proxy-verification smoke test) are then unblocked and can be re-prioritized.

- [ ] **TASK 4 — AIROUTER Tables 2–4 (End User Work Management / Sales & Marketing / Customer Success) — GATED**
  - **READY: blocked on PR #483 (Phase 2 / Table 1) merging first**
  - **SOFTWARE TEAM LEVEL: L3 Feature Worker** (multi-file feature across router + registry + policy + docs; approved-design implementation)
  - **Source:** CONTROLLER `AIROUTER-01` `.phase2_2026_07_19` — Tables 2–4 explicitly held until Table 1 (Software Dev) lands.
  - **TASK ID: AIROUTER-01-PHASE2-TABLES-2-4**
  - **MODULE: compliance-tracker**
  - **OBJECTIVE:** After PR #483 merges, extend the L0–L5 Software Team hierarchy + Instruction Contract / Execution Report system to the 3 remaining Owner-spec domain tables: End User Work Management, Sales & Marketing, Customer Success — same per-level contract shape, same registry-backed (no hardcoded model strings) routing, same cost-bias (low/mid tiers for execution, GLM-5.2 for supervision/audit).
  - **READ FIRST:** (1) The merged Phase 2 PR #483 (Table 1) in full — this is the template; do not diverge. (2) `ai-os/CONSTITUTION.yaml` section 11 (ai_orchestra_tiers) + whatever new section #483 added for the Software Team ladder. (3) `control/AI_AGENT_INSTRUCTION_MANUAL_DRAFT.md` (the Owner's verbatim L0–L5 spec across all 4 tables). (4) `memory/veridian_ai_router_hierarchy_project_2026-07-18.md` for resume-checkpoint. (5) `ai-os/boss/ACTIVE-CLAIMS.yaml` — register claim, confirm #483 has merged.
  - **WHAT TO BUILD:** For each of Tables 2/3/4: the per-level role/model/objective/authority/not-allowed rows, the Instruction Contract/Execution Report applicability, and the capability-based routing-matrix seed rows in `ai_routing_policies`/`ai_model_registry` (swappable via hot-reload, not hardcoded). Reuse the Table 1 task register + contract schema verbatim (no second parallel system). Extend the CONSTITUTION section + `ai-os/SOFTWARE_TEAM.md` doc. 3-round GLM-5.2 audit loop (same as #483).
  - **CONSTRAINTS:** GATED — do not start until #483 merges. `CLAUDE_CODE_OAUTH_TOKEN` only, never `ANTHROPIC_API_KEY`. No hardcoded model strings. Tier2 (schema/architecture) — supervisor holds for Owner sign-off, do not self-merge. Register ACTIVE-CLAIMS claim. Commit/push incrementally. Call GLM-5.2 via OpenRouter API directly (proxy disabled).
  - **DONE CRITERIA:** Tables 2/3/4 implemented + wired to the existing Mother Router (extends, not duplicates); tsc/lint/test/build clean; 3 real GLM-5.2 audit rounds logged in `ai-os/AIROUTER_SOFTWARE_TEAM_AUDIT_LOG.md`; docs synced; PR open, not self-merged.

- [ ] **TASK 5 — PROJEXA E2E Phase 3 (chat/composer command testing against the real capability tree) — GATED**
  - **READY: blocked on Phase 2 (Batches A/B/C) findings landing**
  - **SOFTWARE TEAM LEVEL: L2 Sequential Worker** (multi-step test-writing + execution against a live site, validate each step)
  - **Source:** CONTROLLER `PROJEXA-E2E-TESTING-PROGRAM-2026-07-19` — Phase 3 sequenced after Phase 2.
  - **TASK ID: PROJEXA-E2E-PHASE3**
  - **MODULE: projexa** (cross-registered in compliance-tracker's ACTIVE-CLAIMS per the Phase 1/2 precedent)
  - **OBJECTIVE:** After Phase 2's 3 batches land their findings, run real natural-language chat-command testing against PROJEXA's Copilot's real 7-tool dispatcher (`dispatchTool()` in compliance-tracker's `task-execution-engine.ts`, reached via `POST /api/v1/projexa/assistant`) across the capability tree — exercise real intent resolution, tool dispatch, and response correctness against the seeded "Meridian Construction Group" test org.
  - **READ FIRST:** (1) `PHASE1_SEED_REPORT.md` (FChecklist/projexa) + the 3 `PHASE2_BATCH_*_FINDINGS.md` reports. (2) `task-execution-engine.ts`'s `dispatchTool()` + the 7 tools' real call sites. (3) `capability-tree-service.ts` for the real tree shape. (4) ACTIVE-CLAIMS — register claim, confirm Phase 2 batches are done.
  - **WHAT TO BUILD:** Real Playwright (or API-level) chat-command test suite covering a representative spread of the capability tree (per-module + cross-module intents), asserting on real dispatched-tool + real response, against the live `projexa-ai.com` deployment + the seeded org. A `PHASE3_FINDINGS.md` report.
  - **CONSTRAINTS:** GATED on Phase 2. Read-mostly + additive writes only (no schema/migration). Register claim. Do not self-merge tier2 if any schema change creeps in (it shouldn't).
  - **DONE CRITERIA:** Suite runs against live site; findings doc precise (expected vs actual, route, tool); PR open in FChecklist/projexa; ACTIVE-CLAIMS updated.

- [ ] **TASK 6 — PROJEXA E2E Phase 4 (gap document) + Phase 5 (100% fix implementation) — GATED**
  - **READY: blocked on Phases 2 + 3**
  - **SOFTWARE TEAM LEVEL: L4 Coding Supervisor** (gap synthesis + multi-file fix implementation across compliance-tracker + projexa)
  - **Source:** CONTROLLER `PROJEXA-E2E-TESTING-PROGRAM-2026-07-19` Phases 4 + 5.
  - **TASK ID: PROJEXA-E2E-PHASE4-5**
  - **MODULE: cross-repo (projexa + compliance-tracker)**
  - **OBJECTIVE:** Phase 4: synthesize every real gap from Phases 2+3 into a single gap document (per-module, exact route/field/expected-vs-actual). Phase 5: implement 100% of the fixes, cross-checked against `ai-os/CONSTITUTION.yaml`'s declared logic, no half-built work.
  - **READ FIRST:** all Phase 2/3 findings docs; the real backing service code for each gap; CONSTITUTION.yaml.
  - **WHAT TO BUILD:** `PHASE4_GAP_DOCUMENT.md` (the single synthesized gap list, prioritized). Then real fixes per gap, each with tsc/lint/test/build verification + audit. Owner authorized proceeding through tier2 sign-offs without separate check-ins for this program ("you dont need my approval") but still apply engineering judgment (CI green, audit posted, no destructive/payment/credential actions).
  - **CONSTRAINTS:** GATED on Phases 2+3. Tier2 fixes held for Owner sign-off per the tiered trust model even within this program. Register claim.
  - **DONE CRITERIA:** Gap doc complete; every gap fixed or explicitly documented-as-deferred with a real reason; all CI green; PRs open; ACTIVE-CLAIMS updated.

- [ ] **TASK 7 — GAP-AGENT-CAPABILITY-BRIDGE (roster.ts ↔ workerAgents cross-reference layer)**
  - **READY: yes (low priority)**
  - **SOFTWARE TEAM LEVEL: L2 Sequential Worker** (cross-reference/lookup layer across 2 existing registries; no architecture change; validate both sides still match)
  - **Source:** MASTER-TRACKER `GAP-AGENT-CAPABILITY-BRIDGE` (deferred_medium; PLATFORM_STRATEGY.md §30.2's Agent Capability row; not closed by GAP-AI-WORKFORCE-GOVERNANCE's ARR build)
  - **TASK ID: GAP-AGENT-CAPABILITY-BRIDGE**
  - **MODULE: compliance-tracker**
  - **OBJECTIVE:** Build a real governance bridge between `roster.ts` (internal AI Dev Team roles) and `workerAgents` (customer-facing capability catalog) — a cross-reference/lookup layer, NOT a merge (both are deliberately separate concepts per roster.ts's own header). Closes a conceptual/discoverability gap, not a data-integrity one.
  - **READ FIRST:** (1) `src/lib/ai-team/roster.ts` + `workerAgents` schema/service. (2) `agent-review-service.ts` (ARR reviews roster.ts roles only — confirmed workerAgents out of scope there). (3) PLATFORM_STRATEGY.md §30.2. (4) ACTIVE-CLAIMS — confirm no active entry touches both registries' bridge (none do).
  - **WHAT TO BUILD:** A lookup/cross-reference layer (e.g. an API route + read view mapping roster role_keys ↔ worker_agent capability keys) with real unit tests. No merge of the two systems. Document the mapping semantics in `ai-os/`.
  - **CONSTRAINTS:** Read-only investigation except the new bridge. No new write path that overloads either registry's existing contract. Register claim. Low priority — do not preempt higher-value tasks.
  - **DONE CRITERIA:** Bridge built + tested; tsc/lint/test clean; PR open; ACTIVE-CLAIMS updated.

- [ ] **TASK 8 — GAP-UMR-TABLE-COVERAGE next tranche (onboard more grandfather-exempted tables)**
  - **READY: yes (low priority, mechanical)**
  - **SOFTWARE TEAM LEVEL: L1 Code Worker** (XS-per-table additive migration + asset-registry-coverage.yaml update; mechanical pattern proven across 4 prior batches)
  - **Source:** MASTER-TRACKER `GAP-UMR-TABLE-COVERAGE` (129 registered / 280 exempted; long tail; ~10-line migration per table)
  - **TASK ID: GAP-UMR-TABLE-COVERAGE-BATCH6**
  - **MODULE: compliance-tracker**
  - **OBJECTIVE:** Onboard the next tranche of grandfather-exempted business-object tables onto the generic `auto_register_asset()` trigger, following the exact pattern of Priorities 8/10/11/17 (drizzle/02NN migration + `asset-registry-coverage.yaml` updates + per-table review for a real display-name + direct org_id, with real documented reasons for any table left exempted). Pick a domain-spanning tranche (don't rubber-stamp a whole module at once — the prior batches' discipline).
  - **READ FIRST:** (1) `schema.ts` for the full exempted list. (2) Prior batches' migrations (drizzle/0161, 0171, 0184, 0193, 0198) for the exact pattern. (3) `ai-os/registry/asset-registry-coverage.yaml` current state. (4) `scripts/check-asset-registry-coverage.mjs`. (5) ACTIVE-CLAIMS — confirm no active entry is mid-batch (none are right now).
  - **WHAT TO BUILD:** A new `drizzle/02NN` migration (verify the next free number against origin/main AND open PRs first — this repo has a documented history of cross-PR migration-number collisions; re-check immediately before applying). Apply live via Supabase MCP only if the task has DB access; otherwise leave the migration for the supervisor to apply. Update `asset-registry-coverage.yaml` with real per-table reasons.
  - **CONSTRAINTS:** Additive only. Real per-table review (display-name + direct org_id); document real reasons for exempted tables, never silently skip. Tier2 (touches drizzle + live DB) — supervisor holds for Owner sign-off, do not self-merge. Register claim.
  - **DONE CRITERIA:** New tranche onboarded + backfilled + verified live; coverage manifest updated; `check-asset-registry-coverage.mjs` passes; tsc/lint/test clean; PR open, not self-merged.

- [ ] **TASK 9 — GAP-NARROW-MONITOR-ESCALATION Phase 2 (general Tier 2/3 executors)**
  - **READY: yes (deferred_medium, not urgent; has a working precedent)**
  - **SOFTWARE TEAM LEVEL: L3 Feature Worker** (new executor tier on top of the Phase-0/1 registry; reuse proven pattern)
  - **Source:** MASTER-TRACKER `GAP-NARROW-MONITOR-ESCALATION` — Phase 2 open; Tier-3 precedent exists in `dispatch-completion-monitor.ts`.
  - **TASK ID: RES-02-PHASE2**
  - **MODULE: compliance-tracker**
  - **OBJECTIVE:** Build the general Tier 2/3 language-understanding monitor executors for the event types Phase 1's rule-engine (Tier 1) cannot cover — reusing `dispatch-completion-monitor.ts`'s proven GPT-OSS-120B Tier-3 pattern (fail-closed, 5-field MonitorReportFields, never approves/rejects/merges/edits). Investigate the remaining ~19 Phase-1-blocked event types: those blocked on "no TenantDb/dbUser at cron call sites" need either an extension to `logActivity()`/cron routes to support a system actor with a real transaction context, or an honest decision that some named event types aren't worth a real call site.
  - **READ FIRST:** (1) `src/lib/monitors/` (all Phase 0/1 monitors, especially `dispatch-completion-monitor.ts` as the Tier-3 precedent + `rule-engine-monitor.ts` shared executor). (2) `ai-os/CONSTITUTION.yaml` RES-02's `gap` field (the 3-reason breakdown for the ~19 blocked types). (3) `escalation-ladder.ts`. (4) ACTIVE-CLAIMS — confirm Phase 1 task (`task-20260719-004413`) is merged (it is).
  - **WHAT TO BUILD:** Tier 2/3 executor(s) + their `monitor_agents` registry rows (migration drizzle/02NN) + wiring at real call sites; for the cron-blocked types, either the `logActivity()` system-actor extension OR an honest documented "not worth building" decision per type.
  - **CONSTRAINTS:** No fabricated call sites (Phase 1's discipline). Fail-closed on any model error. Tier2 (schema) — supervisor holds, do not self-merge. Register claim.
  - **DONE CRITERIA:** Tier 2/3 executors built + tested; every remaining event type either wired or honestly documented-deferred with a real reason; tsc/lint/test clean; PR open, not self-merged.

- [ ] **TASK 10 — Dependabot bump triage + tier2-held PR merge-decision support (housekeeping)**
  - **READY: yes (low priority housekeeping)**
  - **SOFTWARE TEAM LEVEL: L1 Code Worker** (mechanical dependency bumps + CI verification)
  - **Source:** open PRs `#151` (typescript 7.0.2), `#407` (actions/checkout v7), `#408` (sharp 0.35.3), `#409` (pptxgenjs 4.0.1), `#410` (eslint 10.7.0)
  - **TASK ID: DEPENDABOT-TRIAGE-2026-07-19**
  - **MODULE: compliance-tracker**
  - **OBJECTIVE:** Triage and merge the open dependabot bumps that are safe (after CI green), and flag any that risk a real break (e.g. typescript 7.0.2 / eslint 10.7.0 major bumps — verify tsc/lint clean before merge). This keeps the dependency surface current without blocking real work.
  - **READ FIRST:** each bump PR's CI status; `package.json` for the current pinned versions; any peer-dep conflicts.
  - **WHAT TO BUILD:** Merge the safe bumps (sharp/checkout/pptxgenjs likely tier1); for typescript/eslint major bumps, verify a clean local `tsc --noEmit` + `bun run lint` + `bun run build` first; if clean, merge, else leave a comment with the breakage and skip.
  - **CONSTRAINTS:** No code changes beyond the bumps. Register claim for the batch. Tier1 merges after CI green; tier2 if any bump touches build config. CAUTION: gh-token `workflow` scope limit applies to `#407` (actions/checkout).
  - **DONE CRITERIA:** Each bump either merged (with evidence of clean tsc/lint/build for majors) or commented-skip with the real reason; ACTIVE-CLAIMS updated.

- [ ] **TASK 11 — OPEN-09 org/user bulk data export mechanism — GATED on Owner priority**
  - **READY: blocked on Owner explicitly requesting build (Owner 2026-07-14: "log as pending, NOT an immediate priority. Do not schedule build work until explicitly requested.")**
  - **SOFTWARE TEAM LEVEL: L3 Feature Worker** (new export service + route + auth/RLS care; compliance-facing)
  - **Source:** MASTER-TRACKER `OPEN-09`
  - **TASK ID: OPEN-09-DATA-EXPORT**
  - **MODULE: compliance-tracker**
  - **OBJECTIVE:** Build a general per-org/per-user bulk data export mechanism that the data-policy page (`src/app/data-policy/page.tsx`) already promises ("You may export your data during the life of your account"). Today only a single-meeting export exists (`/api/veri-meetings/[id]/export`). Per-org/per-user data IS identifiable throughout the schema (org_id + RLS) — the gap is the missing bulk export feature, not data modeling.
  - **READ FIRST:** `src/app/data-policy/page.tsx`; the existing single-meeting export route; RLS scoping; the privacy policy's exact wording to match.
  - **WHAT TO BUILD:** A new `/api/data-export` route (org-scoped + user-scoped variants), a real export service assembling the org's/user's data across tables, async job + download (given likely large payloads), RLS-enforced. Match the policy's exact promise; do not over- or under-deliver.
  - **CONSTRAINTS:** **DO NOT DISPATCH UNTIL OWNER EXPLICITLY REQUESTS.** This is a compliance-facing gap (a written policy promise with no backing mechanism) — re-flag that distinction when scoped, do not silently downgrade to "nice to have." Tier2 (new data-access surface) — supervisor holds. Register claim when actually starting.
  - **DONE CRITERIA:** Export mechanism built + tested + RLS-verified; policy page links to it; tsc/lint/test clean; PR open, not self-merged.

---

## NOTES / HONEST LIMITATIONS

- **`ai-os/SOFTWARE_TEAM.md` does not exist yet** on this server as of 2026-07-19 ~14:35 UTC. The task prompt says "this was just built and merged" — per CONTROLLER `AIROUTER-01` `.ai_agent_instruction_manual_2026_07_19` and the AIROUTER Phase 2 prompt, the doc is being authored **by the in-flight PR #483 itself** ("A dedicated ai-os/SOFTWARE_TEAM.md or similar…"). It is not on `origin/main` yet. The L1–L4 labels above use the level definitions from PR #483's task prompt (L0 Software Engine/no-AI, L1 Code Worker, L2 Sequential Worker, L3 Feature Worker, L4 Coding Supervisor, L5 Mother Router) — the same definitions `SOFTWARE_TEAM.md` will formalize once #483 merges. **Collision note:** no separate dispatch should author `SOFTWARE_TEAM.md` — it is owned by #483.
- **All tiers resolve to GLM-5.2 via OpenRouter** per the Owner's explicit instruction. The GLM-5.2 OpenRouter proxy is currently **disabled** (`/opt/veridian/shared/.env.backup-2026-07-18-glm-proxy-disable`); dispatched tasks should call the OpenRouter API directly with `OPENROUTER_API_KEY` (exactly as PR #483's task does), NOT via a proxy, until the Owner decides whether to rebuild a proxy layer (TASK 3 above surfaces this).
- **`/opt/veridian/repos/compliance-tracker`'s shared checkout has diverged** (1280 local-only commits, unrelated staged changes from an orphaned worker) per AIROUTER Phase 2's pre-dispatch finding. Any new server-side worker task must branch fresh from `origin/main` via its own worktree (the established pattern), NOT touch that shared directory.
- **This plan is grounded in state read live on 2026-07-19 ~14:35 UTC.** It will drift as in-flight PRs merge and active claims complete. A supervisor picking up a task should re-read `ai-os/boss/ACTIVE-CLAIMS.yaml` `active:` + `gh pr list` immediately before dispatching, per the registry's own protocol.
- **Items deliberately NOT included** (ratified-against or owner-blocked, per MASTER-TRACKER): RATIFIED-01..08, OPEN-01 (GITHUB_DISPATCH_PAT — Owner action), OPEN-02 (veda-advisors PR review — Owner action), OPEN-03 (credential rotation — Owner action), OPEN-04/05/06 (low-priority owner-decision), OPEN-10 (veda-advisors — declared in-scope but no migration authorized), GAP-CONNECTOR-LAYERS 3/4 (Owner prioritization), GAP-AUTH-REBUILD passcode/Google (deferred_large/owner-blocked), GAP-MOM-VOICE-TICKETS (owner-blocked provider), GAP-LITERT-EDGE-INFERENCE (blocked on external model maturity), GAP-DCMD full rich schema (deferred_large — needs design pass first).
