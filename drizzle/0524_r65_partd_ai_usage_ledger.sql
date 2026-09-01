-- R65 Part D -- AI Usage Ledger schema (2026-09-02). Directive §27 requires
-- an "AI_USAGE_LEDGER" recording every AI call, attributed
-- VERIDIAN -> PRODUCT -> ORGANIZATION -> USER -> TASK -> AI CALL, feeding
-- R65 Part E's Billing Engine (Formula 2 reads from this ledger; Part E
-- cannot design real cost rollups until this schema exists).
--
-- REUSE-VS-BUILD DECISION (checked before writing a single line of DDL):
-- three real candidate tables were read in full before deciding.
--   1. compliance.token_usage_ledger (0093, +0237 cache_savings_usd) --
--      EXTENDED HERE. Already the exact real-money, per-call AI-spend fact
--      table (scope/org/user/role/model/tokens/cost), already the one
--      table getTokenUsageSummary()/getOrgUsageForPeriod()/cost-guard.ts
--      actually read for Finance reporting and billing-period aggregation.
--      Genuinely missing vs directive §27: session_id, chat_id, task_id
--      (FK-worthy, not just free-text task_summary), route_id, veridian/
--      product attribution, escalation level, cache read/write token
--      counts, and the full cost breakdown (input/output/cache/provider/
--      allocated/billable) + subscription-vs-metered cost-type split
--      (§28-29). All of that is additive to an existing row shape -- a
--      second ledger table would fork Finance's single source of truth
--      into two, which is the exact anti-pattern compliance.ai_cost_
--      reconciliations' own header (0518) and this table's own header
--      already reason about avoiding.
--   2. platform.ai_routing_audit_log (write-once resolution log:
--      scope/context/resolved_provider/resolved_model/policy_version/
--      reason) and platform.mother_router_memory (dispatch_id UNIQUE,
--      resolved_role/model, outcome, cost numeric, cross_ref_work_item_id)
--      -- NOT extended. Neither carries token counts or a real cost
--      breakdown, both are Mother-Router-routing-specific (their own
--      headers: an audit trail / a per-dispatch outcome memory for
--      Mother Router to learn from), and Mother Router's own header states
--      it does not rewire the ~35 call sites that call model resolvers
--      directly -- i.e. most of today's real AI calls (team-service.ts's
--      runRole(), chat-service.ts's generateAiReply() via
--      recordPromptCacheMetric(), role-quality-regression-service.ts) never
--      touch either table. mother_router_memory.dispatch_id is instead used
--      below as the documented (soft, not FK-constrained -- see route_id's
--      own comment) join target for the new route_id column, exactly as
--      the R65 Part D Phase 0.5 follow-up recommended.
--   3. compliance.orchestra_executions -- NOT extended (a sibling LLM-call
--      log for the Orchestra Layer path specifically, requires NOT NULL
--      orgId + orchestraLayerId, so it structurally cannot represent
--      platform-internal/no-org AI-Team spend -- see schema.ts's own
--      comment on why token_usage_ledger exists as a separate table at
--      all). Its taskId/durationMs/status columns are the real precedent
--      copied into token_usage_ledger's own task_id/duration_ms/success
--      columns below, per the R65 Part D Phase 0.5 follow-up's own
--      recommendation -- this is "borrow the shape", not "extend the
--      table", since orchestra_executions' NOT NULL org/layer requirement
--      makes it the wrong table for ai_team_internal rows.
--
-- Conclusion: EXTEND compliance.token_usage_ledger (this migration).
-- Purely additive -- every new column is nullable, the 15 existing columns
-- (id, scope, org_id, user_id, role_key, layer_key, task_summary, provider,
-- model, prompt_tokens, completion_tokens, estimated_cost_usd,
-- cache_savings_usd, created_at) are untouched, and RLS is untouched (see
-- rationale at the bottom of this file -- this table's existing
-- service_role-only policy already covers every new column; no new table
-- means no new RLS surface).
--
-- NAMING DEVIATIONS FROM THE DIRECTIVE'S LITERAL §27 FIELD LIST (both
-- deliberate, both to avoid colliding with an existing, semantically
-- different column already in this exact schema):
--   - directive `product_id` -> `veridian_product_id` here. This schema
--     already has a real, unrelated `projects.product_id` (FK to
--     compliance.products -- a client engagement product line, e.g. a
--     construction project's contracted service). The directive's
--     product_id means "which top-level VERIDIAN brand/product" (VERIDIAN
--     AI OS vs PROJEXA vs compliance-tracker, per this session's own
--     'single product, multi-brand' architecture memory) -- a completely
--     different concept. Reusing the bare name would invite exactly the
--     wrong join.
--   - directive `role` -> `ai_role` here. This table already has a real
--     `role_key` column (AI Dev Team roster.ts role, a WHO/job-title
--     taxonomy -- 198 real values). The directive's `role` (§19:
--     READER/EXTRACTOR/CLASSIFIER/REASONER/PLANNER/CODER/REVIEWER/ARBITER/
--     AUTHORITY) is a WHAT-kind-of-cognitive-step taxonomy -- confirmed by
--     the R65 Part D Phase 0 report's own repo-wide grep that these 9
--     literal strings have zero hits anywhere in this codebase today, i.e.
--     a genuinely different, not-yet-built axis. Two separate columns,
--     not a rename or a merge.
--   - directive `cache_write_tokens` -> `cache_creation_tokens` here, to
--     match this exact codebase's own established name for the identical
--     concept (LLMUsage.cacheCreationTokens in llm-client.ts,
--     prompt_cache_metrics.cache_creation_tokens in this same schema) --
--     using the directive's synonym would create a third name for one
--     value.
--
-- WHAT THIS MIGRATION DOES NOT DO (disclosed, not silently skipped):
--   - Does NOT wire R65 Part D Phase 1's escalation-tier catalog
--     (src/lib/ai-router/escalation-tier-catalog.ts) into any dispatch
--     path -- `level` stays a free-text column with zero writers today,
--     exactly like this table's own pre-existing `scope` column
--     convention (documented via comment, not a DB enum/CHECK) -- that
--     wiring is explicitly Phase 6, gated on Owner sign-off, out of scope
--     for this PR.
--   - Does NOT add a cross-schema FK from compliance.token_usage_ledger to
--     platform.mother_router_memory/ai_routing_audit_log for route_id --
--     no cross-schema (compliance.* -> platform.*) FK exists anywhere else
--     in this repo's migration history (checked via
--     `grep -rn "REFERENCES platform\." drizzle/*.sql`, zero hits), and a
--     hard FK would be wrong regardless since most current call sites
--     never populate a Mother Router dispatch_id at all (§6 above).
--   - Does NOT populate provider_cost (true per-call provider-invoice-exact
--     cost) -- compliance.ai_cost_reconciliations' own header (0518)
--     already establishes that OpenRouter/Groq/Cerebras/Anthropic invoices
--     are monthly aggregates with no per-request billing granularity
--     exposed at all; only the existing monthly reconciliation table can
--     ever hold a real actual-invoice figure. This column exists for
--     directive §27 schema completeness (so Part E's cost engine has a
--     column to design against) but will structurally stay estimate-only
--     (input_cost + output_cost) for the foreseeable future, not a
--     provider-confirmed actual.
ALTER TABLE compliance.token_usage_ledger
  -- Attribution chain (directive §27, VERIDIAN -> PRODUCT -> ORG -> USER ->
  -- TASK -> AI CALL). org_id/user_id already exist (0093). None of these
  -- four has any real writer yet -- no source of truth exists anywhere in
  -- this codebase today for "which VERIDIAN brand/product" a call
  -- originated from (confirmed: zero hits for a brand/product-slug concept
  -- across schema.ts and src/lib). Disclosed gap, not silently assumed
  -- solved.
  ADD COLUMN IF NOT EXISTS veridian_id text,
  ADD COLUMN IF NOT EXISTS veridian_product_id text, -- see header: deliberately NOT "product_id", collides with projects.product_id
  -- Dispatch back-references. All three are loosely-typed text, NOT hard
  -- FKs (see header §2/§3): the table a given id resolves against depends
  -- on `scope`, and for `ai_team_internal` rows today there is often no
  -- real chat/pipeline-task/Mother-Router-dispatch at all.
  ADD COLUMN IF NOT EXISTS chat_id text, -- logical ref: compliance.conversations.id / compliance.messages.id, when applicable
  ADD COLUMN IF NOT EXISTS task_id text, -- logical ref: compliance.pipeline_tasks.id for product_orchestra pipeline calls, or a caller-generated run id (e.g. role_quality_runs.id) for ai_team_internal calls
  ADD COLUMN IF NOT EXISTS route_id text, -- logical ref: platform.mother_router_memory.dispatch_id, when the call was actually routed through Mother Router (most calls today are not -- see header §2)
  -- Directive rule #21 ("every AI call has a session_id") -- closes an
  -- already-violated non-negotiable rule independent of the rest of R65D.
  -- No current call site generates or threads a session_id yet; nullable
  -- until one does.
  ADD COLUMN IF NOT EXISTS session_id text,
  -- R65 Part D Phase 1 axis (src/lib/ai-router/escalation-tier-catalog.ts's
  -- AiEscalationTier: PERCEPTION | REASONING | AUTHORITY). Free text, NOT
  -- a Postgres enum and NOT CHECK-constrained -- matches this exact
  -- table's own established convention for its sibling `scope` column
  -- (documented via comment only, see 0093), deliberately not locking a
  -- still-Phase-6-unwired taxonomy into a DB constraint. Zero writers
  -- today by design (Phase 6 is out of scope for this PR).
  ADD COLUMN IF NOT EXISTS level text,
  -- Directive §19 cognitive-step role taxonomy (READER/EXTRACTOR/
  -- CLASSIFIER/REASONER/PLANNER/CODER/REVIEWER/ARBITER/AUTHORITY) --
  -- distinct axis from the existing role_key (AI Dev Team WHO/job-title).
  -- See header for why this is a new column, not a rename. Zero writers
  -- today (taxonomy doesn't exist in code yet, confirmed by the R65 Part D
  -- Phase 0 report's repo-wide grep).
  ADD COLUMN IF NOT EXISTS ai_role text,
  -- Cache token counts (directive rule #24, "cache read/write separately
  -- tracked"). Named to match this exact schema's own prompt_cache_metrics
  -- table and llm-client.ts's LLMUsage type (cacheCreationTokens), not the
  -- directive's "cache_write_tokens" synonym -- see header. Populated at
  -- write time by this PR's own token-usage-service.ts change for the one
  -- call site that already computes both (prompt-cache/metrics.ts's
  -- recordPromptCacheMetric()); null elsewhere, same "absence means not
  -- attempted" contract as prompt_cache_metrics.cache_read_tokens.
  ADD COLUMN IF NOT EXISTS cache_read_tokens integer,
  ADD COLUMN IF NOT EXISTS cache_creation_tokens integer,
  -- Full cost breakdown (directive §27/§30). input_cost/output_cost are
  -- REAL, populated at write time by this PR's llm-client.ts
  -- estimateCostBreakdownUsd() (same MODEL_PRICING table as the existing
  -- estimated_cost_usd, just not pre-summed) for every model already
  -- present in MODEL_PRICING -- an accuracy improvement over the single
  -- blended estimated_cost_usd figure, not a placeholder. The remaining
  -- four are genuinely Phase 8 (Cost Engine, R65 Part E) work and are
  -- NOT populated by this PR:
  --   - cache_cost: needs the cost-type-aware reconciliation Phase 8 does
  --   - provider_cost: see header §3 -- architecturally can't be a
  --     per-call actual figure with today's provider invoicing
  --   - allocated_cost / billable_cost: rollup outputs of the cost engine
  --     itself (VERIDIAN/PRODUCT/ORG/USER/TASK), which doesn't exist yet
  --     and is explicitly Part E's job, not this migration's
  ADD COLUMN IF NOT EXISTS input_cost numeric,
  ADD COLUMN IF NOT EXISTS output_cost numeric,
  ADD COLUMN IF NOT EXISTS cache_cost numeric,
  ADD COLUMN IF NOT EXISTS provider_cost numeric,
  ADD COLUMN IF NOT EXISTS allocated_cost numeric,
  ADD COLUMN IF NOT EXISTS billable_cost numeric,
  -- Cost-type split (directive §28-29). REAL and populated: every current
  -- call site routes through OpenRouter/Groq/Cerebras/a direct Anthropic
  -- API key (never the local claude-cli/Claude-Max-subscription path --
  -- confirmed by grep, providers/claude-cli.ts never calls
  -- logTokenUsage()/writes to this table at all), so 'METERED_API' is the
  -- accurate default for every row this PR's code writes, not a guess.
  -- 'SUBSCRIPTION_ALLOCATED' is reserved for if/when a literal Claude Max
  -- dispatch is ever logged here (R65 Part D Phase 6+ territory).
  ADD COLUMN IF NOT EXISTS provider_cost_type text NOT NULL DEFAULT 'METERED_API',
  ADD COLUMN IF NOT EXISTS subscription_cost numeric, -- only ever relevant for provider_cost_type = 'SUBSCRIPTION_ALLOCATED' rows, which don't exist yet
  ADD COLUMN IF NOT EXISTS allocation_method text,
  -- Latency + outcome. duration_ms is REAL and populated at several call
  -- sites in this same PR (llm-client.ts's callLLM() already centrally
  -- measures wall-clock time into LLMResult.durationMs "for every call, no
  -- caller opt-in required" -- see llm-client.ts's own comment -- this PR
  -- just threads that existing value through to the ledger). Named to
  -- match orchestra_executions.duration_ms, not the directive's "latency",
  -- per the R65 Part D Phase 0.5 follow-up's own recommendation.
  -- success defaults true: every one of this table's 4 real write call
  -- sites today only calls logTokenUsage() after a successful LLM
  -- completion (confirmed by reading each one) -- a caught/failed call
  -- never reaches this insert, so `true` is the accurate default for every
  -- row this PR's code writes, not an assumption. failure_reason is
  -- nullable with no current writer (no call site logs a failure path
  -- yet) -- disclosed gap, real column ready for when one does.
  ADD COLUMN IF NOT EXISTS duration_ms integer,
  ADD COLUMN IF NOT EXISTS success boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS failure_reason text;

-- provider_cost_type CHECK: directive §28-29 names exactly these two
-- literal values as a stable, directive-mandated binary split (unlike
-- `level`/`ai_role` above, which stay unconstrained free text because
-- those taxonomies are still pre-Phase-6/7). Idempotent via the same
-- duplicate_object-tolerant DO block this repo already uses everywhere for
-- new RLS policies (Postgres has no ADD CONSTRAINT IF NOT EXISTS).
DO $$ BEGIN
  ALTER TABLE compliance.token_usage_ledger
    ADD CONSTRAINT token_usage_ledger_provider_cost_type_check
    CHECK (provider_cost_type IN ('SUBSCRIPTION_ALLOCATED', 'METERED_API'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Indexes: task_id/session_id support R65 Part E's per-task/per-session
-- cost rollups (directive §30, blocked on this schema existing at all);
-- provider_cost_type supports the subscription-vs-metered split query
-- Phase 8's cost engine will run constantly once populated. Existing
-- indexes on scope/org_id/role_key/created_at (0093) are untouched.
CREATE INDEX IF NOT EXISTS idx_token_usage_ledger_task_id ON compliance.token_usage_ledger(task_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_ledger_session_id ON compliance.token_usage_ledger(session_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_ledger_provider_cost_type ON compliance.token_usage_ledger(provider_cost_type);

-- RLS: deliberately UNCHANGED. This is an ALTER TABLE on an existing table
-- whose RLS was already enabled by 0093 (service_role_bypass_token_usage_
-- ledger, FOR ALL TO service_role USING (true), no app_runtime policy at
-- all) -- adding nullable columns does not change what a policy needs to
-- cover. Explicitly considered and rejected: this repo's "platform-wide
-- reference table" RLS convention (Pattern A -- RLS enabled+FORCED, a
-- SELECT-only app_runtime_read_all USING (true), see drizzle/0522's
-- header) does NOT apply here -- Pattern A is for shared, owner-edited
-- CONFIG data every org needs to read unfiltered (gst_hsn_master,
-- chunk_policy, platform_billing_plans); this table is real-money FACT/log
-- data, mixing platform-internal rows with no org_id (ai_team_internal
-- scope) alongside per-org rows, which is the exact reason 0093's own
-- header gives for why this table was never given an app_runtime
-- org-scoped policy in the first place -- "a single row can represent
-- platform-internal spend with no org_id at all, which app_runtime's
-- org-scoped policy convention isn't shaped for". compliance.ai_cost_
-- reconciliations (0518), this table's closest sibling by exact same
-- posture (server-side-written financial data, no org_id), makes the
-- identical service-role-only choice. Every real read path today
-- (getTokenUsageSummary, getOrgUsageForPeriod, cost-guard.ts) already goes
-- through the raw service-role `db` client, never an app_runtime
-- session -- so a service-role-only policy has never blocked a real,
-- legitimate read, and opening one now would be a net-new capability with
-- no current caller for it.
