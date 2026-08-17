# VERIDIAN Universal External Execution Foundation — Discovery v1.0

**UMR:** `UMR-20260803-084109-6875` (OCID-041, real registration UMR — merged to `main` in commit
`8cdbe5ea`/PR #793, ~17 minutes before this task dispatched), parented to `UMR-20260802-173631-ca85`
(OCID-021, the ERP Functional Completeness Master Program). Citing the OCID-022 through OCID-040 chain
and `SEC-07` (`ai-os/CONSTITUTION.yaml:652-657`). This document is the real, dispatched discovery
deliverable OCID-041's own registration amendment (`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`, section
"Amendment (2026-08-03): OCID-041 through OCID-046 registered") explicitly stated had **not** yet been
produced ("No worker has yet been dispatched for OCID-041 as of this amendment"). No new UMR is minted
here — this document is authored under OCID-041's own already-real UMR, not a fresh registration.

**What this is:** discovery only. A real inventory of the requirements stated in the Owner directive for
OCID-041, a real mapping of each requirement to existing, already-built VERIDIAN components (file:line
cited, verified by direct read, not narrated), and a real, honest gap analysis distinguishing genuine
gaps from reuse opportunities.

**What this is not:** not implementation, not a new architecture, not a new table/worker/storage/review
mechanism, not a wired external-provider execution path, not a completion certification. `CONSTITUTION.yaml`
and worker/server runtime are unmodified by this document. OCID-041 is **not** marked complete.

**Lock status, independently re-confirmed before writing this document (not assumed from a label):**
`SEC-07` (`ai-os/CONSTITUTION.yaml:652-657`) locks real implementation, gap closure, production changes,
and certification under the ERP Functional Completeness Master Program — specifically OCID-038/039/040 —
until `UMR-20260802-165606-4413` (OCID-020) independently clears. `ai-os/VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md`
confirms OCID-020 is still open as of this same day. OCID-041 sits downstream of, and explicitly cites,
that same chain, so the same lock discipline applies here: discovery/documentation only, no real
implementation, no fresh Owner override in chat has been given for this cycle.

---

## 1. Requirements inventory

Decomposed, without paraphrase-drift, from the Owner directive's own mission statement for OCID-041:

| # | Requirement (verbatim intent) |
|---|---|
| R1 | Approved external AI providers (ChatGPT, Z.ai/GLM, DeepSeek, Gemini) act **only** as interchangeable execution processors |
| R2 | Providers execute against a **minimum deterministic execution package** prepared by VERIDIAN |
| R3–R10 | VERIDIAN remains the sole **system of record**, **metadata authority**, **task authority**, **workflow authority**, **security authority**, **audit authority**, **review authority**, and **governance authority** |
| R11–R19 | Every execution fully traceable through existing **UMR**, **UTM**, **worker**, **review**, **PR**, **commit**, **merge**, **lock**, and **audit** identifiers |
| R20 | Uses **existing VERIDIAN components only** |
| R21–R28 | Creates **no** new provider-specific architecture, tables, metadata, tasks, workers, storage, review mechanism, or duplicate business logic |

## 2. Requirement → existing component mapping

Each row cites the real, currently-live mechanism a future (still-locked) implementation would need to
reuse. Verified by direct file/line read this same cycle, not inferred from a prior document's summary.

### R1 — interchangeable execution processors

- **Partial reuse exists, but not on the real dispatch path.** `src/lib/ai-team/roster.ts:118-148`
  already assigns concrete model strings per role via OpenRouter, including `z-ai/glm-5.2`,
  `google/gemini-2.5-pro`, and `deepseek/deepseek-v4-pro` — the three of the four named providers besides
  ChatGPT/OpenAI already have a live identifier in this codebase today. `src/lib/llm-client.ts:32`
  defines a provider union type (`"groq"|"openai"|"anthropic"|"google"|"openrouter"|"cerebras"`) — a
  real, if partial, provider-abstraction type already exists.
- **The real gap**: the actual task-dispatch path used for every dispatched task in this repo —
  `ai-os/scripts/task-gateway.py::cmd_start` → systemd `veridian-worker@.service` →
  `worker-entrypoint.sh:193` (`claude -p "$PROMPT" --model sonnet ... --dangerously-skip-permissions`) —
  is hardcoded to the Claude Code CLI with zero provider abstraction. The one path where multi-provider
  routing already exists (`ai-team-workforce.yml` → `scripts/ai-workforce-agent.mjs:371`, hitting
  OpenRouter) is explicitly documented as having **no live callers** (`dispatch-repo.ts:8-10`,
  `GITHUB_DISPATCH_PAT` unset on Vercel). So "interchangeable execution processor" is a real, wired
  concept for the *advisory, unused* AI-Team surface, and not present at all on the *real, used* worker
  surface.

### R2 — minimum deterministic execution package

- **Closest existing analog**: the `InstructionContract`/`ExecutionReport` pair
  (`src/lib/services/task-register-service.ts`, reached from `POST /api/ai/team/dispatch`) is the one
  place in this codebase with a bounded, structured request/result contract rather than free text.
  `context-assembly.ts`'s `AssembledContext` (cited in `VERIDIAN_UNIVERSAL_CONTEXT_AND_PREDICTIVE_RUNTIME_2026-08-03.md`)
  is the closest existing context-packaging analog.
- **The real gap**: the real dispatch path passes a single raw prompt string
  (`worker-entrypoint.sh:193`, `"$PROMPT"`) with no structured, provider-agnostic "minimum deterministic
  execution package" schema. No such schema exists today at the worker layer.

### R3–R10 — VERIDIAN as sole authority (record / metadata / task / workflow / security / audit / review / governance)

This is a **genuine reuse opportunity, not a gap** — the operative discipline already in place treats
software/governance artifacts, not any AI model, as authoritative:

- System of record / metadata: `umr_tasks` (sqlite, `superboss-register.py`), `activity_log`
  (`ai-os/CONSTITUTION.yaml:662-684`, UMR-01 ENFORCED).
- Task authority: `task.yaml` per task dir, `veridian-task.py`, `task-gateway.py::cmd_start/cmd_close`.
- Workflow authority: `src/lib/task-execution-engine.ts::executeTask()`, reached only through
  `createTask()` (`task-service.ts:133-188`) — "one identifier, one execution path" already the stated
  principle (`VERIDIAN_UNIVERSAL_SOFTWARE_EXECUTION_ENGINE_2026-08-03.md` §1).
- Security authority: `src/lib/policy-enforcement-engine.ts::enforcePolicy()`, `scripts/check-guardrail-presence.mjs`'s
  manifest (~45 named guardrails, AGENTS.md Rule 9).
- Audit authority: `src/lib/audit.ts::logActivity()`, run inside `withTenantContext` so write+audit
  commit/rollback together.
- Review authority: `.github/workflows/mandatory-audit-check.yml` + `scripts/validate-audit-verdict.ts`'s
  8-field `AuditProtocolFields` contract (AGENTS.md Rule 10).
- Governance authority: `ai-os/CONSTITUTION.yaml`, `AGENTS.md`.

An external provider acting only as an execution processor **behind** these existing gates is
architecturally consistent with the codebase's own already-enforced principle ("engines compute, AI never
invents a number"; "AI never executes software responsibilities" —
`VERIDIAN_UNIVERSAL_SOFTWARE_EXECUTION_ENGINE_2026-08-03.md` §1.4). No new authority mechanism is implied
by R3–R10; the existing ones already assume the executor is not authoritative.

### R11–R19 — traceability through UMR/UTM/worker/review/PR/commit/merge/lock/audit identifiers

- **Real, DB-backed generator**: `_new_id(prefix)` (`superboss-register.py:101-104`, UTC timestamp +
  `secrets.token_hex(2)`), `upsert_umr_task()` (`:2986-3017`) inserting into real `umr_tasks`. UTM's 5
  fields defined `:43-48`, computed by `_derive_umr_utm_fields()` (`:2787`) — a real function, not a
  narrative convention.
- **Real, if fragmented, chain**: `task.yaml`'s `checkpoints[]` (each with real `recent_commits[]`
  hashes/PR-merge messages), `.task.lock` (existence-only flock marker), and
  `task-gateway.py::check_branch_merged_to_master()` (`:571-618`, real `gh pr list` lookup) together
  reconstruct UMR → task_id → branch → PR → commit → merge.
- **The real, named gap**: no single row today joins UMR + task_id + branch + PR + commit + merge +
  audit_id — it is reconstructed by joining three independent stores (`task.yaml`, `superboss-register.py`'s
  sqlite `work_items`, and `umr_tasks`). `.task.lock` is existence-only (0 bytes) — it does not itself
  carry any of these identifiers. A future implementation reusing these primitives would need to *join*
  them, not replace them, and should flag (not silently fix) the fragmentation as a pre-existing condition
  unrelated to external execution specifically.

### R20 — existing components only / R21–R28 — no new provider architecture, tables, storage, duplicate logic

Real, already-existing extension points a future (still-locked) implementation would reuse without new
tables or mechanisms:

- `ai_routing_policies` / `ai_routing_audit_log` (`src/lib/ai-router/mother-router.ts`) — already a
  DB-backed model/provider policy + audit store. No new table needed for provider policy or provider
  audit.
- `src/lib/model-tier-eligibility.ts`'s `JUDGMENT_ELIGIBLE` set (`:28-30`, currently `{"z-ai/glm-5.2"}`
  only) and `requiresMandatoryAudit()` (`:71-73`) — already the real eligibility gate AGENTS.md Rule 10
  requires. Extending eligibility to a new approved external provider is adding an entry to an existing
  set, not building a new gate.
- `scripts/check-guardrail-presence.mjs`'s `REQUIRED_MARKERS` (~45 entries) — already an extensible
  guardrail-presence mechanism; adding external-execution-specific markers is extending coverage
  (explicitly permitted, AGENTS.md Rule 9), not new architecture.
- `.github/workflows/mandatory-audit-check.yml` + `validate-audit-verdict.ts` — already the real
  review-authority mechanism; a future external-provider execution path would post through the same
  `AUDIT: PASS`/`AUDIT: FAIL` contract, not a parallel one.

## 3. Gap analysis — honest, not padded

**Genuine gaps** (would need real, still-locked implementation work, not merely wiring):

1. **GAP-041-1**: Zero provider abstraction on the real, used worker-dispatch path
   (`task-gateway.py`/`worker-entrypoint.sh`) — hardcoded to Claude Code CLI. The only place
   multi-provider routing exists (`roster.ts`, `llm-client.ts`, `mother-router.ts`) is disconnected from
   it; `mother-router.ts` itself documents 35 direct-caller bypass sites.
2. **GAP-041-2**: No structured, provider-agnostic "minimum deterministic execution package" schema at
   the worker layer — real dispatch today is a single raw prompt string.
3. **GAP-041-3**: Traceability chain (UMR → task → branch → PR → commit → merge → audit) is real but
   fragmented across three independent stores with no single joined record; `.task.lock` carries no
   identifiers, existence-only.
4. **GAP-041-4**: The one dispatch surface with real multi-provider routing (`ai-team-workforce.yml` /
   `ai-workforce-agent.mjs`) has no live callers in production — the provider-agnostic scaffolding that
   does exist is not currently exercised.
5. **GAP-041-5**: `mandatory-audit-check.yml`'s own header states it is not yet added to branch
   protection's required status checks — the review-authority gate this design would depend on for
   judgment-tier work is not fully enforced end-to-end today, independent of any external-provider
   question.

**Reuse opportunities** (no new architecture required if/when this work is ever unlocked): UMR/UTM
generator, `ai_routing_policies`/`ai_routing_audit_log`, `model-tier-eligibility.ts`'s tier gate,
`InstructionContract`/`ExecutionReport`, `audit.ts::logActivity()` + the `AUDIT: PASS`/`FAIL` protocol,
the guardrail-presence manifest, and the existing (if fragmented) `task.yaml`/`.task.lock`/
`check_branch_merged_to_master()` traceability primitives — all cited above, all real, none requiring a
new table, worker, or storage mechanism to extend.

## 4. Explicit non-actions this cycle

Per SEC-07 and this task's own SPEC: no change to `worker-entrypoint.sh`, `task-gateway.py`,
`mother-router.ts`, `roster.ts`, `model-tier-eligibility.ts`, `ai_routing_policies` schema, or
`CONSTITUTION.yaml`. No external provider execution path wired. OCID-041 is not marked complete. Next
real step, per the existing sequential gate already recorded in the OCID-041 registration amendment: a
fresh, explicit Owner override in chat, only after OCID-020 clears and OCID-038 → OCID-039 → OCID-040
complete in that order.

## 5. Amends, does not duplicate

This document amends the existing UMR chain and canonical artifact index (`ai-os/OS.yaml`,
`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`) — it does not start a new chain, and does not re-litigate the
lock/sequencing decision already recorded in the OCID-041 through OCID-046 registration amendment.
