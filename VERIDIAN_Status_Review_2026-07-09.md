# VERIDIAN.docx Constitution — Status Review (2026-07-09)

**Author:** Claude Code Sonnet Desktop | **Date:** 2026-07-09
**Purpose:** Boss directive after Phase 2/3 completion: "review the document and check what's done and what's pending." This consolidates `GapAnalysis_by_Claude.md`'s P0–P5 priority tiers (2026-07-09, pre-implementation) against everything actually shipped since (Phase 1 through Phase 3, `ai-os/boss/COMPLETED.yaml` Waves 144–147), re-verified against live code and, where noted, live SQL — not just re-reading prior claims.

---

## Executive summary

Three of the four implementation phases in `Joint_Implementation_Plan.md` are complete: **Phase 1** (8 quick wins), **Phase 2** (6 items split Claude/z.ai, each cross-audited), and **Phase 3** (graph store, event bus, software-first reply gate — all 3 foundational substrate *decisions*, narrowly scoped). **Phase 4 remains explicitly pending** — it is 3 product/brand decisions that require the repo owner's call, not more engineering, and nothing in this session has touched them.

Beyond the 4-phase plan, several items from the original P0–P5 gap analysis were **not** part of the phased plan at all (they were judged too large to bootstrap inside an implementation sprint, or require a human action this AI pair cannot take) and remain genuinely open. Those are listed explicitly below so nothing quietly falls off the radar.

---

## What's done

### Phase 1 (8 items, PR #71, Wave 144) — all done
- `buildConversationHistory` capping (done by an earlier parallel session, `HISTORY_CHAR_BUDGET`, confirmed still in place)
- `conversations.current_state/previous_state/workflow_id/status` columns (additive, migration 0127)
- `orchestra_executions` stores actual prompt/reply content, not just cost/tokens (migration 0128)
- Construction predictor gets a deterministic `confidence` field
- FDE surfaces top-K candidates instead of discarding all but #1 (`top_candidates` jsonb)
- FDE `reuse_level` field (`exact_match`/`llm_assisted_match`/`new_proposal`)
- PR template mandates a Capability Registry check before new service files
- `workerAgents.supervisorWorkerAgentId`'s real (unused) status documented

### Phase 2 (6 items, PR #78, Waves 145/146/146B) — all done
- Context Path breadcrumb UI (Wave 145)
- High-impact action confirmation gate (`high-impact-action-detector.ts`, wired into task creation + `VeriComposer.tsx`)
- PII redaction for LLM-call audit logging (`pii-redaction.ts`, applied to `orchestra_executions` only — real conversation history stays unredacted for users)
- CLEE capture→apply gap closed for 2 of ~13 loop files (`loop-improvement-proposer.ts`) — **explicitly partial, see Pending below**
- Filler-word/phrase-normalization preprocessor (`prompt-normalizer.ts`)
- Confidence badge + "VERI is thinking" indicator (`/fde`, chat thread view)
- Conversation state-column writer: **deliberately not built** — documented as Outcome B (`docs/wave146-state-columns-decision.md`), waiting on a real state taxonomy/consumer, not a gap

### Phase 3 (3 substrate decisions, PR #80, Wave 147) — all done, pending final merge/deploy as of this writing
- **Graph store**: `entity_relationships` table (migration 0129) + `entity-graph-service.ts`. Schema/RLS live in the migration file; **not yet applied to the live Supabase database** (see Deploy status below). Zero production consumers wired in — a real, tested, unused foundation, not a partial build.
- **Event bus**: `event-bus.ts`, typed in-process pub/sub, 7 passing tests. Explicitly not a durable cross-invocation queue (documented why). Zero production consumers wired in.
- **Software-first reply gate**: `ai-reply-gate.ts`, narrow hallucinated-action-claim detector wired into the chat path, 10 passing tests. This is a real first slice of CSV 201's "software-first" rule, **not** the full structured-response-plus-renderer system the document describes — that remains open (see below).
- Bonus, same session: a CodeQL-flagged high-severity ReDoS in Phase 2's `prompt-normalizer.ts` found and fixed with regression tests.

### Governance/documentation hygiene (ongoing, not phase-numbered)
- 7 stale governance-file claims found and corrected in `ai-os/` during the original gap analysis pass (see `GapAnalysis_by_Claude.md`'s "Stale Governance Claims" section for the full list)
- `ai-os/boss/COMPLETED.yaml` now has real, dual-authored (doer+auditor) entries for every implementation wave — this file itself is one of the corrections (it previously had zero real entries)

---

## What's pending

### Phase 4 — explicitly awaiting repo-owner decision (not re-opened by this review, just re-stated so it isn't forgotten)
1. **Design language**: document's lavender/`#7C6CF2` Calm Intelligence Design System vs. the live Navy/Saffron/Teal/Cream identity.
2. **Conversation model**: parallel/nested per-workflow conversations (as the document envisions) vs. the live single-AI-thread-per-user pattern.
3. **Repo topology**: whether/when to pursue the multi-repo "Brain" architecture proposal (`Study_by_Claude.md`'s architecture addendum).

None of these are analysis gaps — more study won't resolve them. They need your call.

### Genuinely large items, correctly deferred past Phase 3 (not started, not scoped to a phase yet)
4. **Intent Engine.** Still zero intent-classification code anywhere in `src/lib`. This was P0 item 2 in the original gap analysis and remains the largest real gap — nearly every "software vs. AI routing" decision the document describes depends on it. Phase 3's reply gate is a narrow safety net on existing chat output, not an intent engine; it doesn't reduce this item's scope.
5. **Central "Need LLM?" routing gate.** Per memory (`veridian_todo_unified_request_classification.md`): designed but not dispatched, blocked on OpenRouter credits. Still open.
6. **Full structured-response contract + renderer on the chat path.** Phase 3 shipped the narrow reply-gate slice of this; the LLM still returns free-form prose stored/rendered verbatim otherwise. The full version (typed JSON output, per-content-type React renderer, migration story for existing plain-text messages) is a genuinely large, cross-cutting rewrite — correctly still out of scope per `Phase3_Design_by_Claude.md`'s own framing.
7. **Wisdom Engine, Innovation Engine, Prediction Engine (CSV 217–219).** No matching table sets exist for any of the three. Correctly gated behind the graph substrate (item 4 above, now has an initial `entity_relationships` foundation but zero real consumers) — should not be started before real usage of the graph store exists.
8. **Worker Coordination Protocol** (typed inter-agent messages — Task Assignment, Progress Update, etc.). Both real dispatch paths (`/api/ai/team/dispatch`, worker-agent execution) still use free-form JSON. Well-scoped, standalone, doesn't require the graph or intent engine first — a reasonable next quick-win candidate whenever Phase 4 product decisions free up bandwidth for more engineering.
9. **CSV 204 (Conversation Planning Engine) has no spec in the source document itself** (confirmed via full-document grep in `CrossReview_VERIDIAN_Study.md` — referenced 5 times, never given its own body section). Cannot be implemented against a spec that doesn't exist; would need to be designed fresh if pursued.

### Items that need a human action, not more agent work
10. **`ANTHROPIC_API_KEY` is still not configured as a GitHub Secret** — re-confirmed live via `gh secret list` moments ago (only `OPENROUTER_API_KEY`/`OPENROUTER_MANAGEMENT_KEY` present, no Anthropic key). This has been open since at least 2026-06-29 (`ai-os/boss/BOARD.yaml` AIOS-018) and blocks the `claude-task` dispatch path from ever actually authenticating. Requires buying API credits at console.anthropic.com — an action neither AI agent can take.

### P2/P3 items from the original gap analysis, not part of any phase, still open
11. Capability Registry: widen entity-type coverage beyond the current 4 types (worker_agent/automation_rule/module/prompt_pattern); add owner/dependency/quality-score metadata fields.
12. Fragmented workflow engines (`approvalWorkflowDefinitions`, `pmsWorkflowTransitions`, PROJEXA's hand-rolled status enums) not consolidated.
13. Weighted decision matrix (`erpRfqScoringCriteria`) not generalized into a platform-wide Decision Intelligence Engine.
14. Prompt template versioning (`prompt-os-resolver.ts`) not extended to a general `responseTemplates` mechanism.
15. CLEE capture→apply wiring covers 2 of ~13 loop files — the other 11 (`src/lib/loops/`) still only write to `loop_executions`, never propose structured improvements.

### Confirmed via live database query, moments ago (not just code reading)
- `loop_improvements`: 0 rows (expected — the Wave 146 wiring is code-only until the 2 wired loops actually run again in production and find something stale to flag; not a bug, just not yet observed live)
- `worker_agents`: 27 total, 0 with `supervisor_worker_agent_id` set (Wave 144's finding still holds, unchanged)
- `entity_relationships` table: does not exist live yet — migration 0129 is written but not applied (see Deploy status below)

---

## Deploy status (as of this writing)

- **GitHub**: Phase 1 (PR #71) and Phase 2 (PR #78) merged to `main`. Phase 3 (PR #80) has all required CI checks green (Lint/Type Check/Build/Unit Tests/CodeQL) with E2E and the Vercel preview still finishing — merging once complete.
- **Vercel**: auto-deploys from `main` on every merge; Phase 1/2 are live in production. Phase 3 will deploy automatically once PR #80 merges.
- **Supabase**: migrations 0127/0128 (Phase 1) were applied live and verified via `information_schema` at the time. Migration 0129 (Phase 3's `entity_relationships` table) is written but **not yet applied live** — will be applied via Supabase MCP immediately after PR #80 merges, then re-verified via direct query before being marked deployed.

---

## Bottom line

The 4-phase joint plan's engineering-scoped work (Phases 1–3) is complete. What remains is: 3 decisions only you can make (Phase 4), 2 genuinely large builds that were always correctly out of scope for a plan phase (Intent Engine, full structured-response renderer), one item blocked on a human buying API credits, and several smaller extend-don't-duplicate opportunities that were always P2/P3 priority — nice-to-have, not blocking anything.
