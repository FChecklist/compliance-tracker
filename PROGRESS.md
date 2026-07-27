# PROGRESS -- task-20260727-082615-architecture-phase-9--gateway-knowledge

phase_9_gateway_knowledge_sync_infrastructure (ai-os/VERIDIAN_ARCHITECTURE_V2_PHASE_PLAN_2026-07-25.yaml,
lines 563-607, repo claude-control, target_repo compliance-tracker).

## Completed
- [x] Read governance docs, registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` (pushed
      commit `71a2d67e`). No conflicting active claim found.
- [x] Verified candidate call site: `src/app/api/ai/orchestrate/route.ts` was the strongest
      of the ~22 `resolvePromptTemplate()` callers -- it also independently calls a model
      resolver (`orchestra-model-resolver.ts`'s `resolveModelConfig()`), the exact
      "prompt-execution request whose model-selection step never crosses G05" gap the phase
      names. Confirmed `mother-router.ts`'s `end_user_org` scope existed, fully implemented
      (`computeEndUserOrgResolution`), with **zero real callers anywhere in the repo** before
      this change (grep-confirmed) -- a genuinely dead, uninstrumented gateway scope, not a
      documentation gap.
- [x] Built the real gateway hop (option (b) from SCOPE item 1): `orchestrate/route.ts` now
      calls `resolveModel({ scope: "end_user_org", orgId, layerKey: "task_oa" })`
      (`resolveModel as resolveMotherRouterModel` from `@/lib/ai-router/mother-router`)
      **instead of** calling `resolveModelConfig()` directly. `mother-router.ts` extended:
      - `MotherRouterResolution` gained an optional `resolvedConfig?: ResolvedModelConfig`
        field (end_user_org only) so a caller gets the real, ready-to-call config (apiKey/
        fallback/isCustomerConfigured) through this ONE function, not a second independent
        resolution afterwards.
      - `computeEndUserOrgResolution()` populates it for every branch (BYO passthrough, no
        override, package override with a configured platform key). When a package override
        names a provider with **no** platform API key configured, `resolvedConfig` is
        `undefined` (never silently downgraded to baseline, never a broken config) --
        mirrors `resolveModelConfig()`'s own existing `if (!apiKey) return null` convention.
      - Every real DB write path (the `ai_routing_audit_log` insert in `resolveModel()`) now
        fires for real on this route -- a citable, non-simulated G05 crossing.
      - Added 4 new unit tests for `resolvedConfig` in `mother-router.test.ts` (BYO, no
        override, override+key, override+no-key) -- all pass (30/30 total in that file, plus
        the 2 pre-existing test files touching this code, 35/35, unaffected).
      - `bun x tsc --noEmit` clean; behavior of every pre-existing test (26/26 originally,
        including `software_team`/`sales_marketing`/`customer_success` scopes, untouched)
        still passes unchanged.
      - File:line evidence: `src/app/api/ai/orchestrate/route.ts` (import + call site),
        `src/lib/ai-router/mother-router.ts` (`MotherRouterResolution` type,
        `computeEndUserOrgResolution`, `resolveModel`'s `end_user_org` branch, unchanged).

## Remaining
- [x] Wire capability-intel: registered `capability_registry` row `CAP-20260727-084004-bff8`
      (`capability_name: task_oa`, reusing the real, pre-existing `orchestraLayers.layerKey`
      identifier this call site already passed) via
      `scripts/superboss-register.py register-capability`. `lookup-capability
      --capability-name task_oa` confirms a real exact match.
- [x] Registered the `knowledge_engine` row `KE-20260727-084038-6d5f`
      (`veridian_v2_gateway_knowledge_sync`, tag `domain:veridian_architecture_v2`) via
      `register-knowledge`. `query-knowledge "veridian_v2_gateway_knowledge_sync" --tag
      domain:veridian_architecture_v2` run from `/opt/veridian/repos/claude-control` (the
      exact server path in SUCCESS_CRITERIA) returns `found: 1`. **Both DB writes done
      directly against the live sqlite DB -- no PR needed, per this task's own EXPECTED_OUTPUT
      note that server-side registry writes don't require one.**
- [x] Added `RT-veridian-v2-gateway-knowledge-sync-001` to
      `ai-os/ROUTE_REGISTRY_SCHEMA_2026-07-24.yaml` (claude-control), `hops_through`
      gateway `G05`, `capability_name: task_oa`, full file:line trace + honest gaps in
      its `notes` field. This one IS repo-tracked, so it went through a PR (see below), done
      in an isolated `git worktree` at `/tmp/wt-claude-control/phase9-gateway-knowledge`
      rather than the shared `/opt/veridian/repos/claude-control` checkout -- that checkout
      was found on an unrelated branch (`worker/task-20260727-065831-phase5-litert-spike-
      registration`) with its own uncommitted local changes (`ai-os/CRONTAB_APPROVED_SNAPSHOT.txt`)
      belonging to a different, in-flight session; touching it directly risked exactly the
      "one agent's uncommitted work silently swept into another's commit" failure mode
      AGENTS.md Rule 6 exists to prevent. Re-ran `scripts/generate_wiring_registry.py` from
      that worktree: `grep -q veridian-v2 ai-os/WIRING_ENGINE_REGISTRY_2026-07-25.json` exits
      0, and the new `route-RT-veridian-v2-gateway-knowledge-sync-001` entity real-hops
      through `gateway-G05`, `VERIFIED_MATCH`.
- [x] Explicit named decision on the `PATH_MISSING` drift for `KE-20260725-233806-1d75`
      (`.../compliance-tracker/src/lib/prompt-compiler/pipeline.ts`): confirmed the file is
      real and merged on `main` (present in this task's own workspace checkout, commit
      `605462b2`). The drift is because the SHARED, long-lived checkout at
      `/opt/veridian/repos/compliance-tracker` is stale (on branch
      `docs/cost-control-2026-07-20`, with its own uncommitted local changes from an
      unrelated task/session) -- the cron that used to keep it in sync (`sync-repos.sh`) is
      intentionally disabled (`#STOPPED-ALL-CRON-2026-07-26#`; this task's own CONSTRAINTS
      require every currently-disabled cron/timer to STAY disabled). Decision: do **not**
      force-update or reset that shared checkout to "fix" this -- it would risk destroying
      another session's in-progress uncommitted work and would require re-enabling a cron
      this task is explicitly forbidden from touching. Left as a documented, out-of-scope,
      pre-existing operational gap, not silently ignored -- re-verify via `verify-knowledge`
      once `sync-repos.sh` is ever re-enabled by a session with the authority to do so.
- [x] Both success criteria verified passing (see above).
- [x] Updated `OWNER_ENGINE_TASK2_GAP_ANALYSIS_2026-07-27.yaml`'s three items:
      `engine-capability-intel` upgraded `not_implemented` -> `partially_implemented` (real,
      but scoped to one route); `engine-gateway-integration`/`engine-knowledge-sync` stay
      `partially_implemented` with evidence updated -- rate-limiting/protocol-translation and
      browser-cache sync explicitly NOT touched (CONSTRAINTS). Did **not** recompute this
      file's aggregate `meta.headline_finding` counts (15/47/43) -- that requires
      re-verifying all 145 items in the file, out of this phase's scope; disclosed, not
      silently left inconsistent.
- [x] PR opened against compliance-tracker (code):
      https://github.com/FChecklist/compliance-tracker/pull/588
- [x] PR opened against claude-control (route registry + wiring regen + gap-analysis
      update): https://github.com/FChecklist/claude-control/pull/112
- [ ] Neither PR merged yet by this session (Rule 6 -- no direct push to main/master).
      CI status not yet confirmed green on either; a follow-up session/reviewer should
      check `gh pr checks 588 --repo FChecklist/compliance-tracker` and
      `gh pr checks 112 --repo FChecklist/claude-control` before merging.
- [ ] Confirmed cron/timer state untouched: `sync-repos.sh` and all other entries remain
      under `#STOPPED-ALL-CRON-2026-07-26#` throughout this task (verified via `crontab -l`
      before and did not modify).
# PROGRESS -- task-20260727-065831-architecture-phase-5--browser-execution
# PROGRESS -- task-20260726-063532-fix-pr562-defense-in-depth-integration-g

Fixing the genuine `AUDIT: FAIL` findings on PR #562 (branch
`worker/task-20260726-043023-phase4-defense-in-depth-prompt-security`), pushed
directly onto that same branch per the task's constraints.

## Prior-art review (the diligence step phase_4's own PROGRESS.md skipped)

Read in full before changing anything, per this task's SCOPE item 1:

- `src/lib/policy-enforcement-engine.ts` -- `enforcePolicy()` is the real,
  already production-wired pre-call gate (Wave 46, VERIDIAN_AI_CONSTITUTION.md
  Sec 18). `checkPromptInjection()` is a deterministic regex list for
  instruction-override/jailbreak/exfiltration phrasings -- narrower in
  category taxonomy than the new Layer 1 module, but it's the one every real
  LLM call site (`api/help/ask/route.ts`) already runs before this pass.
- `src/lib/pii-redaction.ts` -- `redactPii()` is the real, already
  production-wired PII scrubber used when logging to `orchestra_executions`.
  Covers GSTIN/PAN/IFSC/Aadhaar (India-specific, this platform's primary
  market) + email + Indian mobile + generic card-shaped digit runs. No US SSN
  pattern.
- `src/lib/ai-reply-gate.ts` -- `passesReplyGate()`/`detectFalseActionClaim()`
  is the software-first gate against a hallucinated "I've already done X"
  claim in the model's reply. Already wired into `api/help/ask/route.ts`.
  Orthogonal to Layers 1-4 (a distinct concern: false action claims, not
  injection/PII/safety) -- left untouched, still runs after Layer 4.

## Decision: reconcile, don't fully replace (SCOPE option (b))

Layer 1's threat-category taxonomy (role_play_jailbreak,
system_prompt_exfiltration, encoding_obfuscation, invisible_unicode,
delimiter_injection) and Layer 4's need for a typed, structured PII match list
are genuinely broader than what enforcePolicy()/redactPii() return on their
own (`PolicyDecision`/plain redacted string) -- a full replace would have
thrown away real, tested capability (red-team-battery.ts and quality-engine.ts
both depend on Layer 1's richer match/category shape). Full reuse (a) wasn't a
clean fit; silent duplication (the original PR's actual bug) wasn't
acceptable either. So: reconcile, explicitly, in code, not just in a comment:

- **Layer 1** (`layer1-input-sanitization.ts`): `classifyDeterministic()` now
  calls `checkPromptInjection()` from policy-enforcement-engine.ts as a floor
  check -- if the existing production gate would block something this
  module's own THREAT_PATTERNS missed, that's now added as an
  `instruction_override` match instead of the two lists silently diverging.
  Existing pattern list unchanged (still covers the categories
  checkPromptInjection() doesn't attempt).
- **Layer 4** (`layer4-output-filtering.ts`): `scrubPii()` now delegates
  directly to `pii-redaction.ts`'s `findPii()`/`redactPii()` (new: `findPii()`
  added there, refactored to share one code path with `redactPii()` so the two
  can never disagree) instead of maintaining its own divergent
  EMAIL/PHONE/CREDIT_CARD/SSN regex list. This closes the real regression the
  audit found (zero GSTIN/PAN/IFSC/Aadhaar coverage) and adds only the two
  categories pii-redaction.ts genuinely doesn't cover on top: US SSN, and
  US-format phone numbers (pii-redaction.ts's PHONE pattern is India-only).
  `PiiMatch`'s type union extended (types.ts) to include GSTIN/PAN/IFSC/
  AADHAAR. Redaction token format changed from `[REDACTED_X]` to
  `[REDACTED:X]` to match pii-redaction.ts's own convention -- tests updated.

## Layer 3 fail-open bug (SCOPE item 4)

`evaluateWithLlamaGuard()` (layer3-runtime-guardrails.ts) already documented
"throws rather than fails open" as its contract -- the real bug was that
`defense-in-depth.ts`'s orchestrator caught that throw and silently defaulted
the verdict to permissive `safe: true`/`null`, contradicting the module's own
docstring. Fixed: both the input-side and output-side Llama Guard calls now
fail CLOSED on a network/API error (`categories: ["LAYER3_UNAVAILABLE"]`,
`blocked: true`) with an explicit `console.error` log, instead of silently
proceeding as if the guard had cleared the content. As a side effect, an
actually-unsafe (not just unavailable) output-side verdict now blocks the
reply too -- previously computed but never acted on.

## Wiring (SCOPE item 3)

`src/app/api/help/ask/route.ts` -- the one real LLM call site in the repo --
now calls `runDefenseInDepth()` instead of `callLLM()` directly. Extended
`DefenseInDepthOptions` with optional `llmOptions`/`fallback` (forwarded to
the real `callLLM()`) and `DefenseInDepthResult` with `usage: LLMUsage | null`
so this migration doesn't lose the route's existing
`enablePromptCache`/`fallback`/cost-tracking behavior. `groqApiKey` is
`process.env.GROQ_API_KEY ?? null` (the platform's own Groq key -- Llama
Guard/Prompt Guard are always Groq-hosted regardless of which provider the
org's own model resolves to). A `blocked` result now logs
`status: "gated"` to `orchestra_executions` and returns the same
`FALLBACK_ANSWER` the reply-gate-failure path already used.

## Verification

- `grep -rn "prompt-security" src/app/api/help/ask/route.ts` -- 2 matches.
- `grep -rln "policy-enforcement-engine\|pii-redaction" src/lib/prompt-security/` -- 4 files.
- `bun test src/lib/prompt-security/` -- 42 pass, 0 fail.
- `bunx tsc --noEmit` -- 0 errors, whole repo.
- `bun test` (full suite) -- 2071 pass, 0 fail.

## Completed
- [x] Read enforcePolicy()/redactPii()/ai-reply-gate.ts prior art in full
- [x] Reconcile Layer 1 with checkPromptInjection() (cross-check, no drift)
- [x] Reconcile Layer 4 with pii-redaction.ts's findPii()/redactPii() (+ GSTIN/PAN/IFSC/Aadhaar coverage, no regression)
- [x] Fix Layer 3 silent fail-open -> fail-closed + explicit logging (input-side and output-side)
- [x] Wire runDefenseInDepth() into api/help/ask/route.ts (the real call site)
- [x] Update/add tests for the integration + corrected fail-closed behavior
- [x] Full test suite green, tsc clean

## Remaining
- [ ] None -- awaiting fresh audit pass per this task's CONSTRAINTS (not self-merging)
# PROGRESS -- task-20260726-171942-serverless-resource-limit-tradeoff-doc

Implements `phase_5_browser_execution_tiers` from
`ai-os/VERIDIAN_ARCHITECTURE_V2_PHASE_PLAN_2026-07-25.yaml` (repo
claude-control). This phase names 10 browser engines + 2 tech-stack
tables + 2 Owner-directed UI surfaces -- too large for one pass. This is
**increment 1 of N**, checkpointed per this task's own instruction.

## Completed (increment 1)

- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml` -- no collision on this phase/repo area.
- [x] Read `ai-os/VERIDIAN_ARCHITECTURE_V2_PHASE_PLAN_2026-07-25.yaml`'s
      `phase_5_browser_execution_tiers` entry in full, plus PR #72
      (claude-control, still OPEN/rejected) and the Owner directive at
      `/opt/veridian/ai-os/OWNER_DIRECTIVES/BROWSER_NATIVE_END_USER_ARCHITECTURE_2026-07-25.txt`.
- [x] Registered `litert-spike`/`litert-spike-embeddings` in claude-control's
      `ai-os/MASTER_INDEX.yaml` (claude-control PR #111) + knowledge_engine
      (`KE-20260727-071611-3ed0`, `query-knowledge "veridian_v2_browser_execution"
      --tag domain:veridian_architecture_v2` -> found=1).
      **Process note:** this should have landed *before* any engine code in
      this repo, per the phase's own explicit ordering. It landed after the
      first browser-execution source files instead -- caught and corrected
      within this same session rather than left silent. Recorded here per
      this task's own honesty requirement.
- [x] Discovered real, load-bearing prior art *before* writing new UI:
      `src/components/veri-chat/VeriComposer.tsx` already implements BOTH
      Owner-directed input surfaces (Option 1: mode pills + `ChainSelector`
      option chain; Option 2: free-text `discuss` chat) -- so this
      increment wires the browser-native FIRST pass into the *existing*
      composer rather than building new UI, per the Owner's "no new engine
      unless necessary" directive.
- [x] `ai-os/BROWSER_LITE_LLM_TECH_DECISION_2026-07-27.md` -- required
      WebLLM-vs-LiteRT decision: adopt WebLLm for real text-generation Lite
      LLM inference (follow-up, not yet installed); keep LiteRT.js
      unchanged in its real existing vision-classifier role. Full
      justification in the doc.
- [x] `src/lib/prompt-compiler/prompt-hash.ts` (new) + `prompt-construction.ts`
      edit: split `hashContent`/`computeFingerprint` (node:crypto) out of
      `analyzeLightweight`'s file so phase_2's real Layer 2 analyzer can be
      imported unmodified into a browser bundle. Re-exported for zero
      downstream breakage; full existing prompt-compiler suite still green.
- [x] `src/lib/browser-execution/tier-detection.ts` (new) -- real feature
      detection for all 5 document tiers (NPU/navigator.ml, Built-in
      AI/window.ai, Lite LLM/navigator.gpu, Transformers, Server),
      injectable env for testing, honest about what's real vs. absent.
- [x] `src/lib/browser-execution/tier-orchestrator.ts` (new) --
      engine-browser-execution (master orchestrator), engine-model-selection,
      engine-execution-planner, engine-server-escalation (deepen): real
      priority-ordered plan + documented fallback chain +
      `requiresServerEscalation()`.
- [x] `src/lib/browser-execution/client-compile.ts` (new) -- the real
      browser-native FIRST pass, reusing phase_2's `analyzeLightweight`
      (not a duplicate engine).
- [x] `src/app/api/prompt-compiler/execute/route.ts` (new) -- the real
      deterministic SECOND-pass SOFTWARE execution (`requireAuth()`-gated,
      runs phase_2's full `runPipeline`), reporting (not itself triggering)
      Tier-5/G05 escalation need, per the credit-governance reconciliation.
- [x] Wired `runBrowserFirstPass()` into `VeriComposer.tsx`'s existing
      `discuss` (free-text chat) send path -- real, live browser-to-server
      handoff for Option 2, fire-and-forget so the real chat reply path
      (`generateAiReply`, unchanged) never regresses.
- [x] Tests: `src/lib/browser-execution/*.test.ts` (22 tests),
      `src/app/api/prompt-compiler/execute/route.test.ts` (5 tests),
      `e2e/browser-execution-tiers.spec.ts` (new, first Playwright spec in
      this repo -- could not execute locally, missing shared libs for
      headless Chromium in this sandbox, no root available; CI's `e2e` job
      already runs `playwright install --with-deps`).
- [x] **Full suite green:** `bun test` -- 2070 pass, 0 fail, 171 files.
      `bunx tsc --noEmit` (whole repo, `NODE_OPTIONS=--max-old-space-size=4096`
      to avoid an OOM unrelated to this change) -- clean. `bunx eslint` on
      every touched file -- 0 errors (1 pre-existing, unrelated warning in
      VeriComposer.tsx).

## Completed (increment 2)

- [x] Option 1 (mode-pill/option-chain) browser-to-server wiring --
      `dispatchInstruction()` in `VeriComposer.tsx` now also calls
      `runBrowserFirstPass(text)` (guarded on non-empty text, once per send
      -- not once per `expandPathsForSend()`-expanded concrete path, since
      those all share one raw instruction) before its `/api/tasks` POST
      loop. Same fire-and-forget contract as `discuss` mode: never blocks
      or fails real task creation. `runBrowserFirstPass`'s header comment
      updated to describe both call sites instead of only `discuss`.
      Verified: `bunx tsc --noEmit` clean, `bunx eslint` 0 new errors (same
      1 pre-existing unrelated warning), full suite 2070 pass / 1 fail / 1
      error -- the fail+error are both pre-existing and unrelated
      (`roster-overrides.test.ts`'s intentional-throw fallback test and
      `vercel-deployment/route.test.ts`'s `auditLogs` mock-module ordering
      issue), confirmed identical on the pre-increment-2 commit via
      `git stash`.

## Remaining (explicit follow-up, not silently dropped -- future increments)

- [ ] Real WebLLM model install + wiring behind the `lite-llm` tier's
      `gpuAccelerated` branch (tech-decision doc's own follow-up).
- [ ] engine-browser-mcp, engine-browser-function, engine-browser-storage,
      engine-browser-sync (full cache hierarchy is phase_6's scope).
- [ ] engine-browser-worker deepening (pool/SharedArrayBuffer coordination)
      beyond litert-spike's existing single-worker pattern.
- [ ] engine-browser-transformers real Transformers.js model integration
      (only feature-detection shipped this increment).
- [ ] stack-browser-compute / stack-parallelism deepening beyond the tier
      orchestrator shipped here.
- [ ] Remaining phase_5 success criterion ("A real command proving the
      Owner-clarified two-stage handoff end to end... exit 0") is satisfied
      by this increment's route.test.ts + client-compile.test.ts for Option
      2; a full authenticated Playwright e2e of the live composer is
      future scope (this repo has zero authenticated e2e fixtures yet,
      per playwright.config.ts's own header comment).
## Remaining
- [ ] Open PR against `compliance-tracker` (this task's deliverable).
- [ ] (Optional, future work, not this task) Provision a Vercel "Protection Bypass for
      Automation" secret on `veridian-compliance-ai` if a future spot-check needs full
      browser-level page-render verification instead of deploy-health verification.


# PROGRESS -- worker/task-20260726-071400-migration-drift-audit-and-reconciliation (PR #563)

This file is stomped by whichever task last wrote to it on this branch; combined
below are all real narratives merged in rather than dropped, in the order they
landed.

## task-20260726-071400-migration-drift-audit-and-reconciliation (original task)

### Completed
- [x] Root-caused `drizzle/meta/_journal.json` frozen at migration 0000 since
      first commit; found + applied 12 genuinely-missing migrations live
      (0005/0037/0140/0165/0169/0199/0217/0218/0249/0251/0253/0255); rebuilt the
      journal with all 261 real migrations and populated
      `drizzle.__drizzle_migrations` with 261 correct rows.
      Full findings: `ai-os/MIGRATION_DRIFT_AUDIT_2026-07-26.yaml`.

### Remaining
- [x] Opened PR #563.

## task-20260726-081117-fix-pr563-ci---stale-migration-files--do (follow-up, same branch)

### Completed
- [x] Read ai-os/boss/ACTIVE-CLAIMS.yaml + AGENTS.md/CLAUDE.md governance docs.
- [x] Located PR #563 (`gh pr view 563`), branch
      `worker/task-20260726-071400-migration-drift-audit-and-reconciliation`,
      already checked out in another task's worktree -- worked via a local
      branch built on `FETCH_HEAD` of that remote branch instead, then pushed
      straight back to the same remote branch name (never touched the other
      worktree).
- [x] Registered `ai-os/MIGRATION_DRIFT_AUDIT_2026-07-26.yaml` in
      `ai-os/OS.yaml`'s `index.health_and_compliance` section. Verified locally
      (via a temp `js-yaml`/`argparse` node_modules symlink, since `bun` was
      not usable in this sandbox): without the entry the check reports 57
      missing items including this file; with it, 56, and this file is no
      longer in the missing list.
- [x] Read migration `0245_create_platform_schema_compartment.sql` to confirm
      the real relocation target (`ALTER TABLE compliance.dynamic_chains SET
      SCHEMA platform;`), then corrected:
      - `drizzle/0140_wave166_monitoring_tool_health.sql` line 39 ->
        `platform.dynamic_chains`
      - `drizzle/0199_gap_dcmd_rich_schema_slice.sql` (all 7 ALTER TABLE
        lines) -> `platform.dynamic_chains`
      - `drizzle/0253_tenant_ai_config.sql` line 27 `provider ai_provider` ->
        `provider compliance.ai_provider` (confirmed `compliance.ai_provider`
        is the real enum, defined in `drizzle/0004_ai_configurations_and_indexes.sql`)
      Verified via grep: `compliance.dynamic_chains` no longer appears in
      0140/0199; `platform.dynamic_chains` does.
- [x] Fixed PR #563's own `PROGRESS.md` stale `[ ] Open PR` line (PR is
      confirmed open) and documented the CI-fix work there.
- [x] Registered this follow-up task + closed it in
      `ai-os/boss/ACTIVE-CLAIMS.yaml`'s `recently_completed`.

### Remaining
- [ ] Flagged, not fixed (out of scope for this narrow follow-up): Metadata
      Index Coverage Check has a much larger pre-existing gap (56 unrelated
      `ai-os/` files never indexed), already failing on `main` HEAD before
      this PR -- needs real per-file research, not a guessed fix.

## task-20260726-102520-analyze-update--supabase-schema-migratio (later follow-up, PR #567)

### Completed
- [x] Resolved PR #563's then-current CONFLICTING/DIRTY merge conflict
      against main (PROGRESS.md narrative -- took main's more-current side;
      `ai-os/boss/ACTIVE-CLAIMS.yaml` `recently_completed:` list -- kept both
      real sides' entries) via a scratch worktree/branch pushed straight back
      to PR #563's own remote branch. Verified `gh pr view 563 --json
      mergeable` MERGEABLE at that time.
- [x] Re-verified live state matched PR #563's prior fix, no new drift:
      `drizzle.__drizzle_migrations` on compliance-tracker (pcrjmlpuqsbocqfwoxod)
      still 261 rows matching 261 real migration files; projexa
      (evpckeuxgvahguwsaeul) confirmed to still have no `drizzle` schema at
      all (out of scope).
- [x] Re-ran `ai-os/scripts/extract-db-schema-catalog.mjs` against current
      `schema.ts` and regenerated `ai-os/DATABASE_CATALOG.json`: 449 tables /
      124 enums, real growth from the 2026-07-20 baseline (444/124) -- 5
      tables added (crm_activities, crm_campaigns, crm_lost_reasons,
      ops_dev_tasks, tenant_ai_config), 0 removed, 0 enum changes. Opened PR
      #567 for the catalog regeneration.

### Remaining
- [x] Did not merge either PR (#563 or #567) per that task's own CONSTRAINTS.
- Note: the "now MERGEABLE" verification above did not hold going forward --
  subsequent merges to `main` (notably PR #568) touched the same
  `PROGRESS.md`/`ai-os/boss/ACTIVE-CLAIMS.yaml` files again and reintroduced
  the conflict. See the next section.

## task-20260726-115425-resolve-pr563-merge-conflict--supabase-m (follow-up, PR #563 branch)

### Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml` -- confirmed no other active claim
      overlaps PR #563's branch/file scope.
- [x] Confirmed PR #563 (`worker/task-20260726-071400-migration-drift-audit-and-reconciliation`)
      was CONFLICTING/DIRTY against `main`, reintroduced by PR #568 (a later,
      unrelated stale-PR-state correction) touching the same
      `PROGRESS.md`/`ai-os/boss/ACTIVE-CLAIMS.yaml` files after the prior
      session's "resolved -> MERGEABLE" claim (task-20260726-102520) had
      already stopped holding.
- [x] Merged `origin/main` into PR #563's existing branch, in its existing
      worktree (`/opt/veridian/ai-os/tasks/task-20260726-071400-.../workspace`)
      -- did not create a duplicate worktree, did not touch any other task's
      checkout.
- [x] Resolved both real conflicts:
      - `PROGRESS.md` -- combined every prior task's real narrative on this
        branch instead of dropping either side.
      - `ai-os/boss/ACTIVE-CLAIMS.yaml` -- union-merged both sides'
        `recently_completed` entries (same pattern used repeatedly on this
        file this session), plus added this task's own entry.
- [x] While validating the merged YAML (`python3 -c "import yaml;
      yaml.safe_load(...)"`), found the parse still failed on a
      **pre-existing bug already on `main`**, unrelated to this merge: 3 list
      entries (2026-07-19/07-21 claims) and 5 `scope_note:` keys were
      mis-indented by 2 spaces, going back as far as the 2026-07-20 V2-7
      entry. Fixed via whitespace-only re-indentation (verified via a Python
      script operating on exact line ranges, no content altered) -- file now
      parses (75 `active` + 65 `recently_completed` entries).
- [x] Verified live, read-only (no DDL/migration executed, per CONSTRAINTS):
      `SELECT COUNT(*) FROM drizzle.__drizzle_migrations` on compliance-tracker
      (project `pcrjmlpuqsbocqfwoxod`, via Supabase MCP `execute_sql`) still
      returns 261 rows, matching PR #563's original fix -- no drift.
- [x] Pushed the resolved merge commit (`d6ceb270`) directly to PR #563's
      existing branch. Did not open a new PR, did not merge PR #563.
- [x] Updated PR #563's body (via `gh api ... -X PATCH -F body=@...`, since
      `gh pr edit`/`gh pr view` both hit an unrelated GitHub GraphQL
      Projects-classic deprecation error / silent line-truncation
      respectively) with the conflict-resolution summary and the live
      verification result.
- [x] Confirmed `gh pr view 563 --json mergeable -q '.mergeable'` -> `MERGEABLE`.

### Remaining
- Note: this "resolved -> MERGEABLE" state did not hold going forward either --
  `main` advanced further (PR #568's merge, then PR #569's merge, the latter
  itself a `PROGRESS.md`-only record of this exact re-resolution) and
  reintroduced the same `PROGRESS.md` conflict again. See the next section.

## task-20260726-154338-resolve-pr563-conflict-properly--v2--exp (this task)

### Completed
- [x] Re-confirmed PR #563 was CONFLICTING/DIRTY again against current `main`
      (tip `7d8c6f28`, after PR #568 and PR #569 both merged).
- [x] Cloned PR #563's real branch directly (no local rename/alias) and
      merged current `origin/main` into it. Only `PROGRESS.md` conflicted this
      time (`ai-os/boss/ACTIVE-CLAIMS.yaml` auto-merged cleanly).
- [x] Resolved the conflict by combining every prior task's real narrative on
      this branch (rather than picking one side and dropping the other),
      appending this section for the current re-resolution.

### Remaining
- [ ] Push this merge commit directly to
      `worker/task-20260726-071400-migration-drift-audit-and-reconciliation`.
- [ ] Confirm `gh pr view 563 --json mergeable -q '.mergeable'` -> `MERGEABLE`.

## task-20260726-171129-tier2-fix--pr-563-migration-drift-ci-fai (this task)

Dispatched off task-20260726-071400's own `review.json` (AUDIT: REJECT),
which found 2 real, still-open defects after the 08:17 follow-up fix above.

### Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml`, registered this task's own claim.
- [x] Re-verified both disclosed defects: issue 1 (missing
      `ai-os/OS.yaml` index entry for `MIGRATION_DRIFT_AUDIT_2026-07-26.yaml`)
      and issue 2 (stale `compliance.dynamic_chains`/unqualified `ai_provider`
      in migrations 0140/0199/0253) were **already fixed** on this branch by
      the 08:17 follow-up commit (`9288746`, task-081117) -- confirmed via
      `git show` diff, not just the commit message.
- [x] Re-ran `gh pr checks 563`: `Metadata Index Coverage Check` and
      `audit-check` were still both FAILING despite that. Root-caused why:
      the check fails not because of either disclosed defect, but because of
      the **56-file pre-existing `ai-os/OS.yaml` index drift** that
      task-081117 had already found and explicitly deferred ("flagged for a
      follow-up task rather than bulk-registered with unresearched
      descriptions"). Confirmed this drift is real and pre-existing on `main`
      itself, independent of PR #563's diff, by running the exact same check
      script (`node scripts/check-metadata-index-coverage.mjs`, after
      installing a local `js-yaml@4.3.0` since `bun` is unavailable in this
      sandbox) against a clean `git worktree` of `origin/main` HEAD
      (`7d8c6f28`) -- identical 56-item failure list there too.
- [x] Since the task's SUCCESS_CRITERIA requires this named check to pass,
      and since leaving 56 real governance files/dirs permanently unindexed
      isn't a defensible steady state either, did the deferred research: read
      each of the 56 files' own header/docstring (all had one) and added a
      real, honestly-derived one-line `covers` entry for each to
      `ai-os/OS.yaml` (two new sections, `reference_docs_and_catalogs` for
      14 top-level docs/catalogs and `operational_scripts` for 39 scripts +
      1 directory under `ai-os/scripts/`, plus
      `ai-os/registry/terminology-guardrail-exemptions.yaml` into the
      existing `health_and_compliance` section) -- no fabricated
      descriptions, no bulk copy-paste of a single reason across unrelated
      files.
- [x] Verified locally: `node scripts/check-metadata-index-coverage.mjs` ->
      `Metadata Index Coverage Check passed -- all 101 governance items
      accounted for (102 indexed, 3 exempted).` Also verified
      `ai-os/OS.yaml` still parses (`python3 -c "import yaml; ..."`).
- [x] Did NOT touch `audit-check`: that gate requires an independent
      `AUDIT: PASS` PR comment per AGENTS.md Rule 7(c) (whoever did **not**
      implement a fix must be its auditor -- no self-certification) and Rule
      10's real CI enforcement of that norm. This session is the one that
      just made the fix, so it cannot also be the auditor without violating
      that explicit, CI-enforced rule -- this is analogous to, and left
      alone for the same reason as, the SPEC's own "issue 3" (live-DDL
      governance) carve-out. A separate agent/session (or the Owner) needs
      to review this diff and post a real structured `AUDIT: PASS` (or
      `FAIL`) comment before that check can legitimately go green.

### Remaining
- [ ] Independent audit of this fix + a resulting `AUDIT: PASS` PR comment
      from a different agent/session (not this one) -- required before
      `audit-check` can pass without violating Rule 7(c)'s no-self-
      certification norm.
- [ ] PR #563 merge itself -- explicitly out of scope for this task
      (CONSTRAINTS: "Do not merge the PR yourself").

## Note for future sessions
`gh pr view <n> --json body -q '.body'` and `gh show <ref>:<path>` for large
files were observed silently truncating output in this sandbox (per-line
~120-char cutoff with a literal `...`, and whole-file cutoffs respectively) --
use `gh api repos/<owner>/<repo>/pulls/<n> --jq '.body'` and
`git cat-file -p <blob-sha>` instead when the content matters. Likely the
`snip` shell-output filter (see `ai-os/boss/ACTIVE-CLAIMS.yaml`'s snip
integration entries) intercepting recognized "verbose" commands, not a
general/silent corruption of file writes made directly by tools (Write/Edit)
or by Python's own `open()/write()`.

Also note: a "resolved -> MERGEABLE" verification is only true at the moment
it's taken. Every merge to `main` that touches `PROGRESS.md` or
`ai-os/boss/ACTIVE-CLAIMS.yaml` reintroduces this conflict on PR #563's
long-lived branch. This has now recurred at least four times
(task-102520, task-115425, task-171129 (this task, before this section), and
now again via PR #572's merge to `main` while resolving this same conflict
yet again). Whoever actually merges PR #563 should do so promptly after the
next MERGEABLE confirmation rather than leaving it open indefinitely.

## task-20260726-171129-tier2-fix--pr-563-migration-drift-ci-fai (this task, continued -- re-resolving conflict reintroduced by PR #572)

### Completed
- [x] After pushing the 56-file `ai-os/OS.yaml` index backfill (commit
      `eafa1b63`) and closing this task's claim (commit `fa4ba6f9`), found
      PR #563's branch CONFLICTING again against `main`: PR #572 (an unrelated
      task, `task-20260726-171200-tier2-fix--pr-566-pr-83-...`) merged to
      `main` and touched this same `PROGRESS.md` file again.
- [x] Merged `origin/main` into this branch; only `PROGRESS.md` conflicted
      (`ai-os/boss/ACTIVE-CLAIMS.yaml` auto-merged cleanly this time).
      Resolved by keeping this branch's full narrative and appending
      PR #572's task section below (rather than dropping either side),
      matching the established pattern on this file.

### Remaining
- [x] Push this merge commit to
      `worker/task-20260726-071400-migration-drift-audit-and-reconciliation`
      (commit `5890fc78`).
- [x] Re-confirmed `gh pr view 563 --json mergeable -q '.mergeable'` ->
      `MERGEABLE`.
- [ ] CI re-triggered by this push (`gh pr checks 563`) was still `pending`
      across all jobs at push time -- not yet re-verified green. Next
      invocation should re-check `gh pr checks 563` once the run completes.
- [ ] Independent audit / `AUDIT: PASS` comment (per Rule 7(c)) and PR #563's
      own merge remain out of scope for this task, as noted above.

## task-20260726-171200-tier2-fix--pr-566-pr-83-stale-pr-81-stil

# PROGRESS -- task-20260726-171946-chat-context---terminology---mode-pill-a

V2-13-CHAT-CONTEXT-ANALYTICS -- Chat context + terminology + mode-pill analytics.
Claim registered in `ai-os/boss/ACTIVE-CLAIMS.yaml`.

# PROGRESS -- task-20260727-073319-fix-pr562--enforce-output-side-llama-gua (PR #562, round 2)

Round 2 fix for PR #562, continuing directly on the existing
`worker/task-20260726-043023-phase4-defense-in-depth-prompt-security` branch
(checked out via `origin/<branch>`, not a new branch). The real audit found a
genuine defense-in-depth enforcement gap in
`src/lib/prompt-security/defense-in-depth.ts`: `layer3.outputGuard` (Llama
Guard verdict on the model's actual output) and `layer4.leakedSystemInstruction`
(verbatim system-prompt-leak detection) were both computed but never enforced.

## Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml` -- this session's own claim already
      present (`task-20260726-043023-phase4-defense-in-depth-prompt-security`),
      no competing claim on this file/scope.
- [x] Read `defense-in-depth.ts` in full. Found `layer3.outputGuard`
      enforcement (block on unsafe verdict, including the fail-closed-on-error
      case) was **already fixed** in a prior round-1 commit (`d55f7e5a`) --
      SCOPE item 1 was already satisfied by existing code, just untested for
      a genuine (non-network-error) unsafe verdict. The real remaining gap
      was narrower than the SPEC's framing suggested: only
      `layer4.leakedSystemInstruction` was truly unenforced (computed at the
      end of the pipeline, then silently ignored -- `blocked: false` and
      `content: layer4.scrubbedText` returned unconditionally).
- [x] Decided block-entirely (not strip-and-continue) for a detected leaked
      system instruction, based on the real pre-call precedent: Layer 1
      classifies a user's *attempt* to exfiltrate the system prompt
      (`system_prompt_exfiltration`) as one of its `HIGH_CONFIDENCE_CATEGORIES`
      -> outright `"malicious"` verdict -> full block
      (`layer1-input-sanitization.ts`'s `HIGH_CONFIDENCE_CATEGORIES`/
      `verdictFromMatches`). The model actually *succeeding* at leaking those
      instructions is at least as severe as a user merely attempting to, so
      it gets the same full-block treatment, not PII-style redact-in-place
      (there is no reliable guarantee every verbatim trace of a leaked system
      prompt has been stripped before the reply is handed back). Documented
      this reasoning directly in `defense-in-depth.ts`'s new code comment.
- [x] Implemented the new block path in `runDefenseInDepth()`: after Layer 4
      computes `leakedSystemInstruction`, if true, return
      `blocked: true, content: "", blockReason: "...leak..."` instead of
      falling through to the normal `blocked: false` return. Updated the
      function's top docstring to describe all block paths (Layer 1 input,
      Layer 3 input/output incl. fail-closed, Layer 4 leak) in one place.
      Did **not** touch Layer 3's fail-open-on-network-error behavior or any
      Layer 1/Layer 2/Quality Engine/Red Team code, per this task's
      CONSTRAINTS.
- [x] Added 2 new tests to `defense-in-depth.test.ts` (new
      `describe("runDefenseInDepth -- output-side enforcement...")` block):
      one mocks a genuine (non-throwing) `unsafe` Llama Guard verdict on the
      model's real output and asserts `blocked: true`/`content: ""` (distinct
      from the pre-existing fail-closed-on-network-error tests, which only
      covered the thrown-error path, not a real unsafe verdict); one mocks
      `callLLM()` returning a reply that verbatim-contains the
      `<system_instructions>` delimiter and asserts `blocked: true` and that
      `<system_instructions>` is absent from the final `content`.
- [x] `bun install` (node_modules was absent in this task's fresh workspace);
      `export PATH="$HOME/.bun/bin:$PATH"` was required for `bun`/`bunx` to
      resolve in this sandbox's shell.
- [x] `bun test src/lib/prompt-security/` -> 44 pass, 0 fail (up from the
      prior round's 42; the 2 new tests both pass).
- [x] `NODE_OPTIONS="--max-old-space-size=4096" bunx tsc --noEmit` -> 0
      errors, whole repo (default heap size OOM'd in this sandbox on the
      full-repo check; raising it resolved that, not a real type error).
- [x] `bun test` (full suite) -> 2087 pass, 0 fail.
- [x] Committed + pushed directly to
      `worker/task-20260726-043023-phase4-defense-in-depth-prompt-security`
      (same PR #562 branch, per this task's EXPECTED_OUTPUT).

## Remaining
- [ ] Independent audit / `AUDIT: PASS` comment (per AGENTS.md Rule 7(c)/
      Rule 10) -- this session made the fix, so it cannot also certify it.
- [ ] PR #562 merge itself -- out of scope for this task.
