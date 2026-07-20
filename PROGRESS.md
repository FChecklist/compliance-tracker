# PROGRESS -- task-20260720-022710-superboss-v2-plan--byob-bring-your-own-a

Task: **V2-5 — BYOB bring-your-own-AI-model [D6]** (TASK ID `V2-5-BYOB-AI-MODEL`,
Tier2 — schema+crypto, holds for Owner sign-off).

## Completed
- [x] Read governance: ACTIVE-CLAIMS.yaml (registry + collision check), model-tier-eligibility.ts, AGENTS.md Rule 9, mother-router.ts, roster-overrides.ts, ai-config-crypto.ts, dispatch-repo.ts, /api/ai/team/dispatch, team-service.ts runRole, orchestra-model-resolver.ts (existing BYO pattern), CONSTITUTION ai_orchestra_tiers.
- [x] Collision check: no open PR touches mother-router.ts software_team tenant-model scope. The prior 2026-07-16 BYOB-AI claim (PR #384, now recently_completed) targeted a *different* file scope (orchestra-model-resolver.ts / customer_model_config, the end_user_org scope) — disjoint.
- [x] Registered claim in ai-os/boss/ACTIVE-CLAIMS.yaml (committed + pushed on its own).

## Analysis (the gap is real)
The Orchestra-layer BYOB (customer_model_config → resolveModelConfig() → callLLM()) is shipped and serves the `end_user_org` Mother Router scope. **V2-5 targets the `software_team` scope, which has no per-tenant input at all today:**
- `computeSoftwareTeamResolution()` resolves only from a global `ai_routing_policies` rule + roster baseline; the `software_team` MotherRouterContext carries no `orgId`.
- `runRole()` (team-service.ts:42) hardcodes `platformOpenRouterKey()` + provider `"openrouter"` — a tenant's own model+key cannot be *used* by the software_team dispatch path.

So "configure + use their own model" through the Mother Router's software_team scope is genuinely not yet possible. Real work, Tier2 (schema+crypto) → holds for Owner sign-off, no auto-merge.

## Remaining
- [ ] Add `tenant_ai_config` table to schema.ts (org_id + provider + encrypted_api_key + model_name + optional base_url + is_active) + Drizzle migration.
- [ ] Add `resolveTenantAiConfig(orgId)` resolver (decrypts key server-side, mirrors ai-config-crypto.ts).
- [ ] Extend Mother Router: `software_team` context optionally carries `orgId`; when a tenant config exists, prefer its model but STILL run `checkTierEligibility()` (ineligible → silent downgrade to baseline, never a bypass).
- [ ] Wire `runRole()` to optionally accept/use the tenant model+key+baseUrl (provider stays openrouter-compatible; the task's server-side constraint routes through GLM-5.2 via OpenRouter, cheapest real provider).
- [ ] Settings UI section for tenant admin (mirror OrchestraModelConfigSection).
- [ ] CRUD API `src/app/api/settings/tenant-ai-config/**` (admin-only, encrypt key, never return key).
- [ ] Tests: guardrail-no-bypass case (ineligible tenant model downgrades, never bypasses checkTierEligibility), prefer-when-eligible, no-config fallback, encryption round-trip.
- [ ] tsc --noEmit clean (no NEW errors), eslint clean, `bun test` green on new tests.
- [ ] Run sync-check scripts; update check-guardrail-presence.mjs manifest if a new guardrail call site is wired (Rule 9).
- [ ] Open PR (WIP if needed); Tier2 — do NOT self-merge, hold for Owner sign-off + audit.
