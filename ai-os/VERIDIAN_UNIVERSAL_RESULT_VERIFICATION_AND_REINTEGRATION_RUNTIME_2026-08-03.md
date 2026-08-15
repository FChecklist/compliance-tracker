# VERIDIAN Universal Result Verification and Reintegration Runtime v1.0 (Discovery)

**UMR:** `UMR-20260803-084547-22fd` (OCID-044), parented to OCID-043 (`UMR-20260803-084429-7a70`, itself
registered this same cycle, discovery-only), which chains back through OCID-042
(`UMR-20260803-084332-5b52`) and OCID-041 (`UMR-20260803-084109-6875`) to `UMR-20260802-173631-ca85`
(OCID-021, the ERP Functional Completeness Master Program), OCID-020 (`UMR-20260802-165606-4413`), and
`SEC-07` (`ai-os/CONSTITUTION.yaml`). Amends the existing UMR chain, the existing
`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` registration amendment (2026-08-03), and the existing
canonical artifact index (`ai-os/OS.yaml`); does not start a new chain.

**What this is, and is not:** the still-undone substantive discovery artifact for OCID-044, which the
2026-08-03 registration amendment in `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` explicitly named as
outstanding ("zero canonical artifact produced... for any of the four" — OCID-041 through OCID-044). This
document performs a real, evidence-based inventory of the existing VERIDIAN review, audit, PR, commit,
merge, lock, and knowledge-registry infrastructure a future universal result-verification-and-reintegration
runtime would need to reuse, and maps that inventory against OCID-044's stated mission. It does **not**
implement anything: no review-runtime change, no audit-runtime change, no `CONSTITUTION.yaml` change, no
result-verification or reintegration code path is wired this cycle. Per `SEC-07`, real implementation stays
locked until OCID-020 independently clears, followed by OCID-038 → OCID-039 → OCID-040 in that order — this
document is discovery/matrix-building, which `SEC-07` explicitly permits to continue.

**Real, honest dependency note (from OCID-044's own directive, not softened here):** OCID-044 cites
results from OCID-041, OCID-042, and OCID-043 that do not yet exist — all three were registered this exact
same cycle, minutes before this document, and none has a dedicated canonical discovery artifact yet (only
the shared registration-amendment paragraph in `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`). This document
does not fabricate or pre-empt that missing work. Where this inventory would materially benefit from
OCID-041's execution-package format, OCID-042's context-packaging runtime, or OCID-043's provider-dispatch
contract, this document says so explicitly (see section 5) rather than guessing at their shape.

---

## 0. Mandatory discovery — real inventory, independently verified before writing

Every claim below was checked against live repo content (this repo and `/opt/veridian/scripts`, a separate
live-checkout repo) before this document was written, not assumed from file/function names.

### 0.1 Review engine

- `/opt/veridian/scripts/supervisor-entrypoint.sh` — the real, server-side review mechanism. Reviews a
  task's branch "for real (not a self-report)," classifies risk tier (`tier1`/`tier2`), decides
  `approve`/`reject` (`VERDICT`), and gates merge on `SCOPE_OK` from `scope-check.py`.
- `.github/workflows/mandatory-audit-check.yml` — CI-required check on every PR into `main`, requiring a
  structured audit-verdict comment (see 0.2).
- `src/app/api/ai/team/review/route.ts` + `src/lib/services/agent-review-service.ts` — a separate,
  in-product AI-team review/escalation surface (reuses `nextEscalationRung()`), distinct from Superboss.
- No dedicated Claude Code review-subagent config exists (`.claude/` has no `*review*` agent file); review
  logic lives in the supervisor shell script and the CI workflow, not an in-repo agent definition.

### 0.2 Audit engine

- `src/lib/audit-protocol.ts` — `AuditProtocolFields` (8-field Before/During/After schema) and
  `validateAuditProtocolFields()`, a deterministic validator with no LLM call.
- `scripts/validate-audit-verdict.ts` — the real CI-gate caller (since 2026-07-13): parses a PR's latest
  `AUDIT: PASS`/`AUDIT: FAIL` comment (AGENTS.md Rule 10), extracts the 8 labeled fields, validates them,
  and best-effort persists to `compliance.audit_protocol_findings` (non-fatal if `DATABASE_URL` unset).
- `src/lib/audit.ts::logActivity()` — the one general-purpose audit-trail writer (13+ call sites), inserts
  into `auditLogs` inside the same tenant transaction as the entity write it accompanies.
- `src/lib/audit-event-triggers.ts` — wires 9 of 10 named audit-trigger events (`feature_completed`,
  `report_generated`, `knowledge_updated`, deployment via the Vercel webhook route, etc.) into
  `logActivity()`; its own header explicitly rejects a synchronous LLM call per event in favor of
  record-then-route to a named `roster.ts` auditor role.
- `ai-os/sentinel/SENTINEL.yaml` / `.github/workflows/sentinel.yml` — a separate, thinner logging mechanism
  (AGENTS.md Rule 2: "all changes logged through SENTINEL").
- Honest, self-disclosed limitation (from `mandatory-audit-check.yml`'s own header, same class this
  document holds itself to): it verifies an audit verdict was *asserted*, not that the auditor actually ran
  the checks it claims — the same honesty standard `check-guardrail-presence.mjs` applies to guardrails.

### 0.3 PR lifecycle

- `src/lib/ai-team/dispatch-repo.ts::dispatchRepoTask()` — fires `ai-team-task` `repository_dispatch`,
  gated by role checks, `validateTightTask()`, and a `platform.dispatch_outcomes` row per attempt.
  Honestly scoped: its completion signal is "event fired," not "PR landed."
- `.github/workflows/ai-team-workforce.yml` (driven by `scripts/ai-workforce-agent.mjs`) — the workflow
  that actually opens the branch/commit/PR.
- AGENTS.md Rule 6 — branch protection on `main`, `enforce_admins` on, CI-green required (Lint/Type
  Check/Build/Unit Tests) via PR; no direct pushes, even from a full-access PAT.
- `.github/workflows/ci.yml` — `lint`, `typecheck`, `build`, `unit-tests`, `guardrail-presence`,
  `asset-registry-coverage`, `metadata-index-coverage`, `terminology-guardrail-check`,
  `migration-collision-check`, `doc-quarantine-banner`, `doc-cross-references`.

### 0.4 Commit lifecycle

- `.github/workflows/ai-team-workforce.yml` (lines ~113-127) is the concrete AI-Workforce convention:
  `git config user.name "veridian-ai-workforce[bot]"`, `git add -A`,
  `git commit -m "AI Workforce (${ROLE_KEY}): ${SUMMARY}"`.
- No `Co-Authored-By` tagging convention exists in AGENTS.md, `.git/hooks`, or anywhere repo-wide for that
  workflow path (this document's own commit does carry one, per this session's own harness convention —
  the two conventions coexist, are not in conflict, and are not unified by any single spec).
- No commit-message linter/hook exists (`.git/hooks` has only samples; no commitlint config).
- Branch names follow `ai-team/<role>/<timestamp>`. Scope checking of changed files is syntactic only —
  `task-tightening.ts::checkFilesWithinDeclaredScope()`, surfaced as `SCOPE_VIOLATIONS` in the PR body,
  explicitly self-documented as "not a semantic guarantee."

### 0.5 Merge lifecycle

The most concretely wired category. `/opt/veridian/scripts/supervisor-entrypoint.sh`:
- `scope-check.py "$WORKSPACE" "origin/$DEFAULT_BRANCH" "$MODULE" "$FILES_ALLOWED"` — deterministic
  file-ownership enforcement, blocks regardless of tier.
- The `AUTONOMOUS-FULL-APPROVAL-2026-07-31` block (AGENTS.md Contact section, Rule 12 in effect): per the
  Owner's "full autonomy, no exceptions" directive, `HOLD_FOR_OWNER_SIGNOFF`/`tier2` human-confirmation
  branches were removed — any `VERDICT=approve` + `SCOPE_OK=1` task now takes the same autonomous
  `gh pr merge "$PR_URL" --merge` path `tier1` always used, then independently re-confirms merge via a
  **fresh** `gh pr view --json state,mergedAt` call (never trusting a shell exit code, per a documented
  real past incident with PRs #10/#13/#14), deletes the branch, logs to `superboss-register.py log-action`,
  and sends an informational-only Owner notification for formerly-held tasks.
- `SEC-06` in `ai-os/CONSTITUTION.yaml` documents a separate, DDL-specific merge gate
  (`ddl_authorization_check.py`) as a precedent for a narrow-purpose pre-merge check layered on top of the
  general merge lifecycle.

### 0.6 Lock framework

- `src/lib/guardrail-engine.ts` — `registerGuardrail()`/`evaluateGuardrails()`, opt-in, empty-by-default
  registry keyed by capability-tree leaf, 4 phases (input/process/output/logic).
- `src/lib/business-rule-validator.ts::assertBusinessRulesBeforeExecution()` — pre-execution wrapper over
  `evaluateGuardrails()` for VCEL dispatch.
- `src/lib/policy-enforcement-engine.ts::enforcePolicy()` — deterministic keyword/pattern pre-call gate for
  personal-use and prompt-injection categories, independent of the guardrail-engine registry.
- `scripts/check-guardrail-presence.mjs` — CI job enforcing a manifest of `mustContain` markers; explicitly
  self-documented as "a deterministic text-presence check, not a runtime-unbypassable lock."
- `ai-os/CONSTITUTION.yaml` `SEC-07` — the real, current lock this whole OCID-041..046 chain sits behind
  (`UMR-20260802-165606-4413`, OCID-020); formally retires the phrase "OCID-021 implementation lock" as a
  label with no real underlying artifact.
- `ai-os/file-ownership.yaml` + `scope-check.py` — the closest real worktree/file-ownership lock mechanism.
- `ai-os/boss/ACTIVE-CLAIMS.yaml` (AGENTS.md Rule 11) — a cooperative, non-technical claim registry
  preventing duplicate concurrent work; this document's own task registered a claim there before this
  document was written.

### 0.7 Knowledge registry

- `ai-os/MASTER_INDEX.yaml` — hand-maintained browsable narrative index; self-declares as one of 4
  complementary layers, not sole authority: "if a match exists, use it or extend it — do not create a
  parallel mechanism."
- `/opt/veridian/scripts/superboss-register.py` / `superboss-register.sqlite` — real tables `system_index`
  (+FTS5), `knowledge_engine` (+FTS5), `capability_registry` (+FTS5), `wiring_registry` (7,783+ rows, the
  largest real inventory of engines/gateways/tables/functions/routes/files), plus `instructions`,
  `work_items`, `actions`, `log_index`, `execution_log`, `known_fixes`.
- `/opt/veridian/scripts/credit-accountant.py::cmd_propose()` → `check_existing_capability()` — forces a
  search-before-spend check for new AI-spend proposals; a real, working "search before creating" gate, but
  scoped to LLM-spend planning, not to result reintegration.
- `src/lib/services/capability-registry-service.ts` — the closest real generic "reintegrate, don't
  duplicate" mechanism: `findSimilarCapabilities()`, `findSimilarPromptPatterns()`,
  `findSimilarPromptVersions()`, `findSimilarDynamicChains()`, `auditDuplicateCapabilities(orgId,
  threshold=0.92)`.
- `src/lib/services/report-catalog-service.ts` — data-only catalog of 26+ real report entries, each
  cross-checked against its real underlying service/route before listing.
- `src/lib/services/prompt-os-service.ts` + `src/lib/prompt-os-resolver.ts` — the Prompt OS layer
  (`prompt_templates`/`prompt_versions`, Draft → Review → Staging → Production → Deprecated), indexed into
  `capability-registry-service.ts`'s dedup functions above.
- `ai-os/DATABASE_CATALOG.json` / `ai-os/FUNCTION_CATALOG.json` — mechanical, auto-generated ground-truth
  catalogs (~1.4–1.5MB each) reused across compliance-tracker/projexa/veda-advisors.

### 0.8 The one mechanism that already touches genuinely external AI output

- `/opt/veridian/scripts/external_ai_state_machine.py` — chunked-text ingestion/resume with
  hash-versioning for external-AI content. Validates **storage integrity only** (has this chunk already
  been ingested, in what order), not review/audit passage. Writes to an isolated sandbox, never to
  production.
- `chatgpt_audit_guard.py` / `chatgpt_promptlib_guard.py` — sandbox external-AI-produced files under
  `/opt/veridian/chatgpt-audit` and a 15-subfolder prompt-library sandbox. **No promotion path out of the
  sandbox into production** is coded or documented. Per their own docstrings, no real content has ever
  populated them (no `OPENAI_API_KEY` configured on this server as of this discovery pass).

---

## 1. Mapping OCID-044's mission against the real inventory

OCID-044's mission has two distinct halves. Mapping each against section 0:

### 1.1 "No external AI result enters VERIDIAN directly; every result passes existing review and audit before becoming part of the platform"

| Needed capability | Real existing component | Status |
|---|---|---|
| Structured, machine-checkable verdict format | `audit-protocol.ts` (`AuditProtocolFields`, `validateAuditProtocolFields()`) | **Real, reusable as-is** |
| CI-enforced gate requiring that verdict before merge | `mandatory-audit-check.yml` + `validate-audit-verdict.ts` | **Real, reusable as-is** |
| Deterministic risk classification + approve/reject decision | `supervisor-entrypoint.sh` (tier1/tier2, `VERDICT`) | **Real, reusable as-is** |
| File-ownership / scope enforcement independent of tier | `scope-check.py` | **Real, reusable as-is** |
| Autonomous merge only after a real, re-confirmed approve verdict | `AUTONOMOUS-FULL-APPROVAL-2026-07-31` block | **Real, reusable as-is** |
| An entry point for a genuinely *external* AI's result to reach that same pipeline | — | **Gap.** `external_ai_state_machine.py` and the two `chatgpt_*_guard.py` scripts sandbox external content but do not route it into `mandatory-audit-check.yml`/`supervisor-entrypoint.sh`. This is the real, honest gap this half of OCID-044 must close in implementation, not something already solved and merely undocumented. |

### 1.2 "Every verified result updates existing UMR, UTM, knowledge, function, report, analysis, and prompt libraries rather than creating parallel ones"

| Needed capability | Real existing component | Status |
|---|---|---|
| Dedup/similarity search against existing capabilities | `capability-registry-service.ts::findSimilarCapabilities()` | **Real, reusable as-is** |
| Dedup/similarity search against existing prompts | `findSimilarPromptPatterns()`, `findSimilarPromptVersions()` | **Real, reusable as-is** |
| Dedup/similarity search against dynamic chains | `findSimilarDynamicChains()` | **Real, reusable as-is** |
| Duplicate-capability audit | `auditDuplicateCapabilities(orgId, threshold=0.92)` | **Real, reusable as-is** |
| Pre-spend search-before-create gate | `credit-accountant.py check_existing_capability()` | **Real, reusable as-is (scoped to spend planning)** |
| Full-text search across engines/tables/functions/routes | `superboss-register.py check-duplicate` (`system_index`, `wiring_registry`) | **Real, reusable as-is** |
| Report-library dedup | `report-catalog-service.ts` (data-only, no speculative entries) | **Real, reusable as-is** |
| A single step that runs *after* a review+audit PASS and *before* insert, choosing "update matched record" vs. "insert new," across all seven named library types (UMR/UTM/knowledge/function/report/analysis/prompt) in one pass | — | **Gap.** Each dedup mechanism above is real but scoped to its own artifact type and invoked independently by its own callers; none is sequenced as a post-audit reintegration step, and no single UMR/UTM library-level dedup mechanism was found (UMR/UTM are governance-doc/task-log conventions, not indexed tables with a similarity search). |

---

## 2. Cross-cutting gap, stated once and not softened

Every individual primitive OCID-044 would need already exists and is real, tested, production code: a
structured audit-verdict schema and CI gate, a deterministic autonomous-merge decision engine, a general
audit trail, an opt-in guardrail/policy framework, and genuine similarity/dedup search across capabilities,
prompts, and dynamic chains. What does **not** exist is a single pipeline that chains them for AI-produced
results generally, and for genuinely external AI results specifically:

1. Receive an external AI's result (today: dead-ends in a sandbox with no promotion path).
2. Route it through the *same* review+audit-verdict gate internal AI-Workforce dispatches already use.
3. On PASS, run it through the *same* dedup/similarity checks against `capability_registry`,
   `knowledge_engine`, `report-catalog-service.ts`, and the Prompt OS.
4. Update the matched existing record rather than insert a new one — or, if no match, insert exactly once,
   traceably, into the correct existing library.

This is the real gap. It is not "nothing exists" — every piece independently verified above is real and in
production use for its own narrow call site. It is that nothing today *sequences* them into one universal
verify-then-reintegrate runtime, and the one mechanism aimed specifically at external-AI content
(`chatgpt_audit_guard.py`/`chatgpt_promptlib_guard.py`) stops at the sandbox boundary rather than
graduating into `superboss-register.sqlite`, `MASTER_INDEX.yaml`, or the production dedup services above.

---

## 3. What this document does not do

- Does not design the actual verify-then-reintegrate pipeline (sequencing, error handling, retry/backoff,
  who owns the "insert vs. update" decision) — that is implementation-scale work, locked under `SEC-07`
  until OCID-020 clears.
- Does not modify `mandatory-audit-check.yml`, `supervisor-entrypoint.sh`, `capability-registry-service.ts`,
  or any of the sandbox scripts.
- Does not certify OCID-041, OCID-042, or OCID-043 as complete — none has landed a canonical artifact as of
  this writing; this document's section 0 inventory stands independently of theirs and should be
  cross-checked against them once they exist, not assumed to already incorporate their findings.
- Does not mark OCID-044 complete.

---

## 4. Note for the Owner (carried forward from OCID-044's own directive, not duplicated verbatim)

The 2026-08-03 registration amendment in `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` already surfaced this
suggestion once; this document reconfirms it now that the real substantive discovery (section 0-2 above)
backs it up rather than a mission-statement-only registration: OCID-041 through OCID-044 form one real,
four-stage chain, and all four gate on the same OCID-020 → OCID-038 → OCID-039 → OCID-040 sequence. A
single consolidated unlock instruction for the whole external-execution chain, once that sequence clears,
would avoid deciding each of the four stages separately — and, per this document's own section 2 finding,
would let implementation start from a real head start: nearly every primitive the chain needs already
exists in production; what is missing is the external-AI entry point and the cross-library reintegration
sequencing step, not the underlying review/audit/dedup machinery itself.

---

## 5. Readiness for OCID-041/042/043's own discovery

Whoever dispatches OCID-041, OCID-042, or OCID-043 next should treat this document's section 0 as a
starting inventory for the review/audit/PR/commit/merge/lock/knowledge-registry components those three
stages will also need to reuse (execution-package format, context-packaging runtime, and provider-dispatch
contract respectively sit upstream of the same merge/audit/knowledge-registry infrastructure this document
maps), rather than re-deriving it. Conversely, once OCID-041's execution-package format and OCID-043's
provider-dispatch contract exist, this document's section 1.1 gap ("no entry point for external AI results
into the review+audit pipeline") should be re-examined against their real shape — a provider-dispatch
contract that already emits a structured result object may make that entry point substantially smaller
than a from-scratch design would suggest. This document does not assume that outcome; it names it as the
first thing OCID-041/042/043's own discovery should check when it lands.

---

## Canonical artifact and UMR chain

**Canonical artifact created (exactly one, as required):** this file,
`ai-os/VERIDIAN_UNIVERSAL_RESULT_VERIFICATION_AND_REINTEGRATION_RUNTIME_2026-08-03.md`.

**UMR chain:** amends the existing chain rooted at `UMR-20260802-173631-ca85` (OCID-021) and the
OCID-041/042/043 registration citing `UMR-20260803-084429-7a70` (OCID-043); registered under
`UMR-20260803-084547-22fd` (OCID-044). No new UMR chain was started.

**Index registration:** this file is registered in `ai-os/OS.yaml`'s document index so it is discoverable
via the same query-before-building discipline this document itself relies on in section 0.7.

**Status:** discovery only. Not implementation. Not a certification of OCID-041, OCID-042, OCID-043, or the
OCID-020 → OCID-040 unlock sequence. OCID-044 is **not** marked complete.
