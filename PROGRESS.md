# PROGRESS -- task-20260720-022710-superboss-v2-plan--byob-bring-your-own-a

Task: **V2-5 — BYOB bring-your-own-AI-model [D6]** (TASK ID `V2-5-BYOB-AI-MODEL`,
Tier2 — schema+crypto, holds for Owner sign-off).

## Completed
- [x] Read governance: ACTIVE-CLAIMS.yaml (registry + collision check), model-tier-eligibility.ts, AGENTS.md Rule 9, mother-router.ts, roster-overrides.ts, ai-config-crypto.ts, dispatch-repo.ts, /api/ai/team/dispatch, team-service.ts runRole, orchestra-model-resolver.ts (existing BYO pattern), CONSTITUTION ai_orchestra_tiers.
- [x] Collision check: no open PR touches mother-router.ts software_team tenant-model scope. The prior 2026-07-16 BYOB-AI claim (PR #384, now recently_completed) targeted a *different* file scope (orchestra-model-resolver.ts / customer_model_config, the end_user_org scope) — disjoint.
- [x] Registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml (committed + pushed on its own).
- [x] Added `tenant_ai_config` table to schema.ts (org_id + provider[ai_provider enum] + encrypted_api_key + model_name + optional base_url + is_active + last_used_at + timestamps) + relations + `drizzle/0253_tenant_ai_config.sql` migration (RLS posture mirrors client_model_config; partial unique index `tenant_ai_config_one_active_per_org`; grants to app_runtime + service_role).
- [x] Added `resolveTenantAiConfig(orgId)` resolver in mother-router.ts (raw `db` client, platform-level resolution like resolveModelConfig; decrypts key via ai-config-crypto.ts decryptApiKey; inert-row gate `encryptedApiKey && modelName`; fire-and-forget lastUsedAt touch; never returned to a client).
- [x] Extended Mother Router: `software_team` context optionally carries `orgId`; `computeSoftwareTeamResolution()` takes optional `tenantOverrideModel`; when present + eligible, preferred over baseline AND policy; when ineligible, silently downgrades (falls through to baseline path) — NEVER bypasses `checkTierEligibility()`.
- [x] Wired `runRole()` (team-service.ts) to optionally accept a `TenantAiOverride` (provider+model+apiKey+baseUrl) — tenant key/model/baseUrl used for the actual LLM call, provider stays openrouter-compatible; effectiveModel precedence is tenant > DB roster-override > role.model.
- [x] Wired `dispatch/route.ts`: threads `orgId` into the fire-and-forget Mother Router audit-log resolve, AND resolves `resolveTenantAiConfig(orgId)` once for the real runRole call, with a defensive re-gate `checkTierEligibility(tenantModel, tier)` that nulls the override when ineligible (no guardrail bypass). Non-fatal on resolution failure → platform fallback.
- [x] llm-client.ts: `CallLLMOptions.baseUrl` + `dispatchLLM` honors it for the four callOpenAICompatible branches (groq/openai/openrouter/cerebras); undefined for every existing caller → zero behavior change.
- [x] Settings UI: `TenantAiConfigSection.tsx` (mirrors OrchestraModelConfigSection shape — provider select + model input + masked key + optional baseUrl + save/reset; key never displayed, only "key set"/"no key") wired into `settings/page.tsx`.
- [x] CRUD API `src/app/api/settings/tenant-ai-config/{route,[id]/route}.ts` — admin-only via `requireRole(dbUser,'admin')`; GET never returns key (only `hasKey` bool); POST runs real `testProviderConnection` before persisting, encrypts key, "leave blank to keep existing"; DELETE scoped by both id+orgId (belt-and-suspenders with RLS).
- [x] Tests: `tenant-ai-config.test.ts` (no-config fallback, inert-row gate x2, active-row decrypt, null baseUrl, encryption round-trip contract) + `mother-router.test.ts` tenant-override block (prefer-when-eligible, **guardrail-no-bypass** — ineligible tenant model downgrades to baseline never bypasses, priority over policy, no-config fallback byte-identical, tenant-equals-baseline no-op).
- [x] Fixed dispatch route test mocks (`route.test.ts`): added `resolveTenantAiConfig` to the mother-router mock (returns null = no-config) so the V2-5 path is exercised cleanly without a noisy non-fatal stack trace.
- [x] `tsc --noEmit` clean (0 errors total).
- [x] eslint clean on all touched files (0 errors).
- [x] `bun test` green: 1825/1825 pass (incl. 7 dispatch route tests + 32 mother-router/resolver tests).
- [x] Sync-check scripts all pass: asset-registry-coverage (422 tables, tenant_ai_config exempted), doc-cross-references, doc-quarantine-banner, **guardrail-presence (88 markers — no new call site wired, so no manifest entry needed per Rule 9; the tenant path reuses the existing checkTierEligibility() call in mother-router.ts + adds a defensive re-gate in the already-manifested dispatch/route.ts)**, metadata-index-coverage, migration-collision (renumbered 0251->0253 during review to resolve a collision with drizzle/0251_crm_wave1_activities_campaigns_lost_reasons.sql; 0253 confirmed unique).
- [x] Registered asset-registry exemption for `tenant_ai_config` (mirrors customer_model_config / client_model_config — config row, not a browsable platform asset).

## Remaining
- [ ] Commit + push all changes; open PR (Tier2 — do NOT self-merge, hold for Owner sign-off + mandatory audit per Rule 7(c)).
- [ ] Update ACTIVE-CLAIMS.yaml status → recently_completed once PR is open.
