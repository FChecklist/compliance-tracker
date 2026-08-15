# OCID-043 — VERIDIAN Universal External Execution Runtime: Real Discovery Inventory (2026-08-03)

**Real UMR:** `UMR-20260803-084429-7a70`, parented to OCID-042 (`UMR-20260803-084332-5b52`), itself parented to
OCID-041 (`UMR-20260803-084109-6875`), parented to `UMR-20260802-173631-ca85` (OCID-021, the ERP Functional
Completeness Master Program). Registered as part of the OCID-041→046 chain in
`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`'s 2026-08-03 amendment (lines 1212-1307).

**Status: DISCOVERY ONLY. Not complete. No implementation performed.**

## 0. Scope and lock statement (read this first)

Per `ai-os/CONSTITUTION.yaml` SEC-07 (`ai-os/CONSTITUTION.yaml:652-657`), real implementation of worker runtime,
dispatch runtime, review/audit runtime, or `CONSTITUTION.yaml` itself stays locked until `UMR-20260802-165606-4413`
(OCID-020) independently clears, followed by OCID-038 → OCID-039 → OCID-040 in that exact order. None of those
four have cleared as of this writing. OCID-043 also depends on real results from OCID-041 and OCID-042 that do
not exist yet — both were registered the same cycle as OCID-043 and are themselves still at discovery. **Sibling
worker units for OCID-041, OCID-042, OCID-044, and OCID-045 were confirmed actively running concurrently with
this task** (`systemctl --user list-units 'veridian-worker@*'`, checked live: `veridian-worker@task-20260803-085546-register-ocid-041-...`,
`...085550-register-ocid-042-...`, `...085557-register-ocid-044-...`, `...085920-register-ocid-045-...`, all
`active running` at the time this document was written) — meaning their own canonical discovery artifacts do
not yet exist to defer to and this document cannot honestly cite content from them. This document is therefore
scoped narrowly and honestly: a real, independent inventory of the **existing platform infrastructure** (worker
runtime, dispatch engine, sentinel, review pipeline, PR pipeline, merge pipeline, lock framework) that any future
OCID-043 runtime would need to reuse — not a design for OCID-043 itself, and not a synthesis of OCID-041/042's
still-nonexistent findings. A future pass, once OCID-041/042/044 land, should cross-reference (not duplicate)
this inventory the same way OCID-030/034's canonical docs cross-referenced their own siblings
(`ai-os/OS.yaml:221-222,233-234`).

**No functional changes were made anywhere in this task**: no worker runtime, dispatch runtime, or
`CONSTITUTION.yaml` edits; no provider-selection or execution-dispatch code written or wired; OCID-043 is
**not** marked complete.

---

## 1. Worker runtime (what actually executes a task today)

Real, deployed systemd template: `/opt/veridian/scripts/systemd/veridian-worker@.service` (mirrored at
`/opt/veridian/repos/veridian-scripts/systemd/veridian-worker@.service`). `WorkingDirectory=/opt/veridian/ai-os/tasks/%i`,
`ExecStart=.../worker-entrypoint.sh %i`, real memory caps (`MemoryHigh=2G`/`MemoryMax=3G`/`MemorySwapMax=1G`,
added after a real OOM RCA). Deliberately has **no `[Install]` section** — a unit can never boot-activate itself;
it is only ever started by a caller already holding `dispatch_core.acquire_dispatch_lock()`.

- `claude-control/scripts/worker-entrypoint.sh` (933 lines) — the real execution loop: reads `task.yaml`'s
  `branch` field, runs a pre-flight guard, invokes `claude -p` against the task's isolated git worktree,
  checkpoints periodically via `veridian-task.py checkpoint`, resumes from the last checkpoint on restart via
  `veridian-task.py resume-context`, enforces `MAX_LIFETIME_INVOCATIONS=20` and `WORKER_BUDGET_CAP_USD=10`,
  pushes the branch on success but never merges/deploys itself, and hands off to
  `veridian-supervisor@${TASK_ID}.service` for review on completion.
- `veridian-task.py::cmd_create` — builds `task_id = task-{ts}-{slug}` (timestamp-prefixed, collision-safe),
  `workspace = {task_dir}/workspace`, `branch = worker/{task_id}`, creates the isolated git worktree
  (`git worktree add -b {branch} {workspace} origin/{default_branch}`), writes `prompt.txt` + `task.yaml`, then
  starts `veridian-worker@{task_id}.service`. `cmd_adopt` is the manual-adoption path for a pre-existing branch
  (starts `veridian-supervisor@{task_id}.service` instead).
- `task-gateway.py::cmd_start` is the real dispatch gate in front of `veridian-task.py create`: enforces
  `REQUIRED_TASK_SECTIONS` presence (from `workflow_contract.py`), `tight_task_validation.py`,
  `ddl_authorization_check.py` (SEC-06), and a duplicate-`task_key` claim via `superboss-register.py
  claim-task-key`, before calling `veridian-task.py create`.
- `veridian-task-watchdog.py` detects stalled units and retriggers them (`_fix_restart_unit`,
  `_fix_reset_failed_and_start`) by submitting a `systemctl_action` job through `resource_governor.submit()`
  rather than calling `systemctl` directly.
- `resource_governor.py::submit(task_spec, tier, source_trigger)` is the single gated entrypoint every scheduled
  trigger (cron/systemd timer/worker spawn) writes through, backed by a persistent SQLite queue (`umr_tasks`),
  a `CONCURRENCY_CAP=5`, and a real-time `has_resource_headroom()` veto.

**Unique task identity** — three linked identifiers: `task_id` (timestamp-prefixed, collision-safe), the git
`branch` (`worker/<task_id>`), and a separate UMR id (one row per job submitted through
`resource_governor.submit()`, used for retrigger/dedup). `task_key` (a slugified-title dedup key) additionally
blocks duplicate dispatch at `task-gateway.py`.

## 2. Dispatch engine (how a task reaches a specific agent/model today)

`repository_dispatch` reality vs. docs: AGENTS.md documents `zai-task`/`claude-task` event types, but
`.github/workflows/ai-dispatch.yml` — which listens for `[ai-task, claude-task, zai-task, codex-task,
sentinel-task]` — only `echo`s the event/task/secret-presence in its jobs. **This is a stub/log-only workflow,
not a live dispatcher.** AGENTS.md itself already says the `claude-task` path "has never had a working job
behind it."

Real routing logic that exists:

- `src/lib/model-tier-eligibility.ts` — deterministic, no-LLM gate. `JUDGMENT_ELIGIBLE = {z-ai/glm-5.2}`,
  `INTEGRATIVE_ELIGIBLE` adds a handful of named models, mechanical tier accepts any model.
  `isModelEligibleForTier`/`checkTierEligibility` are called from three real dispatch surfaces
  (`/api/ai/team/dispatch`, `dispatch-repo.ts`, `ai-workforce-agent.mjs`) per AGENTS.md Rule 10.
- `src/lib/ai-team/dispatch-repo.ts::dispatchRepoTask()` fires a GitHub `ai-team-task` repository_dispatch event
  after `validateTightTask` + `checkTierEligibility`. **Explicitly disclosed in its own header as not live**:
  "this dispatcher has no live callers yet... will throw until GITHUB_DISPATCH_PAT is added to Vercel."
- `src/lib/ai-router/mother-router.ts` is the closest existing concept to "select best available provider":
  `resolveModel()`/`computeSoftwareTeamResolution()` resolve tenant override → `ai_routing_policies` policy
  override → `roster.ts` baseline, every branch re-checked against `checkTierEligibility` (never grants an
  ineligible model). Its own header states it does **not** replace `model-tier-eligibility.ts`/
  `orchestra-model-resolver.ts`/`roster.ts`/`llm-client.ts`, and 35 real call sites still bypass it entirely.
- `orchestra-model-resolver.ts` implements a provider-fallback chain (`platform_default` → `platform_fallback`)
  — availability-driven fallback exists, but by fixed role/provider config, **not** live health probing of
  actual provider availability.

**Honest synthesis**: a real, partial "provider eligibility + fallback" mechanism already exists
(`model-tier-eligibility.ts` + `orchestra-model-resolver.ts` + Mother Router), but nothing today treats an
*external, non-VERIDIAN-hosted* AI provider (ChatGPT, external Z.ai/GLM, DeepSeek, Gemini as literal external
execution processors, per OCID-041's own mission text) as a dispatch target through this existing routing stack.
The routing stack today selects among VERIDIAN's own internal model-access configuration, not among external
providers acting as task executors.

## 3. Task contract (existing deterministic handoff formats)

Two real, distinct, **currently un-merged** schemas exist:

- **Prompt-section contract (worker-facing, enforced today)**: `workflow_contract.py::REQUIRED_TASK_SECTIONS =
  ["OBJECTIVE","SCOPE","KNOWN_CONTEXT","SUCCESS_CRITERIA","EXPECTED_OUTPUT","CONSTRAINTS","COMPLEXITY_TIER"]`,
  checked via `has_all_required_sections()` and enforced by `task-gateway.py` before a worker unit is ever
  created. This is what actually gates every `veridian-worker@*` dispatch today (`task.yaml` + `prompt.txt`).
- **Instruction Contract / Execution Report** (`src/lib/ai-router/instruction-contract.ts`, AIROUTER-01,
  documented in `ai-os/SOFTWARE_TEAM.md:83-118`): `InstructionContract` (`taskId, level, roleKey, objective,
  preconditions[], input, process[], constraints?, expectedOutputFormat, validationCriteria, successCriteria,
  failureCriteria, retryPolicy, escalationRule, documentationRequirements, evidenceRequired,
  handoverRequirements, expectedSteps`), validated by `validateInstructionContract()`; paired with an
  `ExecutionReport` (`task_id, task_type, objective, status, overall_confidence, completion{...},
  steps[{...}], missing[], warnings[], errors[], escalation{...}, execution_summary{...}`), persisted
  one-row-per-`taskId` in `platform.task_register`. Real code, real tests, real migration — but **not confirmed
  wired into the `veridian-worker@*`/`worker-entrypoint.sh` path**, which uses `task.yaml`+`prompt.txt` instead.

**Gap for a future OCID-043 to resolve, not resolved here**: which of these two contract systems (or a
reconciled third form) becomes the "deterministic minimum execution package" OCID-041/042 are separately
tasked with defining. This document only records that both exist today, independently, and are not merged.

## 4. Sentinel

`ai-os/sentinel/SENTINEL.yaml` (v2.1.0) is a real, checked-in policy manifest, **not a running service**: it
defines the authorized-agents list, nine `validation_rules` (SE-001..003 security, AR-001..003 architecture,
AC-001..003 agent-conduct), and a `logging:` block pointing at `ai-os/sentinel/VIOLATIONS.yaml` and
`ai-os/sentinel/HEALTH.yaml`. Its own header states `CONSTITUTION.yaml` is authoritative on conflict; the same
rules are duplicated into `CONSTITUTION.yaml:591-605`.

Enforcement is partial and narrow: `.github/workflows/sentinel.yml` runs a non-blocking `gitleaks` scan
(`continue-on-error: true`) and a doc-existence check for `SENTINEL.md` only — it does **not** evaluate any
SE-*/AR-*/AC-* rule. `VIOLATIONS.yaml`/`HEALTH.yaml` are manually-updated spot-checks, self-described as
covering only a subset of `validation_rules`, and went stale for 11 days before a manual correction. No script
anywhere writes to these files automatically. **AGENTS.md Rule 2 ("All changes logged through SENTINEL") is
aspirational as literally written** — there is no mechanism logging every change to SENTINEL. What is real and
CI-wired is a narrower, separately-named descendant: `dispatch-completion-monitor.ts` and, more substantively,
the guardrail-manifest CI check (item 6 below).

## 5. Lock framework — cooperative vs. hard, a clean split

**Cooperative (discipline-only, self-documented as not technically enforced):**
- `ai-os/boss/ACTIVE-CLAIMS.yaml`'s claim-registration protocol (its own header: "NOT A SUBSTITUTE FOR GIT'S
  OWN SAFETY... prevents a DIFFERENT problem git can't solve" — duplicate work, not data loss).
- SEC-05's "Level-1-only" boundary for literal source commits (`CONSTITUTION.yaml:644`: "an ORGANIZATIONAL
  boundary... not a runtime AI-level check").
- SEC-07 itself (`CONSTITUTION.yaml:655-656`: "Organizational/process gate today, not a runtime-enforced
  check").
- SENTINEL.yaml's SE-*/AR-*/AC-* `validation_rules` (no automated evaluator exists, per §4 above).

**Hard / CI-DB-enforced (mechanically blocking, each honestly discloses its own narrower residual gap):**
- `scripts/check-guardrail-presence.mjs` — CI fails the build on marker removal; own header: "a
  reviewable-diff guarantee... not a runtime-unbypassable lock" (AGENTS.md Rule 9).
- `ddl_authorization_check.py`, wired into `task-gateway.py::cmd_start()` — SEC-06, blocks dispatch (residual
  gap: text-scan only, not MCP-tool-call interception).
- `scope-check.py` (in the separate `/opt/veridian/scripts` live-checkout repo) — deterministic file-glob
  ownership lock against `ai-os/file-ownership.yaml`, wired into `supervisor-entrypoint.sh` for
  module-queue-dispatched tasks carrying a `module_scope.yaml` sidecar; blocks merge regardless of tier or the
  2026-07-31 full-autonomy directive.
- `workerAgents.tier='global'` RLS policy — a genuine Postgres-level write exclusion (SEC-05's actual
  mechanism, though the broader "Level-1-only" rule around it is cooperative, not this specific policy).
- `.github/workflows/mandatory-audit-check.yml` (item 6 below) — CI-blocks merge pending an asserted
  `AUDIT: PASS/FAIL` comment.
- GitHub branch protection (AGENTS.md Rule 6) — `enforce_admins` on, no direct-push bypass; the substrate
  every mechanism above sits on top of.

## 6. Review pipeline

`.github/workflows/mandatory-audit-check.yml` triggers on `pull_request` (opened/synchronize/reopened) **and**
`issue_comment` (created) — the latter added specifically because posting the audit comment doesn't itself
re-trigger a `pull_request` event. It runs `scripts/validate-audit-verdict.ts`, which fetches PR comments,
finds the most recent `AUDIT: PASS`/`AUDIT: FAIL` line, and validates 8 labeled fields (Objective Understood,
Standards Reviewed, Scope Confirmed, Evidence Recorded, Severity Classified, Verdict, Corrective Action Owner,
Re-Audit Scheduled) via a shared `validateAuditProtocolFields()`. The workflow's own comment is explicit about
the limit: "this checks that the 8 fields are present, non-placeholder, and internally consistent — it cannot
verify the auditor actually ran tsc/lint/build, only that they asserted they did," and cannot verify *who*
posted the comment (no per-agent signed identity yet).

Trigger source: `model-tier-eligibility.ts::requiresMandatoryAudit()` returns true for every model except
judgment-tier `z-ai/glm-5.2`, per AGENTS.md Rule 10. Enforcement caveat, per the workflow's own comment: merge
is only actually blocked once this job's name is added to GitHub branch protection's required-checks list — a
repo access-control change left for the Owner to make; this is distinct from, and not confirmed live alongside,
the Lint/Type Check/Build/Unit Tests checks Rule 6 states are required.

## 7. PR pipeline

Branch protection (AGENTS.md Rule 6): `main` requires PR + CI (Lint/Type Check/Build/Unit Tests),
`enforce_admins` on, no bypass, no human PR-approval requirement. `.github/workflows/ci.yml` defines those four
named jobs plus seven additional gates (guardrail-presence, asset-registry-coverage, metadata-index-coverage,
terminology-guardrail-check, migration-collision-check, doc-quarantine-banner, doc-cross-references) and an
`e2e` job honestly flagged as empty ("zero E2E tests exist yet... `--pass-with-no-tests` stays here
deliberately").

Real `gh pr` usage lives in `claude-control/scripts/supervisor-entrypoint.sh`: `gh pr create`, a fallback
`gh pr list --head "$BRANCH"` with an explicit PR-URL-resolution guard block (built after a real incident where
an empty `$PR_URL` silently fell back to whatever branch was checked out and merged the wrong PR), `gh pr
comment`, `gh pr view --json headRefOid/mergeStateStatus/state/mergedAt/mergeCommit`, and `gh pr merge
"$PR_URL" --merge`.

## 8. Merge pipeline

Tier classification: `/opt/veridian/scripts/risk-tier.py` (deterministic, non-AI) — "tier1 = server-side
Superboss may merge autonomously. tier2 = Superboss may approve but must hold for human sign-off," called from
`supervisor-entrypoint.sh`.

Real end-to-end path: a Claude Sonnet review invocation writes `review-verdict.json`
(`{verdict, tier, summary, issues}`) → PR created/found → a structured `AUDIT: PASS/FAIL` comment posted before
the merge attempt (to avoid a real CI race documented against a prior incident) → optional `module_scope.yaml`
triggers `scope-check.py` (hard file-ownership violation regardless of AI verdict) → if `verdict == approve`
**and** scope is OK, polls `gh pr view --json mergeStateStatus` until unblocked, runs `gh pr merge --merge`,
**confirms via a separate fresh `gh pr view` call rather than trusting exit code** (per prior incidents), deletes
the remote branch, logs the merge, checkpoints the task `completed`.

Per AGENTS.md's Contact section (2026-07-31 Owner directive, "Full autonomy, no exceptions"), the prior
`HOLD_FOR_OWNER_SIGNOFF`/tier2 human-hold branch was removed from this same script
(`AUTONOMOUS-FULL-APPROVAL-2026-07-31` block) — an approved verdict + passing scope-check now takes the
identical autonomous merge path regardless of risk tier, with only a post-hoc informational Owner notification.
**A rejected verdict or a real scope-check violation still blocks unconditionally — explicitly unchanged by
that directive.**

---

## 9. Synthesis — the reusable end-to-end path already in place

Chaining §1–§8 together, the shape of an end-to-end task lifecycle VERIDIAN already runs today, for internal
dispatch, is:

`task-gateway.py::cmd_start` (contract/DDL/dup-key gate) → `veridian-task.py::cmd_create` (worktree, branch,
`task_id`, `prompt.txt`/`task.yaml`) → `resource_governor.submit()` (concurrency/headroom gate) →
`veridian-worker@<task_id>.service` / `worker-entrypoint.sh` (execution loop, checkpointing, budget cap) →
push branch → `veridian-supervisor@<task_id>.service` (review, `review-verdict.json`) → `gh pr create` →
`AUDIT: PASS/FAIL` comment (`mandatory-audit-check.yml` gate, for non-judgment-tier models) → `scope-check.py`
(file-ownership gate) → tier/verdict decision (`risk-tier.py`, now uniformly autonomous on approve+scope-ok
per the 2026-07-31 directive) → `gh pr merge` with a confirmed-not-assumed result → branch deletion → task
checkpoint `completed`.

A future OCID-043 runtime's own stated mission — "the runtime that actually selects a provider and dispatches
a task through the deterministic execution contract, reusing existing worker/dispatch/review/PR/merge/lock
components only" — maps onto this chain as follows, **without this document designing or wiring any of it**:
provider *selection* would need to extend the existing eligibility/fallback layer (§2:
`model-tier-eligibility.ts` + `orchestra-model-resolver.ts` + Mother Router) to cover genuinely external,
non-VERIDIAN-hosted processors, which none of those three currently do; the *dispatch* leg has a real internal
analogue (`task-gateway.py`/`veridian-task.py`/`resource_governor.py`) but no live external-process equivalent —
`ai-dispatch.yml`'s `repository_dispatch` listeners are a stub, not a working dispatcher; and the
review/PR/merge/lock legs (§5–§8) are already model-agnostic and would not need new mechanisms, only a real
external-execution *result* to feed into the existing `AUDIT: PASS/FAIL` → `scope-check.py` → merge chain.

## 10. Genuine gaps identified (honest, not exhaustive of OCID-041/042/044's own future scope)

1. **No live external-provider dispatcher exists.** `ai-dispatch.yml` only echoes event payloads; `claude-task`
   has never had a working job behind it (AGENTS.md's own words); `dispatch-repo.ts` explicitly states it has
   no live callers yet.
2. **Provider eligibility/fallback logic is internal-model-scoped, not external-provider-scoped.**
   `model-tier-eligibility.ts` and `orchestra-model-resolver.ts` gate/fall back among VERIDIAN's own configured
   model access, not among external AI providers acting as task executors.
3. **Two task-contract schemas exist and are not merged**: the enforced `REQUIRED_TASK_SECTIONS` prompt
   contract (real, live) and the `InstructionContract`/`ExecutionReport` pair (real code/tests/migration, not
   confirmed wired into the actual worker-execution path).
4. **SENTINEL logging is aspirational as literally stated in AGENTS.md Rule 2** — no automated writer exists for
   `VIOLATIONS.yaml`/`HEALTH.yaml`, and CI's `sentinel.yml` only checks for `SENTINEL.md`'s existence plus a
   non-blocking secret scan.
5. **`mandatory-audit-check.yml` verifies an audit verdict was asserted, not that it was rigorous**, and cannot
   verify who posted it (no per-agent signed identity) — same honest-limitation class already established for
   `check-guardrail-presence.mjs` and `ddl_authorization_check.py`.
6. **`scope-check.py`'s file-ownership lock is opt-in**, only engaged for module-queue-dispatched tasks
   carrying a `module_scope.yaml` sidecar — not a universal gate on every merge.
7. **OCID-041 and OCID-042 have no canonical discovery artifact yet** (confirmed via live `systemctl` check,
   §0) — the "deterministic minimum execution package"/context-packaging design those two OCIDs own is not yet
   defined anywhere this document could honestly cite.

---

## 11. Explicit non-completion statement

OCID-043 is **not** marked complete by this document. No worker runtime, dispatch runtime, or
`CONSTITUTION.yaml` functional change was made. No provider-selection or execution-dispatch code path was
wired. This document registers a real, independently-verified inventory only, per the SEC-07 lock recapped in
§0; the same fresh, explicit Owner override in chat that gates OCID-041/042/044/045/046 would be required
before OCID-043 may proceed past discovery.
