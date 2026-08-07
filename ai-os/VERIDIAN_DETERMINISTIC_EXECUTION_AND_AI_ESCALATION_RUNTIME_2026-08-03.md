# VERIDIAN Deterministic Execution and AI Escalation Runtime v1.0

**UMR:** `UMR-20260803-041047-03ee` (OCID-026, this document's own directive), parented to
`UMR-20260803-041047-03ee`'s own citation chain: `UMR-20260803-041000-70ae` (OCID-024),
`UMR-20260803-040929-9713` (OCID-023), `UMR-20260803-040844-4a33` (OCID-022),
`UMR-20260802-173631-ca85` (ERP Functional Completeness Master Program), `UMR-20260802-165606-4413`
(OCID-020), `UMR-20260802-164659-9a31` (server artifact traceability audit), `UMR-20260802-165034-5747`
(the gatekeeper rule), `UMR-20260802-165434-cd91` (unified project memory), `UMR-20260802-165541-c27d`
(the recovery framework).

**What this is:** a documentation-only artifact answering three questions about VERIDIAN's real,
already-built runtime — how software decides, when AI is invoked, and when AI shall never be invoked
— using **only mechanisms that already exist** in the live `compliance-tracker` repository, verified by
direct file/line reads, not designed here. Every section below cites the real file and, where
practical, the real line number backing its claim.

**What this is not:** not a new architecture, not a new prompt system, not a new rule/decision engine,
not a new function/report/analysis library, and not an implementation of anything. Per this OCID's own
directive, browser design, PWA design, database design, and security design are explicitly out of
scope — those belong to other OCIDs (see `ai-os/VERIDIAN_LAPTOP_WEB_BROWSER_RUNTIME_2026-08-03.md`,
OCID-024, for browser scope, and OCID-020/`ai-os/CONSTITUTION.yaml`'s security sections for security
scope). This document is a **map of what already exists**, organized so a future implementer (or
auditor) can find the real wiring instead of re-deriving or duplicating it.

**Honest terminology correction, carried forward openly (same standard `ai-os/VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md`
applied to the "OCID-021" label):** this task's own SPEC cites "the OCID-021 implementation lock" as an
already-registered artifact permitting discovery/documentation to continue. Independently re-checked at
the start of this task (`grep -rn "OCID-021" ai-os/` — zero real hits beyond citations of the same
already-known non-existent label): **no artifact named "OCID-021" exists in this repo.** The real,
findable governance mechanism this label has always meant is `SEC-07` in `ai-os/CONSTITUTION.yaml`
(lines 652-656), which locks implementation/gap-closure/production-changes/completion-certification/
platform-freeze under OCID-038/039/040 until OCID-020 (`UMR-20260802-165606-4413`) is independently
verified complete — and which explicitly does **not** lock discovery, matrix-building, or documentation
work such as this OCID. This document proceeds under `SEC-07` correctly, citing it by its real name.

**Second honest discrepancy, flagged rather than silently resolved:** `ai-os/VERIDIAN_OCID_022_039_STATUS_SNAPSHOT_2026-08-03.md`
(section 1) guessed OCID-026's title would be "VERIDIAN Global Knowledge Discovery and Reuse Runtime."
This task's real, directly-issued SPEC names it "VERIDIAN Deterministic Execution and AI Escalation
Runtime" instead — a related but distinct framing (this document covers global reuse/discovery *as one
part* of a larger deterministic-execution-vs-AI-escalation model, not as its sole subject). Proceeding
on this task's own literal directive text as authoritative, per the same handling precedent OCID-040
used for its own OCID-036/037 mislabeling correction.

---

## 1. End User Input Runtime

Every end-user input that becomes a task passes through one real conversion point: `createTask()` in
`src/lib/services/task-service.ts:133-188`, called from `POST /api/tasks`
(`src/app/api/tasks/route.ts`). Its real input shape:

```
{ title, description?, assistantId?, projectId?,
  workerAgentId?, agentInputs?, engineKey?, engineInputs?,
  modePill?, chainPathKeys?, chainPathLabels?,
  confirmed?, savePreference?, highImpactCategory? }
```

This single shape is the real, deterministic normalization point for chat messages, mode-pill
selections, and Chain Selector picks alike — none of them reach execution through a separate path.
`createTask()` requires a real authenticated user session (`ctx.actor.dbUser`, line 164) before
anything else runs.

## 2. Mode Pills Runtime

Real component: `src/components/veri-chat/VeriComposer.tsx`. Pills render from two real sources: a
small fixed set (`FIXED_MODES` — `discuss`, `chats`, `todo`, from the shared `@fchecklist/veridian-ui-kit`
package) plus one pill per top-level `CapabilityNode` returned live by `GET /api/capability-tree`
(data-driven, not hardcoded). A pill selects *what kind of thing* the user is about to do, which
pre-seeds the Chain Selector or switches composer behavior. `modePill` is a first-class field carried
all the way to execution: stored on `dynamicChains` rows, read by `resolveTaskCapability()`
(`src/lib/task-execution-engine.ts:1889-1915`), and used by `deriveCapabilityKey(modePill, pathKeys)`
(`src/lib/services/capability-learning-service.ts:23-31`) — a deterministic slug ensuring the same
(mode pill, path) pair always resolves to the same learned capability.

## 3. Option Chain Runtime

**Terminology correction, verified not assumed:** "option chain" is not a distinct, separately-named
concept anywhere in `src/` (`grep -rin "option.chain\|OptionChain" src/` — zero hits). The real,
already-shipped mechanism this term refers to is the **Chain Selector**:
`src/components/veri-chat/ChainSelector.tsx` (`ChainRows`, `ChainSelectorDialog`,
`pathSegmentDisplay`/`pathDisplayString`/`nodeChildrenAt`/`expandPathsForSend`), backed by
`capability-tree-service.ts`'s `CapabilityNode` rows. It is a cascading, multi-level picker that builds
a `chainPathKeys`/`chainPathLabels` pair, gated by `validateChainDepth()` (see §8) before a task can be
created from it. Future references to "option chain" in downstream OCIDs should cite the Chain Selector
by its real name to avoid re-litigating this same terminology gap.

## 4. Chat Runtime

VERI Chat's real state lives in `src/components/veri-chat/veri-chat-context.tsx:45-49`
(`createVeriChatContext()` from the shared kit) wrapped by a local `AiThreadProvider` (lines 84-137)
owning AI-thread switching (`POST /api/conversations/workflow-thread`) and the lifted `selectedPath`
state. `VeriComposer.tsx` is the persistent bottom composer (mounted once in `AppShell.tsx`, never
remounted on navigation). `VeriChatPanel.tsx` is the independent right-side panel with `overview`/
`tasks`/`chats`/`todo`/`meetings`/`approvals`/`voice` tabs, backed by `/api/tasks`, `/api/conversations`,
`/api/veri-todo`. **Honest gap:** `TaskDocumentScreen.tsx`, referenced in this task's own directive
list, does not exist as real code yet — it is a still-unshipped direction from
`VERI_CHAT_MOCKUP_TO_PRODUCTION_SPEC_2026-08-01.md` §3.3, not a built runtime.

**"VERI Assistant" — verified, not distinct:** `grep -rin "VERI Assistant|VeriAssistant" src/` returns
zero hits. It exists only as an internal workstream/tracking name in `ai-os/` docs
(`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md:196,221`, row H: "VERI Assistant Mother Router migration —
finish migrating the 35 self-documented unmigrated call sites," canonical artifact
`src/lib/ai-router/mother-router.ts`). It is not a shippable, user-facing product surface distinct from
VERI Chat — it is the name of the ongoing migration of scattered LLM call sites onto the Mother Router
(§9, §19).

## 5. Voice Runtime

A real voice pipeline exists, but as a standalone recorded-memo → transcription → ticket domain, not
live in-composer dictation: `src/app/api/voice-tickets/route.ts` (+ `[id]/route.ts`,
`[id]/action-items/route.ts`) is the CRUD layer; `src/app/api/veri-chat/voice-tickets/route.ts:1-23`
surfaces it as VERI Chat panel's "Voice" tab via `listVoiceMemos()`/`listMyVoiceTickets()`
(`src/lib/services/voice-ticket-service.ts`). **Honest gap:** no file under `src/components/veri-chat/`
wires an actual microphone/recording control into `VeriComposer.tsx`'s send path — voice input today is
a separate record → transcribe → review pipeline surfaced as a read tab, not a live dictation button on
the composer.

## 6. Attachment Runtime

Two real, differently-wired mechanisms exist. `GlobalChatDock.tsx:114-135` (the older, still-mounted
floating command bar, Wave 48) has a working upload flow: upload the file, then
`POST /api/veri-chat/messages/${messageId}/attachments` links it, via
`attachDocumentToMessage()` (`src/lib/services/veri-chat-service.ts:52`,
`db.insert(messageAttachments)`). **Honest gap:** the newer, persistent `VeriComposer.tsx`'s Paperclip
button (line ~681-683, `title="Attach a document"`) has no `onClick` handler and no file input wired —
it renders but does not attach anything. Any future work should reuse `GlobalChatDock.tsx`'s already-
working upload flow rather than build a second one for `VeriComposer.tsx`.

## 7. Normalization of All Inputs

Deterministic, pre-LLM normalization already exists at two real layers. `src/lib/prompt-normalizer.ts:1-160`
(`normalizeForLlm()`) strips filler/greeting/meta phrases via deterministic regex/word-list matching
before any LLM call, protected by a denylist of meaning-changing words (lines 24-28) and a never-send-
empty guard (lines 155-158) — this is pure text processing, never itself an LLM call. Separately, Chain
Selector path data is normalized into a canonical `chainPathKeys`/`chainPathLabels` pair by
`expandPathsForSend()`/`pathDisplayString()` (`ChainSelector.tsx`) before it ever reaches `createTask()`.
Locale is normalized additively at response time by `src/lib/ai-response-locale.ts:1-73` (cookie-driven
directive append, never overriding a template's own output-format requirement).

## 8. Deterministic Task Creation

`createTask()` (`src/lib/services/task-service.ts:133-188`) enforces two real, non-bypassable gates
before a task row is created: `validateChainDepth(input.chainPathKeys)` (line 177 — minimum 2-level
chain selection, the sole enforcement point since this is the only place a `dynamic_chains` row is
created), and a deterministic keyword gate for Delete/Payment/Approval/etc. high-impact intents (lines
180-187) that blocks execution until the caller resubmits with `confirmed: true`. Neither gate involves
an LLM call, so neither can be prompt-injected around. The deterministic-vs-AI branch happens
immediately after, in `executeTask()` (`src/lib/task-execution-engine.ts:2125-2166`): if `engineKey` is
set, `executeEngineDispatch()` runs a VCEL calculator (line 2149, zero LLM calls); else if a
`resolvedWorkerAgentId` is set (re-verified server-side against the real worker-agent registry),
`executeStructuredDispatch()` runs (line 2164, zero LLM calls); only if neither path applies does
execution fall through to LLM planning (`resolveModelConfig()`/`callLLMJson()`, from ~line 2260). This
structured-first order is documented end-to-end in `WAVE_114_DETERMINISTIC_DISPATCH.md`.

**Scope note:** `/api/ai/team/dispatch` and `src/lib/ai-router/instruction-contract.ts`/
`task-register-service.ts` are a separate, `veridian_admin`-gated, platform-internal system (governs
building VERIDIAN itself — the Software Team L0-L5 ladder, §9/§19) — not the end-user chat→task path
described in this section.

## 9. The Software Decision Engine

No file literally named `decision-engine.ts` exists. The real, load-bearing decision function is
`classifyExecution(input: ClassificationInput)` in `src/lib/services/software-coverage-service.ts:44`
— a pure, DB-free function returning one of three `ExecutionBucket` values:

- `FULL_SOFTWARE` — caller already knows the request is 100% software-executable.
- `PACKAGE_AVAILABLE` — an approved, previously-AI-generated instruction package exists and is still
  trusted (`MIN_ACCEPTABLE_SUCCESS_RATE = 70`, line 59-60 — a degraded package is demoted back to
  `NOVEL` rather than blindly reused).
- `NOVEL` — genuinely new, requires fresh AI judgment.

`classifyExecution()` is called from `task-execution-engine.ts` as the real first decision made about
every task. Two supporting deterministic resolvers back it: `module-rules-resolver.ts:43`
(`resolveModuleRule()`, most-specific-scope-wins per-tenant override resolution, RLS-enforced) and
`guardrail-engine.ts:51-62` (`registerGuardrail()`/`evaluateGuardrails()`, the codebase's actual generic
deterministic rule engine — opt-in, 4 phases: input/process/output/logic; an unregistered leaf always
passes, "not rigid" by design). `guardrail-registrations.ts:1-504` wires the real leaves in production
today (`ai_team.dispatch`, `task_execution.free_text_planning`, `ai_workforce.loop_budget`,
`task_execution.qa_precompletion`, etc.).

## 10. Function Discovery

No literal "function library" term exists in the codebase (`grep -ri "function.library\|functionLibrary"`
— zero hits). The de facto function library is `src/lib/services/` (301 files as of this snapshot, e.g.
`capability-registry-service.ts`, `report-engine-service.ts`). A real, mechanical function catalog
generator exists: `ai-os/scripts/extract-function-catalog.mjs` — TypeScript-compiler-AST extraction
(parse-only) of every function/arrow-const/class-method under `src/**/*.{ts,tsx}`, producing
`FUNCTION_CATALOG.json` (regenerated on demand, not committed to this checkout). A smaller, curated
registry also exists for VCEL: a 25-file/247-function computation-engine registry
(`ai-os/system-tree/00-INDEX.md`). Any AI or software component needing to know whether a function
already exists should run the generator or query `system_index` (§13) rather than re-deriving this list
by hand.

## 11. Report Discovery

The most concrete, real registry in this inventory. `reportDefinitions`
(`src/lib/db/schema.ts:4702`) is a real DB table with columns `category`, `classifications` (jsonb),
`periodicity`, `executionType` (`'deterministic_aggregation' | 'deterministic_formula' | 'ai_recipe' |
'external_service'`), `executionConfig`, `status` (`'built' | 'data_gap' | 'planned'`). One dispatcher,
`executeReportDefinition` in `src/lib/services/report-engine-service.ts` (1790 lines), runs every
registered report — no per-report bespoke function, replacing what the file's own header describes as
~150 previously bespoke, duplicative report functions. `src/lib/services/report-taxonomy.ts:1-134`
supplies the shared vocabulary. `customCharts` (schema, adjacent to `reportDefinitions`) is a
deliberately thinner ad-hoc mechanism that reuses the same `AggregationConfig`/`TABLE_REGISTRY` rather
than a second query engine (`custom-chart-service.ts:113`).

## 12. Analysis Discovery

Not a separate storage mechanism from reports. "Analysis" is one of `report-taxonomy.ts`'s 7
`ReportCategory` values (`software_analysis`, `ai_analysis`, `ai_new_analysis_promoted`), stored in the
same `reportDefinitions` table, distinguished by `executionType`/`category` — not a second table. 43
service files reference "analysis" in prose (e.g. `construction-prediction-service.ts`,
`cost-anomaly-service.ts`); these are the pre-existing bespoke implementations `report-engine-service.ts`'s
header explicitly names as the duplication problem the registry solves. `executionType: 'external_service'`
is the deliberate passthrough marker that catalogues them without reimplementing them.

## 13. Global Reuse Runtime

Four complementary, already-built layers (`ai-os/MASTER_INDEX.yaml`'s own `search_layers_relationship`
field, confirmed 2026-07-30):

1. `ai-os/MASTER_INDEX.yaml` (2210 lines) — browsable, hand-maintained narrative index across
   compliance-tracker/projexa/veda-advisors/claude-control. Its own protocol (lines 1-9): *"Before any
   grep/find/read across this server... before writing any new script/table/register, query this file
   for an existing match... If a match exists, use it or extend it — do not create a parallel
   mechanism."*
2. `knowledge_engine` — a SQLite table in `ai-os/memory/superboss-register.sqlite`, machine
   drift-detection, queried via `superboss-register.py query-knowledge <term>`.
3. `wiring_registry` — same SQLite file, a code-level entity-relationship call graph mechanically
   generated from 8 live sources.
4. `system_index` — same SQLite file, the fast existence-check gate, queried via
   `superboss-register.py check-duplicate`/`search` (§14).

`ai-os/system-tree/00-INDEX.md` is a fifth, complementary layer: a git-tracked, point-in-time
architectural census of everything that actually exists (614 API routes, 377 tables/106 enums, ~130
pages for compliance-tracker alone, plus PROJEXA and veda-advisors trees), distinct from
`ai-os/audit-tree/` (what requirement docs say *should* be built). `50-merged-tree.yaml` is the
deduplicated single-file synthesis. Its own audit rounds self-report real gaps (51% of domains still
have empty `guardrails`, 33% empty `workflow`) rather than claiming completeness.

## 14. Search Before Build

The real, already-enforced "search before build" mechanism is `ai-os/scripts/credit-accountant.py`
(433 lines). Its `check_existing_capability()` function (lines 128-155) calls
`superboss-register.py check-duplicate <search_terms>` (the `system_index` layer, §13) and returns
`found > 0` as a hard rejection reason (line 276: `verdict, reasoning = "rejected", "existing
software/mechanism already covers this (system_index...)"`) — **before any metered AI spend happens**,
with no AI call of its own (module docstring, lines 22-25). It fails closed (halts all metered spend
server-wide on its own failure), unlike most other guardrails in this repo which fail open. This is not
a hypothetical: `ai-os/boss/ACTIVE-CLAIMS.yaml:43-58` records a real incident (task-20260802-231454)
where `credit-accountant.py` rejected a proposed auto-fix retry citing a `system_index` match, and a
separate PM-decision task independently re-verified the rejection was correct.

## 15. Search Order

The real, layered search order this repo already enforces, mapped to this OCID's mandated
function→report→analysis→prompt→implementation ordering:

1. **Fast existence gate** — `system_index`/`credit-accountant.py check_existing_capability()` (§14):
   runs first, before any metered spend, across all categories at once.
2. **Function library** — `src/lib/services/` + `extract-function-catalog.mjs`/`FUNCTION_CATALOG.json`
   (§10).
3. **Report/analysis library** — `reportDefinitions` registry, `status: 'built' | 'planned'`
   (§11-§12).
4. **Existing prompts** — `capability-registry-service.ts`'s `findSimilarCapabilities()`/
   `auditDuplicateCapabilities()` over `prompt_version`/`prompt_pattern` entity types (§29), and
   `prompt-os-resolver.ts`'s versioned/labeled template DB rows (§28).
5. **Existing implementation** — `ai-os/MASTER_INDEX.yaml` narrative index + `ai-os/system-tree/`
   census (§13).

## 16. Rule Based Execution

`guardrail-engine.ts` (§9) is the codebase's real, generic deterministic rule engine — explicitly
"deterministic only" by its own comment (line 41), cited elsewhere in this repo's governance docs as
that exact precedent (`ai-os/boss/ACTIVE-CLAIMS.yaml:1270`). `business-rule-validator.ts:28`
(`assertBusinessRulesBeforeExecution()`) is the pre-execution rule gate, called unconditionally from
`task-execution-engine.ts`'s dispatch path, throwing `BusinessRuleViolationError` via the same engine's
"process" phase. `report-engine-service.ts`'s `deterministic_aggregation`/`deterministic_formula`
execution types (§11) are rule-based execution applied to reporting specifically: a hardcoded,
code-reviewed `TABLE_REGISTRY` for aggregation, and a named pure function in `FORMULA_REGISTRY` (SPI/
CPI/health-index) for formulas — neither ever calls an LLM.

## 17. When Software Completes Work

Software completes work, with zero LLM calls, in exactly these real, already-built paths:

- `classifyExecution()` returns `FULL_SOFTWARE` or a still-trusted `PACKAGE_AVAILABLE` (§9).
- `executeTask()`'s `engineKey` branch — `executeEngineDispatch()` runs a VCEL calculator
  (`task-execution-engine.ts:2149`).
- `executeTask()`'s `workerAgentId` branch — `executeStructuredDispatch()`
  (`task-execution-engine.ts:2164`), server-re-verified against the real worker-agent registry.
- `report-engine-service.ts`'s `deterministic_aggregation`/`deterministic_formula` execution types
  (§11/§16).
- `module-rules-resolver.ts`'s scope-resolution lookups (§9).

## 18. When Software Escalates

Software escalates to AI when none of §17's deterministic paths apply — `classifyExecution()` returns
`NOVEL` (§9), or `executeTask()` falls through to LLM planning because neither `engineKey` nor a
resolved `workerAgentId` is present (§8). Within an AI-handled task, further escalation between AI tiers
is itself deterministic, not judgment-based: `WORKER_ESCALATION_CONFIDENCE_THRESHOLD = 95`
(`src/lib/ai-router/instruction-contract.ts:233`) is the numeric confidence floor for Software Team
levels L1-L3 auto-escalating upward; `levelEscalatesOnConfidenceThreshold()`
(`software-team-ladder.ts:41-43`) restricts this numeric-threshold escalation to L1-L3 only — L4
escalates only on "business conflict beyond technical scope" (line 222), never on confidence alone.
`src/lib/floor-tier-escalation.ts:30` (`detectReaskOrCorrection()`) is a separate, deterministic
regex-based detector that bumps a single reply to a stronger model when a user's next message signals
correction of a floor-tier answer — never overriding an org's own BYO model choice.

## 19. When AI Is Allowed

AI is allowed only after passing a deterministic tier-eligibility gate, never based on the model's own
say-so. `src/lib/model-tier-eligibility.ts` defines three fixed sets, most-restrictive-unless-earned
(lines 6-12): `JUDGMENT_ELIGIBLE = {"z-ai/glm-5.2"}` (lines 28-30, the sole judgment-tier model as of
2026-07-14 per Owner directive); `INTEGRATIVE_ELIGIBLE` (lines 42-48, GLM-5.2 plus several named
models); mechanical tier is open to every model unconditionally (lines 50-52).
`checkTierEligibility(model, tier)` (line 75) is the single, deterministic gate function — no LLM call.
`src/lib/ai-router/mother-router.ts`'s `resolveModel()` (line 594) is the one entry point resolving
provider/model, and it re-gates every resolution through `checkTierEligibility()` (lines 273, 300, 319)
regardless of whether the model came from the roster, a DB policy override, or a tenant's own BYO
config (`resolveTenantAiConfig()`, line 570) — an ineligible tenant model silently falls through rather
than bypassing the gate. `src/lib/purpose-bound-ai.ts:19-72`'s `DOMAIN_ALLOWED_TOOLS` is a second, tool-
level allowlist independent of the model's own system prompt ("belt and suspenders," lines 6-11),
enforced server-side via `isToolAllowedForDomain()` (line 109).

## 20. When AI Is Prohibited

AI is explicitly and structurally prohibited in these real, already-built cases — not merely
discouraged:

- **Software Team L0** ("Software Engine") — `SOFTWARE_TEAM_LADDER` (`software-team-ladder.ts:103`)
  defines L0 with `modelDescription: "No AI"` and `complexityTier: null`; `validateLevelDispatch()`
  (line 277) rejects any attempt to dispatch it via AI, directing callers to
  `task-execution-engine.ts` instead.
- **Three human-only roles** — `founder_ceo`, `executive_advisor`, `super_boss` in
  `src/lib/ai-team/roster.ts` are never dispatched via API, by design.
- **Write actions outside structured dispatch** — `purpose-bound-ai.ts`'s domain allowlists
  deliberately exclude write actions from LLM-auto-dispatch (§19); they are reachable only through
  structured, human-picked dispatch paths.
- **A model that has not earned judgment-tier trust** — blocked from `judgment`-tier work at all three
  real dispatch surfaces (`checkTierEligibility()`, §19; AGENTS.md Rule 10).
- **Claiming an action it did not take** — `src/lib/ai-reply-gate.ts:52-62`
  (`detectFalseActionClaim()`/`passesReplyGate()`) deterministically blocks a VERI Chat reply containing
  a first-person-past-tense high-impact-verb claim ("I have deleted"/"I've approved"), since VERI
  Chat's LLM has no tool-calling capability and such a claim is necessarily a hallucination.
- **Implementation/gap-closure/production-change/completion-certification/platform-freeze work under
  OCID-038/039/040** — locked by `SEC-07` (`ai-os/CONSTITUTION.yaml:652-656`) until OCID-020 is
  independently verified complete. This is an organizational scope gate on *what kind of task* may be
  dispatched at all (AI or human), distinct from this section's runtime AI-invocation gates, and is
  correctly still in force as of this document.

## 21. AI Context Preparation

`src/lib/prompt-os-resolver.ts:47` (`resolvePromptTemplate()`) replaces every hardcoded system-prompt
string with a versioned, labeled DB row (`promptTemplates`/`promptVersions`), throwing loud on a missing
template/label rather than silently falling back to a stale one (lines 33-37). It appends a
`VERI_PERSONA_DIRECTIVE` suffix (line 26) and, for a known locale, a language directive
(`ai-response-locale.ts`) — additive only, never overriding a template's own output-format requirement.
`src/lib/prompt-normalizer.ts` (§7) strips filler phrases before the call. `src/lib/prompt-compiler/`
(29 files, ~7 stages: entity-variable-extraction → intent-classifier → context-assembly →
prompt-construction → prompt-optimizer-expansion → prompt-similarity → prompt-ranking-recommendation →
confidence-engine → verification-pipeline) composes these stages with measured latency budgets (§34).
Grounding is enforced at the data layer, not just the prompt layer: `report-engine-service.ts`'s
`ai_recipe` execution type's only inputs are real, already-queried data — never invented figures — via
`resolveModelConfig()` + `callLLMJson()` + `recordOrchestraExecution()` + `enforcePolicy()` (lines
71-75).

## 22. AI Response Validation

Four real, independent validators run on AI output before it reaches a user or an execution path:
`src/lib/claim-verification.ts:52-58` (Tier-1 hallucination check — extracts backtick-quoted file-path/
function-reference claims and greps them against the real repo on disk, `LOW_CONFIDENCE_SCORE_THRESHOLD
= 0.5` flags for review rather than auto-blocking); `src/lib/ai-reply-gate.ts:62`
(`passesReplyGate()` — empty-reply check, `MAX_REPLY_CHARS = 8000`, false-action-claim detection, §20);
`src/lib/communication-guardrails.ts` (pre-send checks on VERI-drafted communications: valid recipient
email regex, non-empty subject/body, `FALSE_COMPLETION_PHRASES` blocking a draft claiming to already be
sent — the file's own header honestly documents what it does *not* catch: impersonation, escalation-
without-approval, since no deterministic signal exists for those); and
`guardrail-registrations.ts`'s `task_execution.qa_precompletion` leaf (`qa-precompletion-gate.ts`).

## 23. Software Validates AI

Validation is layered pre- and post-execution, not a single step. Pre-execution:
`business-rule-validator.ts:28` (`assertBusinessRulesBeforeExecution()`) runs unconditionally from
`task-execution-engine.ts`'s dispatch functions, before an AI-proposed action is allowed to execute.
Post-execution: a `dispatch-output-validator.ts` NaN/Infinity check on numeric AI output (cited
alongside `business-rule-validator.ts` as the pre/post pair). §22's four validators run in between.
None of these validators themselves call an LLM to judge another LLM's output — every one is
deterministic regex/lookup/structural logic, consistent with `guardrail-engine.ts`'s own
"deterministic only" precedent (§9, §16).

## 24. Software Executes AI Result

Once an AI-proposed result passes §23's gates, software — not the model — performs the actual write.
`executeStructuredDispatch()`/`executeEngineDispatch()` (§8/§17) are the real execution functions;
an `ai_recipe` report result is written into the `reportDefinitions` execution path by
`report-engine-service.ts`'s dispatcher, not by the model directly. This mirrors §20's point: the model
never claims to have taken an action — software takes the action after validating the model's proposal,
and `ai-reply-gate.ts` exists specifically to catch a model that (incorrectly) claims otherwise.

## 25. AI Result Audit

Every model resolution is logged, fire-and-forget/non-fatal, to `platform.ai_routing_audit_log` via
`logRoutingDecision()` (`mother-router.ts:207-224`). The Software Team Instruction Contract/Execution
Report pair is separately persisted per `task_id` in `platform.task_register`
(`task-register-service.ts`, `registerInstructionContract()`, fail-open). CI enforces that a judgment-
requiring dispatch got an independent audit verdict at all (not that the verdict was rigorous) via
`.github/workflows/mandatory-audit-check.yml`, gated by `requiresMandatoryAudit()`
(`model-tier-eligibility.ts:71-73` — true for every model except GLM-5.2), per AGENTS.md Rule 10.
`ai-os/CONSTITUTION.yaml`'s `SEC-02` ("full AI-decision traceability") is the governing constitutional
rule this section implements in code.

## 26. AI Result Traceability

`src/lib/explainability/ai-decision-explanation.ts:27-42` defines a shared `AiDecisionExplanation`
envelope (summary/reasoning/recommendedAction/confidence/rejectedAlternatives/assumptions/
businessImpact) that converter functions populate from each real producer's own fields — never
fabricating a field the source row doesn't have. AI-driven converters (`explainCrmLeadDecision()`,
`explainCrmOpportunityDecision()`, lines 50/69) return `null` rather than inventing a reasoning string
when none exists. `explainTaskPrediction()` (line 97) is the module's one deterministic (non-AI)
example, and its "reasoning" honestly names the real historical-average method rather than describing
AI judgment — i.e. this shared shape already distinguishes AI-attributed from software-attributed
explanation content, which is directly relevant precedent for any future cross-brand explanation
surface.

## 27. AI Result Reuse

`promoteAiAnalysisToDefinition()` (`report-engine-service.ts:1667-1697`) is the real, already-built
"AI made it once, software runs it from then on when possible" mechanism: an ad-hoc AI report-builder
proposal is promoted into a real `reportDefinitions` row, `deterministic_aggregation` if it reduces to a
simple group-by the engine can run without AI next time, `ai_recipe` otherwise (still reusable as a
saved, versioned definition even when it keeps calling AI). `report-taxonomy.ts`'s
`ai_new_report_promoted`/`ai_new_analysis_promoted` categories are the taxonomy values marking this
promotion path. §9's `PACKAGE_AVAILABLE` bucket (`software-coverage-service.ts`) is the equivalent reuse
mechanism for AI-generated instruction packages more broadly, demoted back to `NOVEL` if its tracked
success rate drops below 70%.

## 28. Prompt Standardization

`resolvePromptTemplate()` (`prompt-os-resolver.ts:47`, §21) is the real standardization mechanism: every
system prompt is a versioned, labeled DB row, not a hardcoded string scattered across call sites — the
same "VERI Assistant Mother Router migration" workstream named in §4 is explicitly the effort to finish
moving the remaining unmigrated call sites onto this standardized path.

## 29. Prompt Library Reuse

`src/lib/services/capability-registry-service.ts` indexes `prompt_version` and `prompt_pattern` as two
of 6 `CAPABILITY_ENTITY_TYPES` in a shared embeddings store. `findSimilarCapabilities()`/
`auditDuplicateCapabilities()` are the real duplicate-prompt detection functions, explicitly built (per
the file's own header) to prevent "a parallel embedding store for prompts" — real duplicate-prevention,
though scoped within compliance-tracker today, not yet shown wired cross-repo. `src/lib/prompt-compiler/prompt-portability.ts`
(`adaptPromptForProvider()`) is a related but distinct mechanism — reshaping one already-compiled prompt
for OpenAI/Anthropic/Google/Groq/Cerebras/OpenRouter request shapes (provider portability, not
duplicate-detection); it never calls a provider itself.

## 30. Global Function Reuse

Real mechanism: §10's `extract-function-catalog.mjs` generator plus `system_index`/`MASTER_INDEX.yaml`
querying (§13-§15) is how a new task should discover whether a needed function already exists in
`src/lib/services/` before writing one. **Honest gap:** `FUNCTION_CATALOG.json` and the VCEL
247-function registry file were not found on disk in this checkout during discovery for this document —
only the generator scripts were found; the catalog itself appears to be regenerated on demand or live
server-side outside this git checkout, not committed.

## 31. Global Report Reuse

Real mechanism: the `reportDefinitions` registry itself (§11) is queryable by `status`
(`'built' | 'data_gap' | 'planned'`) and `category`/`classifications` — a new report request should
query this table before creating a new definition, exactly as `promoteAiAnalysisToDefinition()` (§27)
already does automatically for AI-originated proposals.

## 32. Global Analysis Reuse

Real mechanism: identical to §31 — "analysis" shares the same `reportDefinitions` table and dispatcher
(§12), so global analysis reuse and global report reuse are, today, the same real mechanism, not two
separate ones.

## 33. End User Response Generation

A generated response passes through §22's validators (`passesReplyGate()`, `communication-guardrails.ts`)
before rendering, and §7's `ai-response-locale.ts` locale directive is applied additively at generation
time. `VeriChatPanel.tsx`/`VeriComposer.tsx` render the validated result; no separate "response
generation" component exists outside the model-call → validate → render pipeline already described in
§21-§24.

## 34. Performance Target

The only real, measured performance targets found in this discovery are in
`src/lib/prompt-compiler/pipeline.ts:1-16` — Layer 2-5 prompt-compiler stages carry explicit latency
budgets (15ms/25ms/30ms/30ms), and the pipeline is deliberately synchronous and DB-free so it stays
unit-testable. `software-coverage-service.ts`'s `MIN_ACCEPTABLE_SUCCESS_RATE = 70` (§9/§27) is a real
reuse-quality target, not a latency target. No repo-wide, single "AI escalation performance target" (a
top-line SLA number) was found as an existing artifact during this discovery — this is an honest gap,
not a claimed target this document is inventing; any such number should be set as a follow-on decision
by whichever OCID owns platform-wide performance/SLA definition, grounded in the two real numbers cited
here.

## 35. The Zero Duplication Rule

The real, already-enforced mechanism is `credit-accountant.py`'s fail-closed rejection (§14), backed by
`MASTER_INDEX.yaml`'s explicit "read this file first" protocol (§13) and `capability-registry-service.ts`'s
`auditDuplicateCapabilities()` (§29). `report-engine-service.ts`'s own header is direct textual evidence
this rule is already applied in practice, not just documented: it replaced ~150 previously bespoke,
duplicative report functions with one registry and one dispatcher (§11). This document itself follows
the same rule — every section above cites and extends real, existing mechanisms; none proposes a new
library, engine, or prompt system.

## 36. AI Escalation Summary

Tying §1-§35 into one real, as-built flow:

```
End-user input (chat message / mode pill / Chain Selector pick / voice-ticket / attachment)
  -> normalized (prompt-normalizer.ts / Chain Selector path expansion)               [§1-§7]
  -> createTask() deterministic gates (chain-depth, high-impact confirm)             [§8]
  -> classifyExecution(): FULL_SOFTWARE | PACKAGE_AVAILABLE | NOVEL                  [§9]
       |
       |-- FULL_SOFTWARE / PACKAGE_AVAILABLE (>=70% success rate)
       |     -> executeEngineDispatch() / executeStructuredDispatch() /
       |        deterministic_aggregation|formula                                    [§17]
       |     -> response rendered, zero LLM calls                                    [§33]
       |
       `-- NOVEL
             -> search-before-build (system_index -> function lib -> report/analysis
                lib -> prompt lib -> implementation index)                           [§13-§15,§30-§32]
             -> checkTierEligibility() resolves an allowed model (mechanical /
                integrative / judgment), never bypassed by policy or BYO config      [§19-§20]
             -> AI context prepared: resolvePromptTemplate() + normalizer +
                prompt-compiler pipeline, grounded in real queried data only         [§21]
             -> AI proposes a result
             -> software validates: business-rule-validator (pre) + claim-
                verification + ai-reply-gate + communication-guardrails +
                qa-precompletion (post)                                              [§22-§23]
             -> software executes the verified result (model never self-executes)    [§24]
             -> audited: ai_routing_audit_log + task_register + mandatory-audit-
                check.yml                                                            [§25]
             -> traceable: AiDecisionExplanation envelope                            [§26]
             -> reusable: promoteAiAnalysisToDefinition() / PACKAGE_AVAILABLE
                promotion, so the same request is FULL_SOFTWARE or PACKAGE_AVAILABLE
                next time                                                            [§27,§31-§32]
             -> response rendered to end user                                        [§33]
```

Software is always the first decision-maker (`classifyExecution()`), AI never decides system
architecture or creates duplicate implementation (§9, §35), and every AI decision that can become
reusable software already has a real, working path to do so (§27, §31-§32) — this is not a proposed
design, it is the existing, cited runtime.

---

## Non-Goals, Restated

Per this OCID's own directive: no browser design, no PWA design, no database design, no security
design, and no implementation. Any reader looking for those should consult the relevant OCID
(browser: OCID-024; database/security: OCID-020 and `ai-os/CONSTITUTION.yaml`'s security sections).

## Known Honest Gaps Surfaced by This Discovery

These are not this document's failures to design — they are real, pre-existing gaps found while mapping
what already exists, recorded here so a future OCID doesn't have to rediscover them:

1. `VeriComposer.tsx`'s Paperclip button is unwired (§6) — reuse `GlobalChatDock.tsx`'s working flow.
2. `TaskDocumentScreen.tsx` (§4) does not exist yet; it is a pending direction, not built runtime.
3. Voice input has no live in-composer dictation control (§5) — only a record → transcribe → review tab.
4. `FUNCTION_CATALOG.json` and the VCEL function registry file were not found committed on disk (§30) —
   only their generator scripts were.
5. No single, top-line "AI escalation performance target" SLA exists as a real artifact today (§34).
6. A true cross-brand shared library ("all future brands reuse") is aspirational, not built — today's
   real multi-brand model is separate repos (PROJEXA, veda-advisors) consuming compliance-tracker's
   backend via API, not a shared library artifact (`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`,
   "Multi Brand — ~15%").

---

Canonical artifact created: this file. Amends the existing UMR chain
(`ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md`); does not start a new one. Does not implement anything;
does not modify `src/`, schema, or CI beyond the mandatory `ai-os/OS.yaml` index-coverage entry this
file's own existence requires (`scripts/check-metadata-index-coverage.mjs`).
