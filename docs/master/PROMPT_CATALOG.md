# VERIDIAN AI OS — Prompt Catalog

VERIDIAN Review Framework gap closure (task-20260801-173750, AI-Readable
Prompt Documentation, [Medium], 2026-08-01). Gap was "prompt documentation
incomplete." Investigation found the underlying DB/service layer is real
(`compliance.prompt_versions`/`promptTemplates`, `prompt-os-service.ts`'s
`resolvePromptTemplate()`, 26 real template keys actually called from
production code) but had no human/AI-readable index anywhere — this doc is
that index. It does **not** attempt to build the separate "Prompt Directory"
UI feature described below (out of scope for a documentation task).

## What already exists (real, live code)

- **Schema**: `compliance.promptTemplates` / `compliance.promptVersions`
  (`src/lib/db/schema.ts:2198-2235`) — each version has `content`, `label`
  (`production`/`staging`), semver (`major`/`minor`/`patch`),
  `lifecycleState` (Draft → Review → Staging → Production → Deprecated),
  `metadata: jsonb` (shape defined by
  [`ai-os/PROMPT_METADATA_SCHEMA_2026-07-25.schema.json`](../../ai-os/PROMPT_METADATA_SCHEMA_2026-07-25.schema.json),
  18 categories), `rolledBackFromVersionId`, `approvedById`/`approvedAt`.
- **Resolver**: `src/lib/prompt-os-resolver.ts` / `src/lib/services/prompt-os-service.ts`'s
  `resolvePromptTemplate(key)` — every LLM call site that wants a
  versioned, swappable-without-a-deploy prompt goes through this instead of
  a hardcoded string.
- **API**: `src/app/api/settings/prompts/route.ts` — `GET` lists
  templates+versions (optionally filtered by `templateKey`), `POST`
  creates a new version (admin-gated).
- **Eval**: `promptEvalCases`/`promptEvalRuns` + `prompt-eval-service.ts`,
  surfaced at `/prompt-eval` (deterministic keyword scoring, admin-gated) —
  a distinct thing from the Prompt Directory below.

## The 26 real template keys, by call site

Every key below is a live `resolvePromptTemplate('key')` call, found by
grepping `src/` directly (not a designed/aspirational list):

| Key | Call site |
|---|---|
| `ai_team.ai_router` | `src/lib/ai-team/team-service.ts` |
| `asset_routing.classify` | `src/lib/services/asset-routing-engine.ts` |
| `chat.ai_thread_system` | `src/lib/services/chat-service.ts` |
| `chat.veri_group_participant` | `src/lib/services/chat-service.ts` |
| `communication_drafting.draft` | `src/lib/services/communication-drafting-service.ts` |
| `construction.describe_drawing` | `src/lib/services/construction-ai-service.ts` |
| `construction.detect_budget_schedule_risk` | `src/lib/services/construction-ai-service.ts` |
| `construction.diff_drawing_descriptions` | `src/lib/services/construction-ai-service.ts` |
| `construction.discuss` | `src/lib/services/construction-ai-service.ts` |
| `construction.estimate_progress_from_photo` | `src/lib/services/construction-ai-service.ts` |
| `construction.generate_progress_summary` | `src/lib/services/construction-ai-service.ts` |
| `crm_intelligence.analyze_opportunity` | `src/lib/services/crm-service.ts` |
| `crm_intelligence.score_lead` | `src/lib/services/crm-service.ts` |
| `document.extract_content` | `src/lib/services/document-extraction-service.ts` |
| `email_intelligence.detect` | `src/lib/services/email-intelligence-service.ts` |
| `fde.evaluate_request` | `src/lib/services/fde-service.ts` |
| `fm.register_digitize_extract` | `src/lib/services/fm-register-digitization-service.ts` |
| `gst.ai_review_report` | `src/lib/gst/ai-review-report.ts` |
| `help.ai_assistant_system` | `src/app/api/help/ask/route.ts` |
| `instruction_mismatch.judgment` | `src/lib/loops/instruction-mismatch-audit.ts` |
| `loop_engineering.meta_synthesis` | `src/lib/loops/loop-engineering-audit.ts` |
| `meeting_intelligence.extract` | `src/lib/services/veri-meeting-service.ts` |
| `sales_ai.funnel_analysis` | `src/lib/services/visitor-intelligence-service.ts` |
| `task_execution.planning_system` | `src/lib/task-execution-engine.ts` |
| `ticket_intelligence.detect` | `src/lib/services/ticket-intelligence-service.ts` |
| `voice_ticket.extract` | `src/lib/services/voice-ticket-service.ts` |

Naming convention: `{domain}.{purpose}` — no enforced registry of valid
domains, just an observed convention across the 26 keys above.

**Keeping this table current**: it is a snapshot from a single grep pass
(2026-08-01), not a generated artifact — a future `resolvePromptTemplate()`
call site added without updating this table will silently drift, same
staleness risk as `docs/master/MODULE_MAP.md` before
`scripts/check-doc-scale-freshness.mjs` existed (see that script and
`ai-os/registry/business-rules-registry.yaml`'s own header for the same
honest caveat). Not CI-enforced this pass — a future extension could grep
`resolvePromptTemplate\(['"]` and diff against this table's key column.

## What does NOT exist yet — the "Prompt Directory" UI (real feature gap, not a doc gap)

`docs/research/WORKER_AGENT_AND_PROMPT_LIBRARY_EVALUATION.md` (lines
47-80) scoped a 4-phase "Prompt Directory": (1) FDE dispatch reuse, (2) a
typing-time predictive-match UI wired into chat input, (3) usage-based
auto-promotion, (4) decay/retirement audit. `capability-registry-service.ts`
already has the backend primitives for phase 2 (`findSimilarPromptPatterns()`
line 102, `indexPromptPattern()` line 113, `findSimilarPromptVersions()`
line 124 — its own comment at line 28 calls these "Phase 2 of the Prompt
Directory (backend only)"), but:

- **No UI page exists.** No `PromptDirectory` component anywhere in `src/`,
  no `page.tsx` under `settings/prompts` (only the API route). The only
  prompt-adjacent page is `/prompt-eval`, which is the eval lab, not a
  browsable prompt directory.
- No typing-time predictive-match wiring into chat input (phase 2's UI
  half), no auto-promotion pipeline (phase 3), no decay/retirement audit
  (phase 4).

This is real, non-trivial feature work (new UI + dispatch/promotion logic),
not closeable by writing documentation — recorded here as an honest,
named, still-open gap rather than silently left unmentioned. If prioritized,
scope it as its own task against the design doc above, not folded into a
future documentation pass.
