# Phase 4 Implementation Plan

**Author:** Claude Code Sonnet Desktop | **Date:** 2026-07-09
**Source:** Boss resolved all 8 items from `VERIDIAN_Status_Review_2026-07-09.md` in one message. 6 approved for build now, 2 deferred. This plan breaks the 6 into small, real, independently-shippable tasks — same discipline as Phase 3: each ships a genuine working v1 slice with an honest statement of what's NOT attempted, rather than a fabricated "full" version of something that's realistically multi-week.

**Codebase survey inputs** (full detail available on request, summarized inline per wave below): `tasks` table has no priority/queue column, ordered purely by `createdAt`. `conversations.workflowId/currentState/previousState` exist but nothing writes to them (Wave 144, still true). No intent-classification code exists anywhere; `high-impact-action-detector.ts` is an explicit deterministic stand-in whose own header comment calls out the deferred Intent Engine. `llm-response-cache.ts` exists, org-scoped, opt-in, wired only into `fde-service.ts`. Chat renders `message.content` as Markdown via `react-markdown`; no structured/card rendering exists anywhere. `/api/v1/projexa/*` is a proven thin-wrapper-over-existing-services pattern (48 routes) with no separate data model — the template to reuse for Brain groundwork. No monorepo/workspaces setup.

**Important correction found during planning**: the earlier "blocked on OpenRouter credits" note (`veridian_todo_unified_request_classification` memory) refers to OpenRouter credits for the *AI-Workforce dispatch mechanism* (this session's z.ai automation), not the app's own runtime LLM calls — those use per-org BYOK config (`resolveModelConfig`) and already work live in production (chat already calls LLM successfully today). The routing gate (item 5) is **not actually blocked** — corrected below.

---

## Deferred (items 1 and 8 — documented, not built this wave)

- **Item 1, color customization**: real feature idea, not urgent. When picked up: a `theme_preference` jsonb/enum column on `users` (or a new `user_preferences` table), a Settings page color picker, and a CSS-variable-driven theme provider reading it at render time. Not started.
- **Item 8, `ANTHROPIC_API_KEY`**: unchanged, still requires a human to buy Anthropic credits and add the GitHub Secret. No agent action possible.

---

## Wave 148 — Task queue + priority + multi-thread conversations (item 2)

**Task queue + priority:**
1. Migration: add `priority` (integer, default 0, higher = more urgent) to `tasks`.
2. `task-service.ts`: `updateTaskPriority(ctx, taskId, priority)`; change task-listing `orderBy` to `[desc(tasks.priority), asc(tasks.createdAt)]` so higher-priority tasks surface first — this *is* the queue ordering, no separate queue table needed (avoids duplicating what `tasks` + an order-by already does).
3. `PATCH /api/tasks/[id]`: accept `priority` in the body.
4. UI: priority control on the Tasks page/task detail (simple: Low/Normal/High/Urgent mapped to 0/1/2/3).

**Multi-thread conversations:**
5. `chat-service.ts`: keep `ensureAiThread` as the default/primary thread (unchanged behavior, no regression for existing single-thread users). Add `createWorkflowThread(ctx, {workflowId, title})` — creates a genuinely new `conversations` row (`isAiThread: true`, `workflowId` set), doesn't touch the singleton-lookup logic.
6. `listConversations`: already returns all of a user's conversations; expose `workflowId`/thread-kind so the UI can distinguish "main thread" from "workflow threads."
7. UI: a thread switcher in the chat panel — list of threads, "new workflow thread" action, switching updates which conversation is loaded.

**Scope note**: this ships real multi-thread capability (multiple live `conversations` rows per user, switchable) and real queue/priority ordering. It does NOT build a full separate "workflow engine" that auto-creates threads from arbitrary triggers — thread creation is a direct user/API action for v1, matching what's actually asked for ("user can give one task after another... prioritize... multi-thread").

**Owner**: Claude (core chat-path architecture change, judgment-heavy). **Auditor**: z.ai.

---

## Wave 149 — Intent Engine v1 (item 4)

`src/lib/intent-engine.ts`: deterministic-first classifier, same word-boundary-regex approach as `high-impact-action-detector.ts` (explicitly the pattern that file's own header comment calls out as the Intent Engine stand-in to replace). `classifyIntent(text): {intent, confidence, matchedPhrase?}` against a registry of common intents (create_task, check_status, ask_question, create_contact, generate_report, unknown/fallback). Unknown falls through to existing behavior unchanged — zero regression risk, purely additive.

**Scope note**: v1 covers a defensible starter set of intents, not the document's "100,000+ intent definitions" vision (correctly out of scope per the original gap analysis' own P5 framing). Real, tested, and becomes the direct input to Wave 150.

**Owner**: Claude (foundational, Wave 150 depends on it directly). **Auditor**: z.ai.

---

## Wave 150 — Central "Need LLM?" routing gate (item 5)

`src/lib/llm-routing-gate.ts`: takes Wave 149's intent classification, checks a small registry of intents that have a deterministic handler (e.g. `check_status` → direct DB lookup, formatted reply, zero LLM call), routes there when matched; otherwise falls through to the existing `generateAiReply`/`callLLM` path unchanged. Wired into `chat-service.ts` ahead of the existing LLM call, fully backward compatible (unmatched intents behave exactly as today).

**Correction from the status review**: not blocked on OpenRouter credits — that blocker applies to this *session's* z.ai dispatch automation, not the app's own already-working runtime LLM calls. Fully buildable and testable now.

**Owner**: Claude (depends directly on Wave 149). **Auditor**: z.ai.

---

## Wave 151 — Structured-response renderer v1 (item 6)

Extends `ai-reply-gate.ts`'s existing `aiReplyEnvelopeSchema`. Additive, zero-regression design: the reply is still generated as today; a new parser attempts to interpret it as one of a few structured content types (summary card, confirmation card) via `JSON.parse` + Zod validation — if it doesn't parse/match, falls through to today's plain-Markdown rendering exactly as now. New `StructuredMessageContent.tsx` renders the matched types using existing shadcn `Card` primitives (`ui/card.tsx`, already in the codebase).

**Scope note**: this is the real "software decides how to render, not just raw LLM prose" pattern for 2-3 content types — not the document's full renderer-for-every-content-type vision, and does not yet change the system prompt to *request* structured output (that's a follow-on once these render correctly for hand-authored fixtures).

**Owner**: z.ai (self-contained UI/schema work, matches the established Wave 145/146B pattern). **Auditor**: Claude.

---

## Wave 152 — Wisdom / Innovation / Prediction Engines v1 (item 7)

Real, narrow, deterministic v1s — not the document's full multi-domain reasoning-engine vision, and explicitly seeded by real data from Waves 148-151 rather than synthetic examples:

- **Prediction Engine**: generalizes the proven `construction-prediction-service.ts` deterministic velocity-based pattern to a second real domain — task completion time, based on the org's own historical `tasks` data (now richer thanks to Wave 148's priority field).
- **Wisdom Engine**: a real, deterministic aggregation reading `loop_improvements`/`orchestra_executions` — e.g., most common gated-reply reasons, most common stale-token findings — surfaced, not fabricated insight.
- **Innovation Engine**: narrowest — if the same task type recurs N times for an org, surface a suggestion to convert it into an existing `automation_rules` entry. Deterministic pattern match over real data, not generative "AI ideas."

**Owner**: split — Claude does Prediction (extends an existing service she wrote), z.ai does Wisdom + Innovation (new, self-contained, dispatchable). **Auditor**: whichever didn't build each piece.

---

## Wave 153 — Brain architecture groundwork (item 3)

Scoped to **Phase A only** of the original 4-phase strangler-fig proposal (`Study_by_Claude.md`'s architecture addendum): wrap in place, no extraction yet.
1. New repo `FChecklist/veridian-brain` — scaffold only (README describing the architecture, `package.json`, a stub `@veridian/brain-sdk` client package with typed method signatures but no real HTTP calls yet).
2. New `/api/v1/brain/*` namespace in `compliance-tracker`, following the proven `/api/v1/projexa/*` thin-wrapper pattern exactly: auth guard → call existing service (capability-registry-service, worker-agent-service, entity-graph-service) → JSON response. No data model changes, no code moved.

**Explicitly NOT done**: Phases B-D (cross-repo validation via projexa/veda-advisors, physical extraction, net-new Brain-only components) — genuinely multi-week, correctly deferred, same as the original proposal always said.

**Owner**: Claude (architecture-decision-heavy). **Auditor**: z.ai.

---

## Sequencing and cross-audit

Waves 148-150 are sequential (149 needs 148's conversation model touches settled; 150 needs 149's classifier). 151-153 are independent of each other and of 148-150, so dispatched to z.ai in parallel once 148 lands. Every wave gets doer + auditor entries in `ai-os/boss/COMPLETED.yaml`, same as every prior wave this session. Each is typechecked, linted, and unit-tested before merge; each is cross-audited before being marked done in this document.
