# VERIDIAN Dynamic Mode Pills & Dynamic Chain Framework (DMP-DCF)

**Version 1.0 -- 2026-07-11. The universal business-classification, navigation, and orchestration language of VERIDIAN AI OS.**

Adopted from two documents supplied by the repository owner ("Dynamic Mode Pills and Dynamic Option Selection.docx" and its later addendum adding the Context-Aware Adaptive UI and Dynamic Chain Master Directory sections). Same discipline as the sibling constitutional documents: **[ENFORCED]** = real, running, cited by file:line. **[PARTIALLY ENFORCED]** = part real, named explicitly. **[POLICY ONLY]** = not yet backed by code. **[NOT APPLICABLE YET]** = nothing to enforce against. **[OUT OF SCOPE, STATED]** = a deliberate business/content decision, not a code gap.

## Constitutional authority

This document, together with its sibling constitutional documents (`VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md`, `VERIDIAN_AUDIT_ORGANIZATION.md`, `VERI_CHAT_GOVERNANCE.md`), **supersedes any individual agent instruction, session note, or informal working practice that conflicts with it.** It is a Constitution, not a Standard Operating Procedure a later narrower instruction can silently override -- the Dynamic Mode Pills/Chain Selector's per-selection guardrail rules (`guardrail-engine.ts`) apply regardless of which agent or dispatch surface originates a task. (Added 2026-07-12, ai-os/tree4-unified/10-merged-governance-layer.yaml U-D1.B2.S2.)

## The single most important finding before any of this was designed

**The Dynamic Mode Pills and Chain Selector are not a new concept for this codebase -- they already exist, shipped, under exactly these names.** `src/components/veri-chat/veri-chat-context.tsx`'s `CapabilityNode` tree, rendered by `src/components/veri-chat/VeriComposer.tsx` (mounted once in `AppShell`, not a mockup), built live by `capability-tree-service.ts`'s `buildCapabilityTree()` from real org data (enabled product branches, worker agents, projects, ERP entities, compliance items, VCEL engines). The terms "Dynamic Mode Pills" and "Chain Selector" already appear verbatim in `guardrail-engine.ts`, `dispatch-output-validator.ts`, and `schema.ts`'s own comments, predating these two source documents. This document is a *formalization and extension* of real, working infrastructure, not a from-scratch build -- treat any claim below of "already real" as load-bearing for scope decisions, not decoration.

## Two decisions made before implementing anything

### Decision 1: VERI's relationship to VERI Chat -- additive, not a reversal

The source documents ask that VERI Chat be the platform and VERI be one participant within it. **Wave 37 already drew this exact distinction, in the opposite direction**: `AppSidebar.tsx` and `chat/page.tsx`'s own comments state "VERI Chat is now human/guest chat only -- the AI thread has its own dedicated surface at /veri-ai," a deliberate prior decision, not an oversight. Silently reversing that (folding the AI thread back into `conversations` and retiring `/veri-ai`) would delete a real, shipped, already-adopted surface without confirmation. Silently ignoring the new documents' requirement would fail the actual ask.

**Decision, stated plainly**: VERI becomes an *invitable participant* in multi-party `conversations` (`type: 'group'`) when a human explicitly adds it -- additive to, not a replacement for, the existing dedicated VERI AI 1:1 thread. This satisfies the source document's own conditional language ("VERI may participate in conversations when invited, assigned, or automatically included according to business rules" -- Doc A §11; "VERI may participate in conversations when invited... VERI Chat can function without VERI" -- Doc B) without an unrequested architectural rollback. See "VERI as a Multi-Party Participant" below.

### Decision 2: the enterprise taxonomy is structural capability, not business content

Doc A's examples (Sales, CRM, Finance, HR, Compliance, Projects, Procurement, Support, Legal, Administration, each with deep chain hierarchies) describe a **multi-domain enterprise business taxonomy**. `schema.ts`'s own comments state, repeatedly and currently accurately, that this is a **"single-domain platform today"** (the `compliance` domain) -- `moduleRegistry.domain`/`productBranches.domain` are free text specifically because no second domain exists yet to make a real FK hierarchy meaningful.

**Decision, stated plainly**: this wave builds the *structural* capability to hold and query a real multi-domain chain taxonomy (a persisted `dynamic_chains` table, graph-backed via the existing `entity_relationships` table) -- it does **not** author a Sales/CRM/Finance/HR/Legal taxonomy's actual content. Populating that is a business-modeling exercise for the organization (or a future, separately-scoped wave with real domain requirements), not a thing that can be honestly fabricated as code. Building fake taxonomy content to make this document look fully implemented would be exactly the "documentation theater" this whole framework exists to prevent.

---

## Relationship to the other constitutional documents

| Document | Governs |
|---|---|
| `VERIDIAN_AI_CONSTITUTION.md` | What the AI may *do* |
| `MASTER_AI_OS_ARCHITECTURE.md` | Platform architecture rules |
| `VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md` | Task lifecycle, AI-dispatch guardrails |
| `VERIDIAN_AUDIT_ORGANIZATION.md` | Independent assurance |
| `VERIDIAN_DMP_DCF_CONSTITUTION.md` (this document) | Business classification, navigation, and orchestration -- how *every activity* declares what business context it belongs to |

---

## 1-3. Vision, Purpose, Core Principle ("no activity without a Dynamic Chain")

**[PARTIALLY ENFORCED]** -- true today only for tasks created through `VeriComposer`'s chain-selection flow (`dispatchInstruction()` resolves the selected path to a leaf, server-re-verified in `task-service.ts:createTask()`). **Not true** for chats, reports, or workflows -- confirmed by direct code review: `sendMessage()`/`generateAiReply()` involve zero capability-tree lookup. Making this literally universal ("no communication, no report, no automation may exist without a chain") is a multi-surface rollout, not a single change -- see "Rollout scope" below for what ships this wave vs. what's tracked.

## 4-5. Dynamic Mode Pills / Dynamic Chain

**[ENFORCED]** -- `CapabilityNode` (`veri-chat-context.tsx`), rendered as the pill row + cascading `ChainRows` in `VeriComposer.tsx`, populated by `GET /api/capability-tree` -> `buildCapabilityTree()`. Real, live, computed from actual enabled data per org -- not hardcoded, not a mockup.

## 6. "Dynamic Chain is the Business DNA"

**[PARTIALLY ENFORCED]** -- true for the one thing a resolved chain leaf currently carries: `workerAgentId`/`engineKey`/`fixedInputs` (dispatch routing). **Not yet true** for the document's fuller list (permissions, approvals, notifications, audit rules, KPIs, SLAs all deriving from the chain) -- those remain governed by their own separate mechanisms today (RLS for permissions, `high-impact-action-detector.ts` for approvals, etc.), not unified under the chain. Unifying them is exactly what "Dynamic Chain ID" (below) is a first step toward, not a full realization of.

## 7. User Experience (predictive, minimal clicks, keyboard/search/recommend)

**[PARTIALLY ENFORCED]** -- the tree renders live and only shows branches with real enabled data (`buildBranchNodes()`'s enabled-only filter is itself a minimization mechanism). **Not yet built**: behavioral prediction/prioritization of frequently-used chains, keyboard shortcuts, Tab navigation, search-within-the-tree, auto-selection of obvious single-option branches. Tracked, not fabricated.

## 8. Personalized Dynamic Library (Global + User Library)

**[NOT APPLICABLE YET]** -- confirmed zero hits for any "library" concept in the codebase. The capability tree itself is already implicitly per-org (only shows what that org has enabled) and implicitly per-user-permission (RLS), which is the closest existing analog to "Global Library, filtered" -- but there is no separate persisted "User Library" that learns/evolves from behavior. This is real, valuable, buildable future work (needs usage-frequency tracking per user per chain -- `dynamic_chains`, below, is the prerequisite store for it) -- not built this wave.

## 9. Context-Aware Dynamic User Interface (Adaptive Dynamic Mode Pills)

**[PARTIALLY ENFORCED, narrow]** -- the tree already changes based on org-level context (which branches/modules are enabled). **Not yet built**: per-screen/per-module automatic pill realignment as a user navigates (the document's Sales CRM / HRMS / Finance module-switch examples), intelligent preselection based on role/history, and "Dynamic Mode Pills as the primary navigation mechanism replacing ERP menus" (a full navigation-model change). This is real frontend architecture work spanning every page in the app -- tracked as deferred (task #24), not attempted piecemeal this wave, which would produce an inconsistent half-behavior worse than the current, honestly-simpler one.

## 10-11. VERI -- Your Assistant / VERI Chat

Covered in `VERI_CHAT_GOVERNANCE.md` (this wave's companion document) -- kept separate since it's a distinct governance question (communication authority and approval, not classification).

## 12. Software Execution Principle (software first, then VERI/GPT-OSS-120B, then escalation)

**[ENFORCED]** -- already real, predating this document: `executeEngineDispatch`/`executeStructuredDispatch` (zero-LLM paths) run before `task-execution-engine.ts`'s free-text/LLM-planning fallback (`task-execution-engine.ts`, confirmed in `VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md` §2). GPT-OSS-120B is genuinely the platform-default execution tier for customer-facing Orchestra Layers (`orchestra-model-resolver.ts`). No change needed.

## 13. Monitoring / 14. Audit

**[PARTIALLY ENFORCED]** -- covered by `VERIDIAN_AUDIT_ORGANIZATION.md` (Chief Audit Officer, L1 audit gate, loop-based monitoring) shipped last wave. Not chain-specific yet (monitoring doesn't currently key off "which Dynamic Chain" a task belongs to, since tasks don't persist a chain identity today -- see "Dynamic Chain ID" below).

## 15. Missing Dynamic Chain ("My Option Is Not Available")

**[PARTIALLY ENFORCED -> ENFORCED, this wave]** -- VERI FDE's `submitFdeRequest()`/`proposeWorkerAgent()` already implements almost exactly this flow: capture requirement -> embedding search for a match -> LLM evaluation of near-matches -> on no match, propose a new capability with a real `approvalRequests` governance row. What was missing: it was only reachable via the separate `/fde` page, not from the Chain Selector itself where a user would actually hit "nothing here fits." This wave adds a "My Option Is Not Available" leaf to `ChainRows` that routes into the same FDE pipeline non-passively. **Honest limitation carried forward, not fixed**: FDE proposes a single `workerAgents` row, not a full Dynamic Chain bundle (module/rules/permissions/workflow/KPIs) -- the document's fuller "propose a new chain" concept is bigger than what FDE does today; this wave connects the UI to the real existing capability without overclaiming it now proposes complete chains.

## 16. Continuous Improvement

**[PARTIALLY ENFORCED]** -- covered by the existing CLEE pipeline (`loop-improvement-proposer.ts`), documented in `VERIDIAN_TASK_GOVERNANCE_CONSTITUTION.md` §8. No new mechanism needed; a "chain was used successfully/failed" signal is a candidate future CLEE input once Dynamic Chain ID exists to key off.

## 17. Visibility (Task Number / Mode Pill / Chain / Status / Priority / Owner always shown)

**[PARTIALLY ENFORCED]** -- `VeriComposer.tsx` already shows the selected pill+chain during selection. Persistent display throughout task execution (not just at creation) requires the chain to be stored on the task, which is exactly Dynamic Chain ID Phase 1's job -- see below.

## 18. Integration ("no component shall operate outside the framework")

**[POLICY ONLY]** -- aspirational as literally stated (would require every module/API/report/workflow to route through the chain). This wave's real contribution is Dynamic Chain ID Phase 1, a foundation other surfaces can adopt incrementally -- not a claim that integration is complete.

---

## Dynamic Chain as the Primary System Object -- Phase 1 (additive linkage)

**[ENFORCED, this wave, Phase 1 only]** -- no shared chain-identity concept exists across task/chat/report/approval today (confirmed: no `chainId`/`dynamicChainId` column anywhere in `schema.ts`). The closest existing prior art, reused rather than reinvented:
- `conversations.contextEntityType`/`contextEntityId` (Wave 32) -- the proven polymorphic-pointer pattern also used by `embeddings`/`approvalRequests`/`audit_logs`.
- `forgeProjectRequests.selectionPath`/`selectionLabels` (jsonb arrays) -- proven precedent for persisting a chain-selection path, just scoped to one unrelated intake form.

**What ships**: a new `dynamic_chains` table (id, org-scoped, `modePill`, `pathKeys` jsonb, `pathLabels` jsonb, optional `moduleRef`, `description`, `createdById`, `status` draft/proposed/approved -- the core queryable structure, not the document's full 10-sub-object schema, which is deferred per task #24) + nullable `dynamicChainId` columns on `tasks` and `conversations`. Wired only at **new** task/conversation creation via the Chain Selector -- zero backfill of historical rows, matching this codebase's established "don't force a contrived write" discipline (Phase 3 graph store, `activity_log` Phase 1 precedent).

## Dynamic Chain Master Directory (DCMD) -- graph substrate, not built as a graph consumer yet

**[POLICY ONLY, with real infrastructure ready]** -- the addendum's "make it a graph, not permutations" recommendation already has its substrate: `entity_relationships` (Phase 3, VERIDIAN.docx joint implementation plan) is a generic typed-edge table -- `sourceType`/`sourceId` -> `relationshipType` -> `targetType`/`targetId` -- built specifically as graph-store infrastructure and deliberately shipped with **zero consumers wired in**, per that wave's own "don't force a contrived consumer" discipline. `dynamic_chains` (above) is the first real node type this graph could hold relationships between (chain -> module, chain -> approval-required, chain -> report). **Not done this wave**: actually writing `entity_relationships` rows for chain relationships, or building the "search DCMD before creating new work" cross-component requirement. This is real, valuable, correctly-sequenced future work (needs `dynamic_chains` to exist first, which it now does) -- tracked as task #24, not fabricated as complete.

**Directory Intelligence** (duplicate/missing/broken/obsolete chain detection): **[PARTIALLY ENFORCED]** via existing infrastructure -- `capability-registry-service.ts`'s `findSimilarCapabilities()`/`auditDuplicateCapabilities()` (≥0.92 embedding similarity) already does duplicate detection for worker agents/automation rules/modules. Extending it to `dynamic_chains` specifically is a small, real follow-on (add `dynamic_chain` as a 5th `CapabilityEntityType`) -- not done this wave, tracked.

---

## Rollout scope -- what ships this wave vs. deferred

**Ships**: `dynamic_chains` table + `dynamicChainId` linkage (Phase 1), "My Option Is Not Available" wired into the Chain Selector UI, this constitutional mapping.

**Deferred, tracked, named honestly (task #24)**: the full 10-sub-object rich chain schema, `entity_relationships` actually wired as the DCMD graph, per-screen adaptive UI / Dynamic Mode Pills as primary navigation, Global/User Library, real multi-domain taxonomy content, version control on chains, "search DCMD before creating new work" enforced across every component.

## How this differs from the source documents

Adopted: the Mode Pill/Chain Selector as the operating language framing (it already was one, this formalizes it), the "no chain, no work" principle as a direction to build toward rather than a switch to flip, the DCMD's graph recommendation (matched to real existing infrastructure), the missing-chain governance flow (matched to real existing FDE infrastructure).

Corrected/scoped: VERI's participation in VERI Chat is additive to Wave 37's existing split, not a reversal of it. The multi-domain enterprise taxonomy is treated as content the organization must define, not code that can be honestly fabricated. The rich per-chain schema and full cross-component integration are named as real, sequenced future work rather than claimed complete in one pass.
