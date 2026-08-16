> **ARCHIVED / STALE — do not treat as current.** See docs/master/INDEX.md or ai-os/MASTER-TRACKER.yaml for current status.

# AUDIT_wave144.md

**Auditor:** Security & Code Reviewer (VERIDIAN AI Workforce)
**Scope:** Wave 144 (VERIDIAN.docx joint implementation plan, Phase 1)
**Files reviewed:** fde-service.ts, chat-service.ts, construction-prediction-service.ts, .github/pull_request_template.md
**Note:** schema.ts and migration SQL were NOT read from disk per instructions; excerpts provided in the task brief were used instead. This is a code-review-level audit only — I have no database access and cannot independently verify that the two migrations were applied live. Claude's PR description claims both were applied via Supabase MCP and verified with an information_schema query; **this claim is unverified by me.**

---

## Per-item assessment

| Item | Verdict | Reason |
|---|---|---|
| conversations columns (currentState, previousState, workflowId, status) | **CONCERN** | Schema + migration match, but no code path in any of the 4 reviewed files writes to currentState/previousState/workflowId. These are nullable dead columns for now — scaffolding only. `status` defaults to 'active' so existing rows are safe, but the other three have no writer. |
| fde_requests columns + reuseLevel/topCandidates logic | **PASS** | `recordFdeRequest()` writes `reuseLevel` (union: exact_match / llm_assisted_match / new_proposal — matches schema comment) and `topCandidates` (TopCandidate[] via `toTopCandidates()`) with `?? null` fallback. All three code branches set the correct reuseLevel. Types align with jsonb/text columns. |
| chat-service.ts prompt-content logging | **CONCERN** | `recordOrchestraExecution` now stores full `systemPrompt`, `userMessage`, and `reply` in input/output. The code comment explicitly acknowledges no redaction is applied. The table is RLS-protected (tenant-scoped), which mitigates cross-tenant exposure, but full prompt content (including org-specific purpose clauses and raw user text) is now persisted in plaintext. Defensible for explainability, but worth flagging as a future PII-redaction design task. No actual bug. |
| construction predictor confidence | **PASS** | `computeConfidence()` is deterministic, only attached on the final successful-return path (undefined in all early-return branches, which carry their own `reason`). No type mismatch. |
| PR template | **PASS** | Adds a mandatory capability-registry check checkbox gated to PRs that add new capabilities. Clean, no issues. |
| supervisorWorkerAgentId comment | **PASS** | Comment honestly documents the column as reserved/not-yet-implemented (0 of 27 rows set, no code path writes to it). Accurate and prevents false assumption of a working supervision feature. |

---

## SQL migration ↔ schema.ts match check

**Yes — exact match.**

| Column | Migration SQL | schema.ts excerpt | Match |
|---|---|---|---|
| current_state | `text` | `text('current_state')` | ✓ |
| previous_state | `text` | `text('previous_state')` | ✓ |
| workflow_id | `text` | `text('workflow_id')` | ✓ |
| status | `text NOT NULL DEFAULT 'active'` | `text('status').notNull().default('active')` | ✓ |
| top_candidates | `jsonb` | `jsonb('top_candidates')` | ✓ |
| reuse_level | `text` | `text('reuse_level')` | ✓ |

Column names, types, nullability, and defaults all align.

---

## Confidence threshold assessment (construction-prediction-service.ts)

**Yes — reasonable and defensible.**

- **High:** entryCount ≥ 8 AND daysSpanned ≥ 21 — ~3+ weeks of data across 8+ entries is a solid trend for a deterministic average-velocity projection.
- **Medium:** entryCount ≥ 4 AND daysSpanned ≥ 7 — one week / 4 entries is a minimum viable signal; correctly distinguished from high.
- **Low:** everything else — correctly conservative for thin data.

The thresholds are arbitrary by nature (no ML model here), but the values are sensible and the conservative default-to-low is the right call. No issue.

---

## Bug / type-mismatch check (4 files read)

**PASS — no bugs or type mismatches found.**

Specifics verified:
- `fde-service.ts`: `toTopCandidates()` rounds score to 2 decimals; `recordFdeRequest()` insert includes all new fields with correct null fallback. The `passive: true` short-circuit correctly prevents LLM calls / fde_requests rows on sub-threshold background evaluations.
- `chat-service.ts`: `generateAiReply()`'s `recordOrchestraExecution` call passes `systemPrompt`, `userMessage`, `historyTurnCount` in input and `reply`/`replyLength` in output — all typed correctly. The fire-and-forget `after()` block correctly wraps `submitFdeRequest` in try/catch with `{ passive: true }`.
- `construction-prediction-service.ts`: `computeConfidence` receives `entries.length` (number) and `daysSpanned` (number from `Math.round`) — types correct. `Math.max(1, ...)` prevents division-by-zero on `dailyVelocity`.
- No injection vectors: all user text flows through `enforcePolicy()` before reaching any LLM call in both fde-service and chat-service. No raw SQL string concatenation.

---

## Auth / RBAC check

No new API routes are added in this change set — all modifications are service-layer. Existing auth guards are intact:
- `fde-service.ts`: `enforcePolicy()` runs before embedding search; `hasRole(ctx.dbUser, "admin")` gates tier escalation.
- `chat-service.ts`: `enforcePolicy()` gates `generateAiReply()`; `assertParticipant()` enforces conversation membership on every message route.
- No new route lacks a `requireAuth()`/RBAC check because no new routes exist.

---

## Overall verdict

**APPROVE WITH NOTES**

The code is correct, types align, migrations match schema, and no security vulnerabilities (injection, broken auth, IDOR, XSS) are present in the reviewed files. The two CONCERNs are design-level observations, not defects:
1. Three conversations columns (currentState/previousState/workflowId) are added but have no writer yet — acceptable as Phase 1 scaffolding, but should be tracked so they don't become permanent dead schema.
2. Full prompt-content logging in orchestra_executions is intentional and RLS-protected, but a future PII-redaction pass should be planned.

The unverified migration-application claim (Supabase MCP) should be confirmed by someone with database access before merge, but that is outside this code-review audit's scope.
