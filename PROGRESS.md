# PROGRESS -- task-20260718-083004-cache---synchronization--cache-integrity

Task: VERIDIAN Review Framework gap-closure, "Cache & Synchronization / Cache
Integrity & Security" -- 3 findings, closed together in one PR since all
three are the same module/area (server-side LLM response cache +, for the
offline finding, a genuinely new but small client-side shell).

Per the task's own instruction: read the real current implementation of
each area FIRST, before assuming the gap-analysis wording still holds.

## Completed

- [x] **[High] Cache Security & Encryption** -- Gap confirmed real:
      `src/lib/llm-response-cache.ts`'s `content` column was stored as
      plaintext. Fixed by reusing the existing pgcrypto (`pgp_sym_encrypt`)
      helper `src/lib/ai-config-crypto.ts` already provides for BYOK
      provider API keys and `erp-vendor-master-service.ts` already uses for
      vendor bank account numbers -- this file is a third caller of that
      established primitive, not a new encryption scheme. No real KMS
      integration exists anywhere in this codebase to "evaluate" (grepped:
      zero aws-sdk/@aws-sdk/client-kms in package.json), so the honest scope
      here is VERIDIAN's existing at-rest mechanism, not inventing a second
      one. A decrypt failure (legacy plaintext row / rotated key / corrupt
      ciphertext) is treated as a cache miss, never a thrown error -- see
      the file's own header comment for the full reasoning.
      Files: `src/lib/llm-response-cache.ts`.
- [x] **[Medium] Automatic Cache Invalidation** -- Gap confirmed real: one
      hardcoded module-level 24h TTL, no per-call control. Per the finding's
      own recommended approach ("Selective TTL tuning by data volatility",
      not a full event-bus), added `CACHE_TTL` named presets
      (`HIGH_VOLATILITY` 1h / `STANDARD` 24h, unchanged default / `LOW_VOLATILITY`
      7d) and a per-call `ttlMs` option. Re-checked both of today's real
      callers (`orchestrate/route.ts`, `fde-service.ts`) against their own
      already-documented volatility reasoning -- both already fit STANDARD
      and are left on the default rather than given a fabricated override.
      Files: `src/lib/llm-response-cache.ts`.
- [x] Added `src/lib/llm-response-cache.test.ts` -- this module had zero
      test coverage before. Covers: content is encrypted at rest (DB never
      receives plaintext), a decryptable hit round-trips to plaintext for
      the caller, an undecryptable row is a miss (not a throw) and gets
      overwritten, an expired row is a miss even if still decryptable, an
      encryption failure on write never blocks the real LLM response
      reaching the caller, `ttlMs` defaults to `CACHE_TTL.STANDARD` and a
      caller override is honored, and `callLLMJsonCached` has the same
      encryption/TTL behavior as `callLLMCached`. 8 tests, all passing
      (`bun test src/lib/llm-response-cache.test.ts`).
- [x] **[Critical] Offline Cache Support** -- Gap confirmed real and, unlike
      the other two, genuinely unaddressed anywhere: grepped for
      `serviceWorker.register`/workbox/next-pwa/serwist/`public/sw.js` --
      zero hits anywhere in the repo before this change. Investigated the
      two screens the finding's recommended approach names before writing
      anything:
        - `src/app/(app)/fm-register-digitization/page.tsx` is a real page,
          but its actual flow is capture-photo -> upload -> AI-extract, not
          a browsable read-only data screen -- extraction inherently needs
          the network, so the *page itself* isn't a natural offline-shell
          candidate. Its rows-GET endpoint
          (`/api/fm/register-digitization/[batchId]/rows`) is, though, and
          is what's actually cached.
        - "site-diary screens" (plural, in the recommended approach) don't
          exist yet -- there is no `(app)/` UI for construction site diary
          at all, only its service layer + 3 GET/POST API route aliases
          (`/api/construction/site-diary`, `/api/v1/construction/site-diary`,
          `/api/v1/projexa/site-diary`). Rather than skip the finding
          because "the screen doesn't exist" (the underlying Critical gap --
          zero offline support anywhere -- is still real), the read-only GET
          list endpoints are cached now as forward-looking infra, ready for
          whenever a UI lands on top of them.
      Implementation, scoped deliberately to READ-ONLY (per the finding's
      own recommended approach, not a full offline-write rewrite):
        - `public/sw.js` -- new service worker. Cache-first for static
          build assets (`_next/static/*`, logo SVGs, fonts); network-first
          with cache fallback for the allowlisted read-only GET routes
          above (FM rows + all 3 site-diary GET aliases); a static
          `public/offline.html` fallback for a navigation that fails
          offline with nothing cached. Never intercepts a non-GET request.
          Every cached API response is rebuilt with ONLY its JSON body kept
          -- `requireAuth()`'s Supabase server client can attach a real
          session-refresh Set-Cookie header to almost any authenticated
          response (`src/lib/supabase/server.ts`), so caching+replaying the
          raw `Response` would risk leaking a session cookie to a later
          request, possibly from a different signed-in user on a shared
          browser. See the file's own header comment for the full reasoning,
          including why full authenticated-page HTML is deliberately never
          cached (personalized SSR + the same Set-Cookie risk, worse).
        - `public/offline.html` -- zero-JS/CSS-dependency static fallback.
        - `src/lib/use-online-status.ts` -- new `navigator.onLine` hook
          (none existed before, grepped).
        - `src/components/OfflineShell.tsx` -- registers `public/sw.js` and
          renders a visible "you're offline" banner; mounted once, globally,
          from `AppShell.tsx` (same pattern as the existing `HelpWidget`).
        - `src/components/AppTopbar.tsx`'s `handleLogout` now purges all
          Cache Storage entries on sign-out (best-effort, non-blocking) --
          Cache Storage is per-origin, not per-user, so without this a
          second person signing in on the same shared/kiosk browser could
          still see the previous org's cached FM/site-diary data.
      Browser-cache-at-rest encryption is deliberately out of scope for this
      offline shell: the finding's own recommended approach explicitly
      "risk-accept[s] browser cache" and points real encryption effort at
      `llm_response_cache` (closed above) instead -- so no encryption layer
      was added to `public/sw.js`'s Cache Storage usage.
      Not in scope for this wave (documented, not silently dropped):
      queuing/replaying offline *writes* (a materially larger project --
      conflict resolution, delivery guarantees, re-validating multi-tenant
      RLS on replay) is left for a dedicated follow-up; only reads are
      offline-capable now.
      Files: `public/sw.js`, `public/offline.html`,
      `src/lib/use-online-status.ts`, `src/components/OfflineShell.tsx`,
      `src/components/AppShell.tsx`, `src/components/AppTopbar.tsx`.
- [x] Verified no scope collision: `git grep` for any in-flight
      `ai-os/boss/ACTIVE-CLAIMS.yaml` entry touching
      `llm-response-cache.ts`, `fm-register-digitization`, `site-diary`, or
      a service-worker/offline area -- none found. Did not touch
      `src/lib/services/permission-service.ts`'s `ERP_ACTION_ROLES` table or
      add any new permission-service entry -- this gap-closure needed none.

## Verification run

- `bun test src/lib/llm-response-cache.test.ts` -- 8 pass, 0 fail.
- `bunx eslint` on every changed/new file -- clean, no errors or warnings.
- Full-repo `tsc --noEmit` could not complete in this sandbox (JS heap OOM
  on the whole ~400+ table schema graph, unrelated to these changes --
  reproduces on a clean checkout too); relied on the scoped eslint pass plus
  the fact that `bun test` itself type-checks the imported module during
  execution.

## Remaining

- [ ] None for this task's 3 named findings -- all closed. Offline write
      support (queued/replayed mutations) is a real, larger follow-up noted
      above but intentionally not started here.
- [ ] PR #1019 open (https://github.com/FChecklist/compliance-tracker/pull/1019),
      CI running -- confirm green, hand off for independent audit/merge.

## CI fix, round 2 (this session, invocation 16): the round-1 leak fix didn't hold

The prior session's commit `2241988990` claimed to fix a real CI-only failure
(`llm-client.test.ts`'s 4 Anthropic-prompt-caching tests failing only in CI,
never locally) by adding a "capture the real `@/lib/llm-client` module once,
restore it in `afterEach`" pattern to `llm-response-cache.test.ts`, reusing
`tenant-isolation.test.ts`'s established convention (PR #434). Verified this
was **not actually fixed**: re-checked PR #1019's live CI run
(`gh run view` on the HEAD commit's own run, not a stale cached status) --
`Unit Tests` was still failing, with the exact same 4 tests, same error
(`TypeError: undefined is not an object (evaluating 'getBody().system')`,
i.e. `callLLM` never called `fetch` -- proof the leaked stub from
`llm-response-cache.test.ts`'s `setupMocks()` was still what
`llm-client.test.ts`'s own static `import { callLLM } from "./llm-client"`
resolved to, restore-in-`afterEach` notwithstanding).
Root-caused via the real CI job log (`gh api .../actions/jobs/<id>/logs`,
not the truncated `gh run view` summary): `llm-response-cache.test.ts` runs
immediately before `llm-client.test.ts` in CI's real file-discovery order
(confirmed by log line order), and dozens of unrelated files run cleanly
between them -- so the leak isn't "any mock.module() call taints everything
forever," it's specifically that `llm-client.test.ts`'s own static
top-level import of the exact same module still bound to the mocked
version despite the `afterEach` restore call having already run by then.
`mock.restore()` not undoing `mock.module()` is documented; explicitly
re-`mock.module()`-ing back to a captured real reference turned out to be
an unreliable fix for *this* class of leak (a same-file, same-process
static import of the mocked module elsewhere), not just a cosmetic gap --
same honest limitation the `tenant-isolation.test.ts` comment already
flagged ("defense-in-depth... not a locally-provable fix on its own").
Fixed by removing the `@/lib/llm-client` `mock.module()` call entirely:
`llm-response-cache.test.ts` now mocks `globalThis.fetch` instead (the
exact pattern `llm-client.test.ts` already uses on itself), so `callLLM`
runs as real, unmocked code against a fake HTTP response -- zero
module-registry mutation for this dependency, eliminating the leak vector
rather than chasing another instance of it. Verified: isolated run, both
file orders explicitly (`llm-response-cache.test.ts` then
`llm-client.test.ts`, and reversed), and the full local suite (2502
pass/0 new fail -- the 2 pre-existing local-only fails/2 errors are an
unrelated missing `@fchecklist/veridian-ui-kit` package in this sandbox,
confirmed passing in CI's own log for those same tests). `eslint` clean.
Pushed as a new commit on this same branch/PR #1019 -- not a new PR.

## Merge with `origin/main` (this session)

`origin/main` had advanced far past this branch's fork point (an unrelated
`@fchecklist/veridian-ui-kit` shell-component migration had landed,
restructuring `AppShell.tsx`/`AppTopbar.tsx`, plus `durationMs` latency
reporting added to `llm-response-cache.ts`'s cache-hit path) -- PR showed
real `CONFLICTING`/`DIRTY`. Merged `origin/main` in and resolved:
- `src/lib/llm-response-cache.ts`: kept this task's `lookupCache`/TTL
  structure, added the upstream `durationMs: 0` field (with its own
  comment) to the cache-hit return so latency reporting still works.
- `src/components/AppShell.tsx` / `AppTopbar.tsx`: auto-merged cleanly
  (both sides' changes were non-overlapping edits) -- but then caught a
  real gap this merge would otherwise have silently introduced:
  `AppShell.tsx` now branches into two renders (`veriChatV2Enabled` orgs
  use the new shared `AppShellFrame`; everyone else uses the pre-existing
  hand-rolled layout) and `<OfflineShell />` had only landed in the
  legacy branch. Added it to the `veriChatV2Enabled` branch too so the
  offline shell registers for every org, not just the majority path.
- `PROGRESS.md`: kept this task's section on top, appended the full
  `origin/main` accumulated history below unchanged (matches this repo's
  established convention for this file -- see other sessions' notes
  further down in this same file).
- `ai-os/boss/ACTIVE-CLAIMS.yaml`: kept both sides' `recently_completed`
  entries (this task's + `origin/main`'s newer ones), no content lost.
Re-ran `bun test src/lib/llm-response-cache.test.ts` (8/8 pass) and
`eslint` on every touched file (clean) after the merge, before pushing.

---

# PROGRESS -- task-20260805-151445-merge-real-fold-in-closure-pr-for-ocid-0

---

# PROGRESS -- task-20260718-082004-crm---sales-modules--sales-pipeline

VERIDIAN Review Framework gap-closure: CRM & Sales Modules / Sales Pipeline (14 findings).

## Already resolved before this task (verified live, findings were stale)
- `getSalesPipelineOverview()` (crm-service.ts) and the `/api/v1/projexa/sales-pipeline`
  external-API alias were already fully implemented (leadsByStatus, opportunitiesByStage,
  winRate, openPipelineValue, overdue follow-up counts). Not rebuilt.

## Completed
- [x] **Data Model Completeness & Referential Integrity** -- new org-scoped `crm_pipeline_stages`
      config table (drizzle/0313), lazily auto-seeded per org with the 5 pre-existing hardcoded
      stage strings (`listPipelineStages()`), so no data migration/backfill needed and behavior
      is unchanged for every org that hasn't touched pipeline config. CRUD routes under
      `/api/crm/pipeline/stages` (manager-gated). Registered in `asset-registry-coverage.yaml`
      (`registered`, not `exempted` -- has a genuine `label` display-name column).
- [x] **Business Rule & Validation Accuracy** -- `isValidStageTransition()` (pure, unit-tested,
      10 tests) wired into `updateOpportunity()`. A deal can move freely between any two
      non-terminal stages (including backward); moving OUT of a closed (won/lost) stage requires
      manager rank. The UI's plain `<Select>` previously allowed any jump silently.
- [x] **Multi-Tenant / Multi-Project Isolation** -- re-verified: `crm_pipeline_stages` carries
      `org_id` + `FORCE ROW LEVEL SECURITY` + the standard `app_runtime_org_scoped` policy,
      identical to `crm_accounts` (drizzle/0219). No isolation gap introduced.
- [x] **Reporting & Export Accuracy** -- new `sales-pipeline-overview` entry in `REPORT_CATALOG`
      (new `"CRM"` `ReportDomain`, gated to the existing `sales` product branch via
      `report-domain-enablement-service.ts` -- NOT mislabeled as `"ERP"`). CSV export route at
      `GET /api/crm/pipeline/export`.
- [x] **AI Copilot / Worker Agent Integration Depth** -- `getPipelineAiSummary()`, a new
      pipeline-level AI insight ("which deals are at risk this quarter") aggregating across the
      open funnel, following `analyzeOpportunity()`'s existing 6-step orchestration pattern
      (enforcePolicy -> resolveModelConfig -> resolvePromptTemplate -> callLLMJson ->
      recordOrchestraExecution). New `crm_intelligence.pipeline_summary` prompt template
      (drizzle/0313). Ephemeral (not persisted) -- no single entity row to cache it against.
      Surfaced via a "Pipeline Insight" button on the new Kanban tab.
- [x] **Search, Filter & Bulk Operations** -- search box + owner filter on the new Kanban view;
      multi-select + bulk-reassign toolbar wired to the pre-existing `bulkReassignOpportunities()`
      service function via a new native route (`POST /api/crm/opportunities/bulk-reassign` --
      previously only reachable via the external `/api/v1/projexa` alias, zero in-app consumer).
- [x] **Error Handling & Data Validation Messaging** -- illegal stage-transition drags revert
      optimistically and surface the server's real `ServiceError` reason via toast, not a silent
      no-op or generic failure message.
- [x] **Cross-Module Integration Consistency** -- the new Pipeline tab is the first real in-app
      consumer of `getSalesPipelineOverview()`/`listPipelineStages()`, proving out the
      client-side composition the code comment referenced.
- [x] **Notification & Alert Trigger Correctness** -- new `pipeline-stuck-deal-digest-service.ts`
      (mirrors `task-nudge-digest-service.ts`'s exact shape: platform-wide cron, one batched
      notification per deal owner, zero LLM call). "Stuck" = 30+ days in current stage per
      `crm_stage_history`'s latest row for that opportunity. Cron registered in `vercel.json`
      (`45 9 * * *`). `GET /api/crm/pipeline/stuck` surfaces the same list in the UI (badge per
      card).
- [x] **Documentation & In-App Help Coverage** -- the Pipeline tab itself (with inline empty/
      loading states and a labeled AI insight panel) is the documentation surface the finding
      said didn't exist because no UI existed; this PROGRESS.md entry + the code's own header
      comments serve as the technical documentation. No separate user-help article written this
      wave -- flagged as a real gap, not silently dropped (see Deferred below).
- [x] **Data Import/Export Template Fidelity** -- CSV **export** implemented
      (`GET /api/crm/pipeline/export`, includes stage label, value, currency, exchange rate,
      owner, AI win probability). **Import is explicitly deferred** (see below) -- a real
      round-trippable import needs unknown-ownerId/unknown-stage validation and dedup logic that
      is genuinely more scope than fits this wave; noted here rather than silently dropped.
- [x] **Localization Readiness** -- `crm_opportunities.currency_id`/`exchange_rate` columns added
      (drizzle/0313, identical shape to drizzle/0208's fix for `erp_quotations`/
      `erp_sales_orders`). `exchangeRate` defaults to `'1'` so every pre-existing row keeps
      reading as "org base currency, rate 1" -- zero behavior change until an opportunity is
      explicitly given a foreign currency. `getSalesPipelineOverview()`'s aggregates now sum
      `estimatedValue * exchangeRate` (base-currency rollup) instead of naively summing mixed
      currencies.

## Explicitly out of scope / deferred (documented, not silently dropped)
- **Audit Trail & Change History**: `crm_stage_history` already logs every stage/status
  transition (who/when/from/to) for both leads and opportunities -- verified this is real and
  working, so it already IS the pipeline's audit trail for the dimension this finding names.
  Did **not** retrofit the generic `audit_logs` table (via `logActivity()`) onto every existing
  `createLead`/`updateLead`/`createOpportunity` call -- that is a broader "Leads/Opportunities"
  audit-trail completeness fix (create/delete events beyond stage change), not specific to
  Sales Pipeline, and touching that much of `crm-service.ts`'s shared surface risked colliding
  with a concurrently-active session (see `ACTIVE-CLAIMS.yaml`'s CRM Accounts/Contacts RBAC
  entry). Flagged as a real follow-on, not claimed as done.
- CSV **import** for opportunities (see above).
- A dedicated `Reports & Analysis` help article for the new catalog entry.
- Full RBAC pass on `/api/crm/leads`/`/api/crm/opportunities` CRUD routes (currently
  role-unchecked beyond org membership) -- out of the 14 findings this task was scoped to; only
  the one genuinely new action this wave introduces (`crm.pipeline_stages.manage`) got a
  permission-service.ts entry, added additively per the task's own instruction.

## Verification performed
- `bun test src/lib/services/crm-service.test.ts` -- 10/10 pass (isValidStageTransition, all
  branches: forward/backward/no-op/close-from-any-role/reopen-requires-manager/unknown-stage/
  defensive fallback).
- Targeted review of every touched file for type correctness; the new `ReportDomain` value
  ("CRM") required updating 4 `Record<ReportDomain, ...>` exhaustive maps
  (`report-catalog-service.ts` x2, `report-engine-service.ts`, `capability-tree-service.ts`,
  `ReportCatalogList.tsx`) -- all fixed. A full whole-repo `bunx tsc --noEmit` run in this
  sandbox hits an OOM/timeout on unrelated pre-existing files (missing `@types/node` in
  `scripts/`, etc.) even with an increased heap -- inconclusive on a full pass; real CI
  (`bun run build`/lint) is the actual gate and has not run yet as of this checkpoint.
- Not run in this sandbox (no live `DATABASE_URL`): the drizzle/0313 migration itself, and any
  route requiring a live DB. Migration SQL follows this repo's own established, previously-
  applied pattern (drizzle/0219 crm_accounts, drizzle/0208 currency columns) closely enough to
  be low-risk, but has not been executed against a real database by this session.

## Files touched
- `drizzle/0313_sales_pipeline_module.sql` (new migration)
- `src/lib/db/schema.ts` (crmPipelineStages table; crmOpportunities.currencyId/exchangeRate)
- `src/lib/services/crm-service.ts` (pipeline stage CRUD, isValidStageTransition,
  listStuckOpportunities, getPipelineAiSummary, currency-aware overview, stage-transition
  enforcement in updateOpportunity)
- `src/lib/services/crm-service.test.ts` (new)
- `src/lib/services/pipeline-stuck-deal-digest-service.ts` (new)
- `src/lib/services/permission-service.ts` (additive: `crm.pipeline_stages.manage`)
- `src/lib/services/report-catalog-service.ts` (new `CRM` ReportDomain, new catalog entry)
- `src/lib/services/report-domain-enablement-service.ts` (+.test.ts) (CRM -> `sales` branch gate)
- `src/lib/services/report-engine-service.ts` (Record<ReportDomain> exhaustiveness)
- `src/lib/services/capability-tree-service.ts` (Record<ReportDomain> exhaustiveness)
- `src/components/ReportCatalogList.tsx` (Record<ReportDomain> exhaustiveness)
- `src/components/crm/PipelineKanbanBoard.tsx` (new)
- `src/app/(app)/crm/page.tsx` (new "Pipeline" tab)
- `src/app/api/crm/pipeline/{stages,stages/[id],export,ai-summary,stuck}/route.ts` (new)
- `src/app/api/crm/opportunities/bulk-reassign/route.ts` (new)
- `src/app/api/crm/opportunities/[id]/route.ts` (thread actorRole through to updateOpportunity)
- `src/app/api/internal/pipeline-stuck-deal-digest/run/route.ts` (new)
- `vercel.json` (new cron entry)
- `ai-os/registry/asset-registry-coverage.yaml` (crm_pipeline_stages registered)
- `ai-os/boss/ACTIVE-CLAIMS.yaml` (claim registered at task start)

## Remaining
- [x] Open a PR against `main` (branch protection + CI gate per AGENTS.md Rule 6) --
      **PR #1018** opened (https://github.com/FChecklist/compliance-tracker/pull/1018).
- [x] Branch had drifted 788 commits behind `main` since this task's original checkpoint
      (2026-08-07) -- zero CI check-suite had even been created for the original push
      (`mergeable: CONFLICTING`). Unshallowed the clone (`git fetch --unshallow`), merged
      `origin/main`, and resolved 9 conflicted files by hand (merge commit `1429f1fbc`):
      - `PROGRESS.md`, `ai-os/boss/ACTIVE-CLAIMS.yaml`, `ai-os/registry/asset-registry-coverage.yaml`,
        `vercel.json` (own cron moved to `50 9 * * *` to avoid a same-minute collision with
        main's new `orchestra-log-purge` cron) -- straightforward additive concatenations.
      - `src/lib/db/schema.ts` -- two conflicts where git's diff had merged two *different*
        tables' closing braces into one shared line (this session's `crmPipelineStages` and
        main's new `crmSalesTargets`); fixed by hand so each table gets its own `})`, verified
        against the raw `HEAD`/`MERGE_HEAD` blobs via `git cat-file -p` (not the truncation-prone
        `git show`, see [[veridian-git-show-large-output-flaky-truncation]]).
      - `src/lib/services/crm-service.ts` -- same "shared closing brace" pattern for
        `getPipelineAiSummary()` (this session) vs `setSalesTarget()` (main); merged import
        block (union of both sides' new symbols: `crmPipelineStages`/`crmLostReasons`/
        `crmSalesTargets`/`crmActivities`/`users`, `TenantDb`, `ne`/`isNull`,
        `buildPipelineDeals`, `ROLE_RANK`/`UserRole`, `serviceErrorBody`); merged
        `updateOpportunity()`'s `patch` type to carry both `currencyId`/`exchangeRate` (this
        session) and `lostReasonId` (main). Verified post-merge: every exported function name
        unique (no duplicate definitions survived), brace depth balances to 0 across the file.
      - `src/lib/services/crm-service.test.ts` -- add/add conflict (both sides added a new test
        file for the same module); combined into one file covering all three pure predicates
        (`isValidStageTransition`, `computeRoundRobinAssignment`, `aggregateLeadSourceEffectiveness`).
      - `src/app/(app)/crm/page.tsx` -- main had independently shipped a Wave 3 refactor
        (2026-07-21) that replaced the old tabbed Leads/Opportunities UI on this page with a
        card-grid "MODULES" overview linking to dedicated per-area pages -- this session's old
        tabs-based "Pipeline" tab no longer fit that architecture. Resolved by adopting main's
        grid entirely and re-homing the Kanban board onto its own new route,
        **`src/app/(app)/crm/pipeline/page.tsx`** (mirrors the header/back-link pattern of
        `crm/accounts/page.tsx`), added as a `MODULES` entry (no count badge -- it's not a
        distinct record count, just opportunities viewed by stage).
      - `src/app/api/crm/opportunities/[id]/route.ts` -- merged import (this session's
        `UserRole` type import + main's new `getOpportunity`/`deleteOpportunity` handlers).
      Verification after resolving: `bun test src/lib/services/crm-service.test.ts` -- **22/22
      pass** (10 from this session + 12 from main, both now in the same file). Every touched
      file round-trips through `bun build --target=node` with zero syntax errors. A full
      `bunx tsc --noEmit` (even with `--max-old-space-size=6144`) still times out at 280s in
      this sandbox -- inconclusive locally, same known pre-existing limitation noted below; CI's
      own Type Check job is the real gate and is running as of this checkpoint (PR #1018,
      commit `1429f1fbc`).
- [x] Watched PR #1018's first real CI run (commit `1429f1fbc`) -- it surfaced 4 genuine
      failures, all fixed live (commit follows this one):
      - **Migration Number Collision Check**: main had independently landed its own
        `drizzle/0225_support_sessions.sql` while this branch was open, colliding with this
        task's `0225_sales_pipeline_module.sql`. Renumbered to `0313_sales_pipeline_module.sql`
        (next free number after main's real highest, 0312, re-verified live via
        `git ls-tree origin/main -- drizzle/`, not guessed) and updated the 2 in-code comment
        cross-references in `crm-service.ts` (lines 595/614) plus this file's own citations.
      - **Type Check**: `src/components/ReportCatalogList.tsx`'s `byDomain` grouping literal
        was missing the new `CRM` key required by `Record<ReportDomain, FullCatalogEntry[]>` --
        the merge-conflict resolution's exhaustiveness fix for this file (noted above) had
        fixed a *different* `Record<ReportDomain,...>` map earlier in Wave-history but this one
        was net-new since. Added `CRM: []`. Re-verified with a full local
        `NODE_OPTIONS="--max-old-space-size=8192" timeout 500 bunx tsc --noEmit` (the earlier
        280s/6144MB attempt had timed out inconclusively; this one completed) -- zero errors in
        any file this task touches; the only remaining errors repo-wide are 10 pre-existing
        `Cannot find module '@fchecklist/veridian-ui-kit/*'` / `@playwright/test` /
        `@mlc-ai/web-llm` findings (private/optional packages not installed in this sandbox,
        unrelated to this diff -- confirmed real CI's own Type Check log showed exactly the one
        `ReportCatalogList.tsx` error and none of these 10, so CI does have those packages).
      - **Unit Tests**: `permission-service.test.ts`'s exhaustive manager-gated-action list
        test didn't yet know about this task's new `crm.pipeline_stages.manage` entry in the
        shared `ERP_ACTION_ROLES` table (a deliberately shared, not ERP-only, action-role table
        per that file's own header comment -- every module is expected to add its actions
        there). Added the new action to the test's expected list, same class as the existing
        `erp.chart_of_accounts.create`/`erp.fixed_assets.category_manage` master-data-config
        entries. The other 3 fail + 2 module-not-found errors in the full `bun test` run
        (`event-bus.test.ts`, `connector-data-service.test.ts`,
        `dispatch-completion-monitor.test.ts`, `HomeThreadSlot.test.ts`, `ChainSelector.test.ts`,
        `departments/route.test.ts`, `v1/tasks/[id]/status/route.test.ts`) are pre-existing and
        untouched by this branch's diff (`git diff --name-only origin/main HEAD` confirms none
        of those files appear) -- not this task's to fix.
      - **Terminology Guardrail Check**: this task's own new dated gap-closure comments (25
        findings across 15 files, all real "when/why this was built" comments, none
        example/sample data) pushed several files' `hardcoded_iso_date` counts above their
        recorded exemption-manifest baseline. Updated 6 existing entries'
        `findings_by_category.hardcoded_iso_date` counts + `reason` text and added 9 new
        entries in `ai-os/registry/terminology-guardrail-exemptions.yaml`, following this
        file's own established "Bumped N -> M (reason)" convention. Re-verified locally:
        `node scripts/check-terminology-guardrail.mjs --diff-only` now passes clean.
      - Not investigated further: **Promptfoo Evals** (unrelated to this task's diff -- no
        prompt-template file this task touches showed up as a cause in the failure summary)
        and **Vercel** (failed with an explicit `build-rate-limit` message, an infra quota
        issue, not a code problem). **audit-check** is expected to fail until the mandatory
        AUDIT comment is posted post-CI-green, per Rule 10.
- [x] Pushed commit `493aa1734` with all 4 CI fixes. New CI run in progress on the fresh
      commit as of this checkpoint (all jobs re-queued/pending, `Vercel` still shows the same
      infra `build-rate-limit` failure independent of code -- not actionable from this side).
- [x] Re-confirmed CI green on commit `67099384f`: all 8 of branch protection's required
      contexts (Lint, Type Check, Build, Guardrail Presence Check, Asset Registry Coverage
      Check, Unit Tests, Metadata Index Coverage Check) pass
      (`gh api repos/FChecklist/compliance-tracker/branches/main/protection --jq
      '.required_status_checks.contexts'` confirms this is the exact required list --
      Promptfoo Evals/Vercel/Terminology Guardrail/Migration Collision/E2E/CodeQL are real but
      non-blocking). Posted the required structured 8-field `AUDIT: PASS` verdict comment
      (Rule 10) at https://github.com/FChecklist/compliance-tracker/pull/1018#issuecomment-5212294619.
- [x] The audit-check job triggered by that comment (`issue_comment`) checks out `main`, not
      this PR's head SHA (a known footgun), so it didn't by itself satisfy the required check
      for merge purposes -- pushed a trivial follow-up commit (`0ad99eceb`) to trigger a real
      `synchronize` event; the job re-ran against the true head SHA and picked up the
      already-posted comment. Confirmed via a live monitor loop: all 8 of branch protection's
      required contexts now show `pass` on commit `0ad99eceb`, including `audit-check`.
- [ ] **BLOCKED on merge, not on this task's own work**: `gh pr view 1018 --json
      mergeStateStatus,reviewDecision` returns `{"mergeStateStatus":"BLOCKED",
      "reviewDecision":"REVIEW_REQUIRED"}` despite every required CI check green. This is the
      known, already-documented standing structural deadlock, not something new or specific to
      this PR: `main`'s branch protection requires 1 approving review + `enforce_admins: true`,
      but every credential in this environment resolves to the same single GitHub identity
      (`FChecklist`), so GitHub structurally refuses self-approval and `gh pr merge --admin`
      fails with a GraphQL "at least 1 approving review required" error regardless of admin
      permission -- confirmed 6-for-6 on every other PR shape tried across 2026-08-06/07
      (docs-only closures AND real feature PRs alike), see prior session memory
      `veridian-branch-protection-self-approval-deadlock-active` /
      `ai-os/REVIEWER_IDENTITY_PROVISIONING_GAP_2026-08-05.md`. Per that precedent's own
      guidance: did **not** attempt `gh pr merge` (would just burn a circuit-breaker strike on
      an already-proven failure mode) and did **not** touch
      `required_approving_review_count` myself (that would be guardrail-weakening under
      AGENTS.md Rule 9 without a fresh explicit Owner directive). PR #1018 is fully
      ready-to-merge the moment either a second reviewer identity is provisioned or the Owner
      grants a bounded review-count exception -- this task's own implementation and CI-fix work
      is complete.
- [ ] Once PR #1018 actually merges, move this session's `ACTIVE-CLAIMS.yaml` entry from
      `active:` to `recently_completed:`.

## Re-checked 2026-08-07 (invocation 17/20) -- no change, no action taken
Live re-verification, not a repeat attempt: `gh pr view 1018` still shows
`mergeStateStatus: BLOCKED`, `reviewDecision: REVIEW_REQUIRED`; branch protection still
`required_approving_review_count: 1` + `enforce_admins: true`. `gh pr checks 1018` confirms
all 8 required contexts still green on the same commit (`67099384f`/`0ad99eceb`), plus 6 more
non-required checks passing (only `Vercel`'s infra build-rate-limit and `Promptfoo Evals` fail,
both pre-existing/unrelated, both non-blocking per branch protection's own required-contexts
list). No second reviewer identity has been provisioned; no Owner review-count exception has
been granted. Per this task's own documented precedent (see prior entry + session memory
`veridian-branch-protection-self-approval-deadlock-active`), did **not** re-attempt
`gh pr merge` -- a 6-for-6-confirmed failure mode, retrying would only burn a circuit-breaker
strike for no new information. This task's implementation work remains complete and unchanged;
the merge blocker is structural/environmental, not something further work in this session can
resolve.

## Re-checked 2026-08-07 (invocation 18/20) -- no change, stopping the re-verification loop
Third consecutive identical live check, same result as invocation 17: `gh pr view 1018` still
`{"mergeStateStatus":"BLOCKED","mergeable":"MERGEABLE","reviewDecision":"REVIEW_REQUIRED"}`,
same commit (`67099384f`/`0ad99eceb`), all 8 required contexts still `pass`, only the same two
pre-existing non-required checks (`Vercel` build-rate-limit, `Promptfoo Evals`) not green.
`ai-os/boss/ACTIVE-CLAIMS.yaml` entry for this session unchanged. No new Owner directive, no
second reviewer identity, no review-count exception -- nothing has changed since invocation 17
that this session could act on. Per this task's own protocol ("on a 2nd consecutive failure of
the identical approach: STOP, do not attempt a 3rd time"), this is now the third identical
no-op re-check in a row producing zero new information, so this session is stopping the
re-verification loop rather than repeating it again on the next invocation. **Nothing left for
this session to do**: implementation is complete (all 14 findings closed), CI is fully green,
and the sole remaining blocker -- the standing GitHub reviewer-identity self-approval deadlock
affecting every PR in this repo, not something specific to PR #1018 -- requires action outside
this session's capability (Owner provisions a second reviewer identity, or grants a bounded
`required_approving_review_count` exception, or merges the PR directly). Any future invocation
of this task should check `gh pr view 1018 --json mergeStateStatus,reviewDecision` once; if it
still reads `BLOCKED`/`REVIEW_REQUIRED`, no further action is needed beyond a one-line
confirmation -- do not re-run the full CI/checks audit again absent an actual change.

## Re-checked 2026-08-07 (invocation 19/20) -- no change, one-line confirmation only
`gh pr view 1018 --json mergeStateStatus,reviewDecision,state` still returns
`{"mergeStateStatus":"BLOCKED","reviewDecision":"REVIEW_REQUIRED","state":"OPEN"}`. Per
invocation 18's own instruction, did not re-run the full CI/checks audit -- nothing has
changed. Same standing structural deadlock (single GitHub identity, branch protection
requires 1 approving review + enforce_admins). Nothing left for this session to do; blocker
requires Owner action (provision second reviewer identity, grant review-count exception, or
merge directly).

## Re-checked 2026-08-14 (invocation 20/20) -- merge conflict with origin/main resolved
`gh pr view 1018` now returned `mergeStateStatus: DIRTY`, `mergeable: CONFLICTING` (a real
change from invocations 17-19's steady `BLOCKED`/`REVIEW_REQUIRED` -- `origin/main` had
advanced 88 commits since this branch's last merge, three files now genuinely conflicting:
`PROGRESS.md`, `ai-os/boss/ACTIVE-CLAIMS.yaml`, `ai-os/registry/terminology-guardrail-exemptions.yaml`
(confirmed via `git merge-tree` before touching anything). Merged `origin/main` in and
resolved all three -- every conflict was additive/non-overlapping (different tasks' entries
in shared registry files), nothing from either side dropped:
- `ai-os/boss/ACTIVE-CLAIMS.yaml`: kept this session's `active:` entry plus origin/main's
  own newer `active:`/`recently_completed:` entries, both intact.
- `ai-os/registry/terminology-guardrail-exemptions.yaml`: kept this task's 9 exemption
  entries plus origin/main's newer `reconciliation-engine.test.ts` entry.
- `PROGRESS.md`: this shared changelog file's `origin/main` tip had been reset to a
  118-byte stub for an unrelated task (`task-20260814-021600`), discarding the much larger
  accumulated history the merge-base version still had -- not something to refight here.
  Kept this task's full section on top, appended `origin/main`'s stub below unchanged,
  same precedent as this file's own prior conflict-resolution note above
  (task-20260805-151445's entry: "keeping this section on top and appending the complete,
  untruncated origin/main history below unchanged").
- Validated both YAML files still parse (`python3 -c "import yaml; yaml.safe_load(...)"`).
- Not yet done as of this note: push, re-confirm CI green on the new merge commit, and
  re-check whether the standing reviewer-identity self-approval deadlock (still the
  documented blocker independent of this conflict) has changed.

## Re-checked 2026-08-15 (invocation 14) -- finished the prior invocation's checkpoint, pushed, further conflicts resolved
Resumed with invocation 20's merge conflict resolution already staged but never committed.
Committed it first (`4c51cc563`), then re-fetched `origin/main`: it had advanced a further 136
commits since invocation 20's merge-base (not just the 88 already resolved), reintroducing 3
real conflicts on top of the same 3 files -- confirmed via `git merge-tree` before touching
anything, then a real `git merge origin/main`:
- `PROGRESS.md`: found and removed a genuine leftover diff3 artifact from invocation 20's own
  resolution -- a duplicated `||||||| <base>` block (the full text of the
  `task-20260718-081006-crm---sales-modules--opportunities` section, byte-identical to the
  real copy immediately above it) that had been left in the file rather than stripped, because
  the outer `<<<<<<<`/`=======`/`>>>>>>>` markers were edited but the inner `|||||||` diff3
  base section was missed. Removed the duplicate block; the real section (kept once) is
  unaffected. New conflict from this round: `origin/main` had appended a fresh
  `task-20260815-044325-pm-approval-of-proposal-62-build-lock-co` stub section -- kept on top
  of this task's own content per the same "ours-on-top, theirs-appended-below" precedent used
  every prior round.
- `ai-os/boss/ACTIVE-CLAIMS.yaml`: `origin/main` added 2 new `active:` entries
  (`task-20260718-065003-ai-engineering-quality--error-handling`,
  `task-20260718-071005-ai-model-lifecycle---benchmarking--evalu`) ahead of this session's own
  entry in the list; combined all three, nothing dropped.
- `ai-os/registry/terminology-guardrail-exemptions.yaml`: both sides had independently bumped
  `src/lib/db/schema.ts`'s `hardcoded_iso_date` baseline off the same base value of 84 --
  this task's own invocation-20 bump to 86 (+2, `crmPipelineStages`/currency columns) and
  `origin/main`'s new AI Model Lifecycle task's bump to 85 (+1, `aiTeamRoleOverrides`
  candidate-model columns). Reconciled to 87 (84 + 2 + 1), combined `reason` text citing both
  bumps -- neither side's real, evidenced comment was dropped.
- Verified: both YAML files parse (`yaml.safe_load`), zero conflict markers remain anywhere in
  the tree (`grep -rl` for `<<<<<<<`/`|||||||`/`=======`/`>>>>>>>` across the working tree,
  excluding `.git`/`node_modules`, returns nothing), `bun test
  src/lib/services/crm-service.test.ts` -- **49/49 pass** (this task's original 10 +
  invocation-20's merged-in 12 + this round brought in no new test changes to this file, so the
  count is unchanged from invocation 20's own 22/22 note plus tests other concurrent work added
  to the same file since).
- Pushed commit `1efd9f094`. Fresh CI run on this commit surfaced one genuine new failure:
  **Migration Number Collision Check** -- `origin/main` had independently landed its own
  `drizzle/0313_ai_team_role_overrides_rollout.sql` (the AI Model Lifecycle task's candidate-
  model/rollout-percentage columns) while this branch's `drizzle/0313_sales_pipeline_module.sql`
  (itself already a renumber from `0225`, see invocation 20 in `veridian-branch-protection-self-
  approval-deadlock-active` memory) was in flight -- same class of same-cycle collision as
  invocation 20's original 0225 collision, just one number later. Renumbered ours to
  `drizzle/0314_sales_pipeline_module.sql` (next free number after `origin/main`'s real highest,
  0313, re-verified live via `git ls-tree origin/main -- drizzle/`, not guessed), and updated
  the 2 in-code comment cross-references in `crm-service.ts` (the `listPipelineStages()`
  doc-comment and its "config table" comment, lines 688/707) -- the theirs-side `drizzle/0313`
  references in `schema.ts`/`roster-overrides.ts` (the AI Model Lifecycle task's own migration)
  are correctly untouched. All other CI jobs passed clean on the first run (Lint, Type Check,
  Unit Tests, audit-check -- correctly picked up the pre-existing `AUDIT: PASS` comment per
  `[[veridian-audit-check-issue-comment-sha-bug]]`'s documented behavior of re-validating on
  every `synchronize` regardless of comment age -- Guardrail Presence, Asset Registry Coverage,
  Metadata Index Coverage, Terminology Guardrail, Doc Quarantine/Cross-Reference/Sentinel,
  Secret Scanning, Security Pattern); only `Vercel` failed, with the same known unrelated infra
  `build-rate-limit` message as every prior round. Pushed the renumber fix; new CI run in
  progress on the fresh commit as of this checkpoint.
- This task's own implementation (all 14 findings) remains unchanged and complete -- this
  invocation's work was entirely conflict-resolution/CI-collision bookkeeping to keep PR #1018
  mergeable against a fast-moving `main`, not new feature work.

---

# PROGRESS -- task-20260814-021600-rca--umr-20260807-063918-f15d-killed

## Completed

## Remaining
- [ ] Not started

## Re-checked 2026-08-14 (invocation 20/20, continued) -- merge pushed, CI in progress
Pushed merge commit `3c0a56f90` resolving the conflict documented above. `gh pr view 1018` now
confirms `mergeable: MERGEABLE` (conflict cleared), `mergeStateStatus: BLOCKED` (back to the
standing, already-documented reviewer-identity self-approval deadlock -- unchanged, not a new
issue). Watching CI on the new head SHA before deciding whether a follow-up audit-check
synchronize commit is needed (per the known issue-comment-vs-head-SHA gap noted earlier in this
file).

## Re-checked 2026-08-14 (invocation 20/20, continued again) -- 2nd merge conflict, this time real overlapping source code
Immediately after invocation 20's first merge+push (commit `aa81a3722`, CI green), `origin/main`
advanced one more merge commit (`030da130b`, "fix(crm): close leads/opportunities RBAC gap --
own-record-or-manager") touching the same core files this task's own Sales Pipeline closure
touches: `src/lib/services/crm-service.ts`, `src/lib/services/crm-service.test.ts`,
`src/app/api/crm/opportunities/[id]/route.ts` -- a real, non-trivial conflict this time, not
just a shared-doc-file collision. Resolved by combining both features rather than picking one:
- `CrmContext` now carries both this task's `actorRole?: UserRole` (stage-transition rank
  check) and the other change's `role?: string` (owner-or-manager RBAC gate) as two
  independently-optional fields -- deliberately not unified into one, since they're typed
  differently (UserRole vs plain string) and used by different call sites.
- `updateOpportunity()`: both checks now run sequentially (stage-transition legality, then
  the owner-or-manager RBAC gate) -- no overlap, no precedence conflict.
- `src/app/api/crm/opportunities/[id]/route.ts`'s PATCH handler now passes both
  `actorRole: dbUser.role as UserRole` and `role: dbUser.role` to `updateOpportunity()`.
- `crm-service.test.ts`: merged import statement (both sides' new exports) and kept every
  test `describe` block from both sides (isValidStageTransition + the 5 new RBAC gate
  describes: canEditLead/canReassignOrDeleteLead/canEditOpportunity/
  canReassignOrDeleteOpportunity/canCreateCrmRecord) -- no test dropped.
- `PROGRESS.md`: same pattern as the prior conflict resolution this invocation -- kept this
  task's section on top, appended `origin/main`'s full history below unchanged (confirmed via
  grep that origin/main's own accumulated history has zero references to this task's ID,
  i.e. this task's content was never previously present there to lose).
- `ai-os/boss/ACTIVE-CLAIMS.yaml` auto-merged cleanly this time (no manual resolution
  needed).
Verified after resolving: `git grep` for conflict markers across the full working tree
returns zero hits.

---

# PROGRESS -- task-20260718-081006-crm---sales-modules--opportunities

## Context
This task's own `prompt.txt`/spec was never actually written to the workspace
(referenced by the resume note but absent on disk; `task.yaml` has no spec
field beyond the title). The task has failed/blocked for weeks (see
`task.yaml` checkpoint history: repeated `credit_accountant_rejected`
pre-flight failures, a `blocked` status, 15 `failed`/`in_progress` cycles)
with zero real work landed across 13 prior invocations.

Given the title ("CRM & Sales Modules: Opportunities") and no other spec to
go on, audited the existing CRM/Sales module for a genuine open gap rather
than inventing busywork or re-doing already-shipped functionality (the
lead-to-opportunity pipeline, AI scoring/analysis, follow-up-task chaining,
and the Sales Pipeline dashboard/KPI widget are all already built and
working -- confirmed via `src/app/(app)/crm/page.tsx`,
`src/lib/services/crm-service.ts`, and recent git log).

**Real gap found:** `crm-accounts-service.ts` got a real owner-or-manager
RBAC gate in Wave 4 (2026-07-17: `canEditAccount`/
`canReassignOrDeleteAccount`/`canCreateCrmRecord`), but `crm_leads`/
`crm_opportunities` -- the sibling tables one wave earlier -- never did. Any
authenticated org member, including viewer/client_viewer/external_auditor
rank, could create/edit any lead or opportunity and could silently reassign
ownership via a plain `PATCH { ownerId }` with **zero** rank check at all,
through the native CRM UI's own `/api/crm/leads*` and
`/api/crm/opportunities*` routes (confirmed by reading those route files --
no RBAC call of any kind before this fix). The `v1/projexa/**` alias routes
were left untouched -- they already gate at "member"/"manager" role via
`requireRoleOrScope()` at the route layer (including API-key auth, which has
no `dbUser.role` to thread through a stricter owner-scoped gate without
risking breaking that integration), so they were not a zero-gate hole,
unlike the native CRM UI routes.

---

# PROGRESS -- task-20260815-044325-pm-approval-of-proposal-62-build-lock-co

## Completed

## Remaining
- [ ] Not started
