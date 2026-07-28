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

## Remaining
- [ ] Schema: add `prompt_translations`, `prompt_localizations`, `prompt_marketplace_listings` tables to `src/lib/db/schema.ts` + hand-authored `drizzle/0268_*.sql` migration.
- [ ] `src/lib/services/prompt-translation-service.ts` + test: real LLM translation, persisted/cached.
- [ ] `src/lib/services/prompt-localization-service.ts` + test: locale-aware adaptation layered on an existing translation.
- [ ] `src/lib/services/prompt-marketplace-service.ts` + test: publish/list.
- [ ] `src/lib/services/prompt-export-import-service.ts` + test: portable JSON bundle export + validated re-import round-trip.
- [ ] Permission entries in `permission-service.ts` (veridian_admin bar, consistent with existing prompt actions).
- [ ] API routes: `src/app/api/prompt-os/{translate,localize,export,import}/route.ts`, `src/app/api/prompt-marketplace/route.ts`.
- [ ] Real screen: `src/app/(app)/prompt-marketplace/page.tsx`.
- [ ] `npx tsc --noEmit` clean.
- [ ] `bun test` scoped to touched files, all green.
- [ ] Commit + push, open PR (no self-merge -- needs a fresh supervisor audit).
