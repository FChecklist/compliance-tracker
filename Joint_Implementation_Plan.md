# Joint Implementation Plan — VERIDIAN AI OS Constitution Study

**Produced from:** `Study_by_Claude.md` + `GapAnalysis_by_Claude.md` (PR #59) and `Study_by_zaizlm5.2.md` + `GapAnalysis_by_zaizlm5.2.md` (PR #69), reconciled in `CrossReview_VERIDIAN_Study.md`. This is step 4 of the agreed workflow. Per that workflow: implementation now proceeds with **mandatory cross-audit** — whichever of Claude/z.ai does not implement a given task audits it, and both doer and auditor document every completed task.

## Guiding principle carried from both studies

Both AIs independently arrived at the same meta-finding: VERIDIAN's real infrastructure (Capability Registry, FDE, Worker Agent registry, Prompt OS, `task-execution-engine.ts`, the capability-tree/composer data model) is genuinely solid and should be **extended**, not duplicated. The biggest gaps are three structural substrates (graph store, event bus, structured/stateful conversation layer) that unblock nearly everything else once decided **once**, not once per proposing CSV. This plan sequences accordingly: cheap/independent wins first, then the foundational substrate decisions, with the large graph/event-bus/conversation-engine builds explicitly out of scope for this pass (they're multi-week efforts requiring their own dedicated design work, not something to start opportunistically inside a "keep working" session).

---

## Phase 1 — Implement now (this session): cheap, independent, both-AIs-agree wins

Each item below: (a) doesn't require the graph store or event bus to exist first, (b) is scoped to hours not days, (c) both gap analyses flagged it directly or it's a direct, uncontroversial consequence of a shared finding. Implemented as separate PRs, each cross-audited (I implement → z.ai audits, or vice versa).

1. **Cap `buildConversationHistory` instead of full-history replay.** (Both studies' #1 actionable item.) `chat-service.ts` currently resends up to 20 messages/12k chars every turn. Cap to last N turns + note that a full state-machine-based context-reference fix is Phase 2+ work, not attempted here.
2. **Add `current_state`/`workflow_id`/`status` columns to `conversations`.** Additive migration (Claude's Study finding, z.ai's #4 priority item). Enables Phase 2 state-machine work later without redesign; the columns themselves are inert until something writes to them, so this is safe to land now.
3. **Store the actual prompt/message content per LLM call** (with basic PII awareness), not just cost/model/tokens. z.ai's finding: currently you can prove *what it cost* but not *what was asked* — a prerequisite for any future explainability work and a real, current audit gap.
4. **Add a numeric `confidence` field to the construction predictor**, derived from entry-count + days-spanned (z.ai's concrete suggestion — first real step toward a Confidence Framework, fully scoped, no dependencies).
5. **Surface top-K embedding matches in FDE instead of discarding all but #1.** z.ai's finding — cheap change to an existing function, improves the "search before build" workflow's usefulness immediately.
6. **Add a `reuse_level` field to FDE evaluation output** making the chosen reuse tier explicit and auditable (z.ai's suggestion, pairs naturally with #5).
7. **Mandate a Capability Registry lookup before new service files, as a PR template checklist item.** (Both studies flagged this as the cheapest platform-wide risk reduction — process fix, not code.)
8. **Correct `workerAgents.supervisorWorkerAgentId`'s dead-column status** — either wire it into the worker-agent hierarchy display/logic minimally, or explicitly document it as reserved/not-yet-used so future readers don't assume a supervision feature exists. (z.ai's finding, confirmed live: 27 agents, 0 with a supervisor set.)

## Phase 2 — Next (not started this session): requires small design decisions first

- Filler-word/phrase-normalization preprocessor (Study 1 Level 2) — self-contained, but needs the "never strip these words" safety list built alongside it, so scoped as one slightly-larger unit, not a Phase 1 quick win.
- Context Path breadcrumb UI component (`PathSegment` data already exists per both studies — only rendering is missing).
- Confidence badge UI + "VERI is thinking" phase state in chat context (z.ai's suggestions — UI-only, needs the backend confidence field from Phase 1 item 4/6 as a real input first for at least one surface).
- High-impact-action confirmation gate (Delete/Payment/Approval keyword detection forcing a confirmation card) — both studies flag this, needs a short design pass on the keyword list.
- Close the CLEE capture→apply gap: make the daily loops emit structured Improvement Proposals into `loopImprovements` (currently zero rows despite loops running) — human-gated, no new infra, but touches the loop-running code directly so warrants its own careful PR rather than bundling with Phase 1.

## Phase 3 — Foundational substrate decisions (explicitly deferred, multi-week scope)

Not started in this pass — these require dedicated design work, not something to bootstrap inside an implementation sprint:
- **Graph store decision** (one `entityRelationships`-style store, designed for the Enterprise Cognitive Graph's unified-node model, serving as the substrate for every "Enterprise * Graph" proposal across both studies).
- **Event bus** (one pub/sub layer, unblocking SPOE/EEOE/ECCC-equivalent work).
- **Structured-response contract + software-first gate + renderer on the chat path** (the single largest drift both studies found — the LLM currently talks to the user directly in violation of the document's own golden rule). This is the highest-leverage fix in both gap analyses but is a genuinely large, cross-cutting change to the core chat experience — requires its own design/rollout plan, explicitly not attempted as part of "quick wins."

## Phase 4 — Product/brand decisions (repo owner sign-off required, not an engineering task)

- Lavender/CIDS design language vs. live Navy/Saffron/Teal/Cream identity.
- Single AI thread vs. parallel per-workflow conversations.
- Whether/when to pursue the multi-repo "Brain" architecture proposal.

---

## Cross-audit assignments for Phase 1

Per the agreed workflow: I (Claude) implement Phase 1 items 1-4 and 7-8 directly (local repo access, no dispatch needed for straightforward code changes). Items 5-6 (FDE changes) will also be implemented by me, then **z.ai audits all of Phase 1** via a dispatched review task before merge, since these are my implementations. Each PR gets a doer entry (me) and an auditor entry (z.ai) in `ai-os/boss/COMPLETED.yaml` per Operating Rule 7.
