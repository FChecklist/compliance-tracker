# PROGRESS -- task-20260728-050704-sap-informed-veridian-phase-0--baseline

## Completed
- [x] Read ai-os/boss/ACTIVE-CLAIMS.yaml, confirmed no collision, registered claim, pushed (commit 887fae43)
- [x] Located real data sources: ai-os/DATABASE_CATALOG.json (compliance-tracker, 449-table snapshot from 2026-07-26) + claude-control repo's ai-os/WIRING_ENGINE_REGISTRY_2026-07-25.json (7711 entities; only 6 generic "route" entities, 444 supabase_table, 1371 src/app/api functions -- not useful for per-route domain categorization, used DATABASE_CATALOG.json + direct grep as primary per spec's own fallback guidance)
- [x] Diffed DATABASE_CATALOG.json's 449 tables against current schema.ts's real 464 `.table(` declarations -- found 15 new tables added since the snapshot (hr loans/expense-claims/shift-roster, performance-review goals/raters, helpdesk SLA/escalation/ticket-teams, construction interim bills), pulled their real columns directly from schema.ts
- [x] Categorized 213 business-domain tables across the 8 in-scope domains (CRM 8, Sales 19, Purchase 27, Inventory 17, Accounting/GST 41, HR 43, PM 27, Helpdesk 13, Construction/BoQ 18), each with real file:line + real column list
- [x] Enumerated all 959 real API route.ts files under src/app/api (note: relative-path `find` silently truncated to 51 in this shell -- absolute-path `find` gave the real count; used absolute-path form throughout), categorized 508 of them into the 8 domains by directory, with real per-directory counts + example paths (fixed an erp/returns sales-vs-purchase mis-split along the way)
- [x] Confirmed PROJEXA's module-chain exposure via PR #609 (compliance-tracker, merged 2026-07-28T04:11:24Z) + PR #59 (projexa, merged 2026-07-28T03:19:17Z): buildCapabilityTree() now exposed to PROJEXA's chat composer (minus construction_intelligence, which PROJEXA already owns via its own dedicated route) -- read the actual route.ts + capability-tree-service.ts source, not just PR titles
- [x] Ran both spec sanity checks: `grep -c "pgTable("` = 0 (real finding: this codebase uses `complianceSchemaDB.table(`/`platformSchemaDB.table(`, not literal `pgTable(` -- documented, not silently worked around) + real `.table(` count = 464; `git log` on PHASE_0_BASELINE.yaml confirmed empty (pre-creation)

- [x] Assembled ai-os/tasks/sap_mapping/PHASE_0_BASELINE.yaml (213 tables + 508 API routes across 8 domains, PROJEXA module-exposure section, sanity checks, out-of-scope notes) -- fixed one auto-generated-description false positive along the way (erpItems mis-labeled "line items" purely because its table name ends in _items; it's actually the item master)
- [x] Committed + pushed (commit b1631f6e)
- [x] Opened PR #615: https://github.com/FChecklist/compliance-tracker/pull/615
- [x] Updated ACTIVE-CLAIMS.yaml entry with PR #615 status (will move to recently_completed once merged)

## Remaining
- [ ] None -- task complete, PR #615 awaiting CI + review/merge

# PROGRESS -- task-20260728-051737-owner-engine-phase-8-real-gaps

Closes the 5 real, audit-confirmed unbuilt Phase 8 gap items:
engine-prompt-translation, engine-prompt-localization,
engine-prompt-marketplace, engine-prompt-export, engine-prompt-import.
Source of truth for scope: `ai-os/audits/owner_engine_reaudit_2026-07-27.md`
(merged) + `ai-os/VERIDIAN_ARCHITECTURE_V2_PHASE_PLAN_2026-07-25.yaml`
(`phase_8_dspy_learning_distribution_engines`) in the sibling
`claude-control` repo, read read-only. Extends the existing Prompt
Operating System (`prompt-os-resolver.ts` / `prompt-os-service.ts`, Wave
22/23) rather than a parallel prompt-management layer, per this task's
CONSTRAINTS.

## Completed
- [x] Read governance docs (ACTIVE-CLAIMS, CONSTITUTION, OS.yaml, MASTER-TRACKER), registered claim in `ai-os/boss/ACTIVE-CLAIMS.yaml`, moved the stale PR #589 "increment 1" claim to `recently_completed`.
- [x] Read authoritative phase_8 scope from claude-control's `VERIDIAN_ARCHITECTURE_V2_PHASE_PLAN_2026-07-25.yaml` and the re-audit report.
- [x] Confirmed PR #561's `scripts/export-prompt-versions-gitops.ts` is a one-way DB->git GitOps exporter (no import counterpart, whole-registry, not a portable single-template bundle) -- distinct from this task's engine-prompt-export/import scope.
- [x] Surveyed existing conventions to reuse: `resolveModelConfig()`+`callLLMJson()` (llm-client.ts) for real LLM calls, `ai-response-locale.ts` for the known-locale list, `permission-service.ts`'s `PROMPT_ACTION_ROLES`, `workerAgents`' platform-wide draft->published pattern (precedent for marketplace scope: platform-wide, orgId nullable/attribution-only, not new cross-tenant RLS).
- [x] Schema: added `prompt_translations`, `prompt_localizations`, `prompt_marketplace_listings` tables to `src/lib/db/schema.ts` + hand-authored `drizzle/0268_prompt_translation_localization_marketplace.sql` (not applied live, same convention as drizzle/0262 -- left for the supervising session).
- [x] `src/lib/services/prompt-translation-service.ts` + test (6 tests): real LLM translation via `resolvePlatformModelConfig()`+`callLLMJson()`, cached per (versionId, locale), `force` re-translates.
- [x] `src/lib/services/prompt-localization-service.ts` + test (5 tests): second real LLM pass on top of a translation, grounded in real `Intl.DateTimeFormat`/`Intl.NumberFormat` samples (`localeFormattingSamples()`, pure/unmocked-tested), translates on demand if no translation exists yet.
- [x] `src/lib/services/prompt-marketplace-service.ts` + test (7 tests): publish (Production-lifecycle-only gate), unlist, list (read-only, no admin gate).
- [x] `src/lib/services/prompt-export-import-service.ts` + test (9 tests): portable single-template JSON bundle export + validated re-import (creates template if missing, append-only Draft versions, content-based idempotent re-import skip).
- [x] Permission entries in `permission-service.ts`: `prompt.translation.create`, `prompt.localization.create`, `prompt.marketplace.publish`, `prompt.import.run` all `veridian_admin` (export is intentionally ungated/read-only, same posture as the existing `GET /api/settings/prompts`).
- [x] API routes: `src/app/api/prompt-os/{translate,localize,export,import}/route.ts`, `src/app/api/prompt-marketplace/route.ts` -- all `requireAuth()`-gated, `ServiceError`-aware error mapping.
- [x] Real screen: `src/app/(app)/prompt-marketplace/page.tsx` (+ `AppSidebar.tsx` nav entry, `messages/en.json`+`hi.json` i18n keys) -- browse listings, publish dialog scoped to Production-lifecycle versions pulled from `/api/settings/prompts`.
- [x] Fixed 3 real bugs found while verifying the four new `*.test.ts` files (all originally failing, not a pre-existing-suite issue):
  1. All 4 test files' `mock.module("@/lib/db", ...)` factories replaced the *entire* `@/lib/db` module namespace, which broke the transitive `import { ServiceError } from "./compliance-service"` every new service uses (that file itself imports `auditLogs`/`complianceItems`/etc. from `@/lib/db`, which then didn't exist on the mocked module). Fixed by spreading the real (lazy, connection-free-on-import) module first: `{...(await import("@/lib/db")), ...dbMocks}`.
  2. `prompt-localization-service.test.ts`'s `mock.module("./prompt-translation-service", () => ({..., ServiceError: (await import(...)).ServiceError}))` used `await` inside a non-async factory arrow -- syntax error. Fixed by resolving `ServiceError` before the `mock.module()` call and referencing the plain binding inside.
  3. Both `prompt-translation-service.test.ts` and `prompt-localization-service.test.ts`'s "throws when no AI model is configured" tests set `modelConfig: null` but the mock read it via `opts.modelConfig ?? default`, and `??` treats `null` the same as "absent" -- the default config was used instead of `null`, so the test never exercised the intended path and crashed elsewhere. Fixed with `"modelConfig" in opts ? opts.modelConfig : default`.
- [x] `npx tsc --noEmit` clean (needs `NODE_OPTIONS="--max-old-space-size=8192"` in this environment -- default heap OOMs on this repo's size, unrelated to this task).
- [x] `bun test` scoped to the 4 touched test files: 27/27 pass. Full-repo `bun test`: 2255/2258 pass; the 3 failures are pre-existing on this branch before any of this task's changes (verified via `git stash`) and are in unrelated files (`dispatch-completion-monitor.test.ts`, `roster-overrides.test.ts`, `defense-in-depth.test.ts`) -- not caused by this work.

- [x] Committed + pushed, opened PR #618 (no self-merge -- awaiting a fresh supervisor audit per AGENTS.md Rule 7(c)/Rule 10). Updated `ai-os/boss/ACTIVE-CLAIMS.yaml`'s claim entry with a status update.

## Remaining
- [ ] Fresh supervisor audit of PR #618 (mandatory, this session may not self-certify).
- [ ] Supervising session applies `drizzle/0268_prompt_translation_localization_marketplace.sql` live (not applied in this PR).
