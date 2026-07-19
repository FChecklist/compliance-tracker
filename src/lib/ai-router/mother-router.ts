/**
 * Mother Router (AIROUTER-01, CONTROLLER.yaml -- Owner directive 2026-07-18).
 *
 * A real, unifying AI model/provider registry + versioned routing policy +
 * audit log, covering the 3 domain scopes the Owner named:
 *   - "software_team"  -- AI Dev Team dispatch (roster.ts roles doing
 *                          coding/architecture/testing/docs work)
 *   - "end_user_org"    -- customer-facing product AI features, per org
 *   - "sales_marketing" -- internal sales/marketing AI roles
 *
 * DELIBERATE SCOPE DECISION (read before extending this file): this module
 * does NOT modify model-tier-eligibility.ts, orchestra-model-resolver.ts,
 * roster.ts, or llm-client.ts. It calls into them exactly as they already
 * are and layers registry/policy/audit metadata on top. A full rewrite of
 * every one of their ~23+3 existing call sites to route through here was
 * judged too large and too risky to attempt in one pass (several are
 * guardrail-critical dispatch paths, e.g. /api/ai/team/dispatch) -- see this
 * PR's PROGRESS.md. Existing callers of those 4 files need NOT change and
 * keep working exactly as before; new/updated call sites should prefer
 * resolveModel() below for the added audit trail and hot-swappable policy
 * override.
 *
 * NOTE: roster.ts already has an unrelated role literally named "ai_router"
 * (roleKey: "ai_router", the task CLASSIFIER used by classifyTask() in
 * team-service.ts). That is a different concept from this file's Mother
 * Router (model/provider resolution registry) -- do not conflate them.
 *
 * Hot-reload: the active policy per scope is cached IN-PROCESS (a plain
 * module-level Map) for POLICY_CACHE_TTL_MS: change a row in
 * ai_routing_policies and the change is picked up on that PROCESS's next
 * resolve() call once the TTL elapses, or immediately within that process
 * if invalidateMotherRouterCache() is called -- no app restart required
 * either way. Honest limitation: in a multi-instance/serverless deployment
 * (this app runs on Vercel), invalidateMotherRouterCache() only clears the
 * calling instance's own cache -- other running instances keep serving the
 * pre-change policy for up to POLICY_CACHE_TTL_MS regardless. "No restart
 * required" is true; "instant everywhere" is not, for Phase 1. See
 * mother-router.test.ts for the resolution-logic proof (pure functions,
 * not the cache/DB plumbing itself -- see this PR's PROGRESS.md for why).
 *
 * Rollback: ai_routing_policies is versioned per scope with a partial
 * unique index enforcing only one active version at a time (see the
 * migration). rollbackPolicy() flips is_active back to an older version
 * inside one DB transaction (atomic -- never leaves 0 or 2 active rows for
 * a scope); the very next resolveModel() call on the SAME process reflects
 * it (immediate cache invalidation there), same multi-instance caveat as
 * above for other processes. Known, accepted gap for Phase 1: two
 * concurrent rollbackPolicy() calls for the same scope aren't mutually
 * ordered by an optimistic-lock check -- whichever transaction commits
 * last wins with no error to the other caller. Low real risk (an
 * infrequent, human-triggered admin action) but not engineered around
 * here -- see PROGRESS.md.
 */
import { db, aiRoutingPolicies, aiRoutingAuditLog, organisations, subscriptionPlans, users } from "@/lib/db"
import { and, count, eq } from "drizzle-orm"
import { checkTierEligibility, type TierEligibilityResult } from "@/lib/model-tier-eligibility"
import { resolveModelConfig, type ResolvedModelConfig } from "@/lib/orchestra-model-resolver"
import { AI_TEAM_ROSTER } from "@/lib/ai-team/roster"
import type { LLMProvider } from "@/lib/llm-client"
import type { ComplexityTier } from "@/lib/task-tightening"
import type { CapabilityCategory } from "./software-team-ladder"

export type AiRouterScope = "software_team" | "end_user_org" | "sales_marketing" | "customer_success"

// Roster.ts's own header: "Every model here is called via OpenRouter" -- see
// team-service.ts's runRole()/classifyTask(), both hardcode provider
// "openrouter" for every roster-driven dispatch. Mirrored here, not
// reinvented, so software_team/sales_marketing resolutions return a
// provider consistent with how they'll actually be dispatched.
const ROSTER_PROVIDER: LLMProvider = "openrouter"

/**
 * Policy rule shape stored in ai_routing_policies.rule (jsonb). All fields
 * optional -- an empty/partial rule is valid and simply means "no override
 * for that axis," never an error.
 */
export type PolicyRule = {
  /** software_team / sales_marketing / customer_success: override model for a specific role. */
  preferredModelByRole?: Record<string, string>
  /**
   * software_team, AIROUTER-01 Phase 2 (Owner's Software Development Task
   * Routing Matrix, Part C): override model for one of the 4 capability
   * categories named in software-team-ladder.ts's CapabilityCategory --a
   * FINER axis than preferredModelByTier below (e.g. distinguishes
   * "single-file mechanical" from "architecture/design/analysis" even
   * though task-tightening.ts's own ComplexityTier only has 3 values).
   * Checked BEFORE preferredModelByTier when a capabilityCategory is
   * supplied; always still run through checkTierEligibility() exactly like
   * every other override here -- naming a model here can never bypass the
   * tier-eligibility guardrail, only get silently downgraded to the
   * tier-eligible baseline with the reason logged (see
   * computeSoftwareTeamResolution() below).
   */
  preferredModelByCapabilityCategory?: Partial<Record<CapabilityCategory, string>>
  /** software_team: override model for an entire complexity tier. Checked when preferredModelByRole/preferredModelByCapabilityCategory have no entry. */
  preferredModelByTier?: Partial<Record<ComplexityTier, string>>
  /** end_user_org: default provider/model for orgs on a given subscription aiPackage, used ONLY when the org has no active customer_model_config (BYO) of its own. */
  preferredModelByPackage?: Record<string, { provider: LLMProvider; model: string }>
}

export type ActivePolicy = { version: number; rule: PolicyRule }

export type MotherRouterResolution = {
  provider: LLMProvider
  model: string
  reason: string
  policyVersion?: number
  /** software_team only -- whether the resolved model is actually eligible for the requested complexity tier. */
  tierEligibility?: TierEligibilityResult
}

export type MotherRouterContext =
  | { scope: "software_team"; model: string; complexityTier: ComplexityTier; roleKey: string; capabilityCategory?: CapabilityCategory }
  | { scope: "end_user_org"; orgId: string; layerKey: string; sourceType?: string }
  | { scope: "sales_marketing"; roleKey: string }
  // AI Router registry-backed model resolution follow-up (2026-07-19): 4th
  // scope, no real dispatch call site wired to it yet -- see this file's own
  // DELIBERATE SCOPE DECISION header and computeCustomerSuccessResolution()
  // below for the "registry exists, not every call site adopted yet" posture
  // this already applies to the other 3 scopes.
  | { scope: "customer_success"; roleKey: string }

// ─── Hot-reload cache ───────────────────────────────────────────────────
const POLICY_CACHE_TTL_MS = 60_000
const policyCache = new Map<AiRouterScope, { fetchedAt: number; policy: ActivePolicy | null }>()

/** Forces the next resolveModel() call for every scope to re-fetch its active policy from the DB, instead of waiting out POLICY_CACHE_TTL_MS. Call this right after writing/activating a new ai_routing_policies row if the change needs to take effect immediately. */
export function invalidateMotherRouterCache(): void {
  policyCache.clear()
}

async function getActivePolicy(scope: AiRouterScope): Promise<ActivePolicy | null> {
  const cached = policyCache.get(scope)
  if (cached && Date.now() - cached.fetchedAt < POLICY_CACHE_TTL_MS) return cached.policy

  const row = await db.query.aiRoutingPolicies.findFirst({
    where: and(eq(aiRoutingPolicies.scope, scope), eq(aiRoutingPolicies.isActive, true)),
  })
  const policy: ActivePolicy | null = row ? { version: row.version, rule: (row.rule as PolicyRule) ?? {} } : null
  policyCache.set(scope, { fetchedAt: Date.now(), policy })
  return policy
}

async function logRoutingDecision(scope: AiRouterScope, context: MotherRouterContext, resolution: MotherRouterResolution): Promise<void> {
  // Audit logging must never be able to block or fail a real routing
  // decision -- same "fire-and-forget, non-fatal" posture this codebase
  // already uses for activity_log writes (e.g. dispatch/route.ts's
  // recordActivity calls).
  try {
    await db.insert(aiRoutingAuditLog).values({
      scope,
      context: context as unknown as Record<string, unknown>,
      resolvedProvider: resolution.provider,
      resolvedModel: resolution.model,
      policyVersion: resolution.policyVersion ?? null,
      reason: resolution.reason,
    })
  } catch (error) {
    console.error("[mother-router] failed to write ai_routing_audit_log row (non-fatal):", error)
  }
}

// ─── Pure resolution logic (unit-testable without a DB connection) ────────

/**
 * software_team scope. `baselineModel` is the model roster.ts already
 * assigns the role (targetRole.model in /api/ai/team/dispatch's own logic)
 * -- this function never invents a model that isn't already either that
 * baseline or an explicit policy override, and always runs the override
 * candidate through the SAME checkTierEligibility() gate as the baseline,
 * so a policy can never grant a tier a model hasn't earned.
 */
export function computeSoftwareTeamResolution(
  baselineModel: string,
  complexityTier: ComplexityTier,
  roleKey: string,
  policy: ActivePolicy | null,
  capabilityCategory?: CapabilityCategory
): MotherRouterResolution {
  const override =
    policy?.rule.preferredModelByRole?.[roleKey] ??
    (capabilityCategory && policy?.rule.preferredModelByCapabilityCategory?.[capabilityCategory]) ??
    policy?.rule.preferredModelByTier?.[complexityTier]

  // No policy, or its rule has no entry for this role/tier at all -- the
  // only case that's genuinely "no active policy" for audit purposes.
  if (!override) {
    return {
      provider: ROSTER_PROVIDER,
      model: baselineModel,
      reason: "no active routing policy override -- roster.ts baseline assignment",
      tierEligibility: checkTierEligibility(baselineModel, complexityTier),
    }
  }

  // A policy exists and names a model -- even when it happens to match the
  // baseline, the audit log must say a policy was actually consulted here
  // (an independent review correctly flagged the prior version silently
  // mislabeling this case as "no active policy," which would mislead an
  // auditor reading ai_routing_audit_log later).
  if (override === baselineModel) {
    return {
      provider: ROSTER_PROVIDER,
      model: baselineModel,
      reason: `ai_routing_policies v${policy!.version} names the same model as the roster.ts baseline for ${roleKey} -- no change`,
      policyVersion: policy!.version,
      tierEligibility: checkTierEligibility(baselineModel, complexityTier),
    }
  }

  const overrideEligibility = checkTierEligibility(override, complexityTier)
  if (overrideEligibility.eligible) {
    return {
      provider: ROSTER_PROVIDER,
      model: override,
      reason: `ai_routing_policies v${policy!.version} override for ${roleKey} (${complexityTier})`,
      policyVersion: policy!.version,
      tierEligibility: overrideEligibility,
    }
  }

  // Named override isn't eligible for this tier -- never silently grant it
  // anyway. Fall back to the baseline and say exactly why.
  return {
    provider: ROSTER_PROVIDER,
    model: baselineModel,
    reason: `ai_routing_policies v${policy!.version} named "${override}" for ${roleKey} but it is not eligible for "${complexityTier}" tier -- falling back to roster.ts baseline`,
    policyVersion: policy!.version,
    tierEligibility: checkTierEligibility(baselineModel, complexityTier),
  }
}

/**
 * end_user_org scope. `baseline` is whatever orchestra-model-resolver.ts's
 * existing resolveModelConfig() already returned -- completely unchanged
 * logic (customer BYO config, cost-guard, source-type overrides all still
 * apply exactly as before this file existed). This function only ever
 * overrides the PLATFORM DEFAULT branch (isCustomerConfigured === false)
 * with a subscription-package default when a policy names one -- an org's
 * own configured BYO model is never touched.
 */
export function computeEndUserOrgResolution(
  baseline: ResolvedModelConfig,
  aiPackage: string | null,
  policy: ActivePolicy | null
): MotherRouterResolution {
  if (baseline.isCustomerConfigured) {
    return {
      provider: baseline.provider,
      model: baseline.model,
      reason: "org has an active customer_model_config (BYO) -- Mother Router never overrides an org's own configured model",
    }
  }

  const override = aiPackage ? policy?.rule.preferredModelByPackage?.[aiPackage] : undefined
  if (override) {
    return {
      provider: override.provider,
      model: override.model,
      reason: `ai_routing_policies v${policy!.version} default for aiPackage="${aiPackage}"`,
      policyVersion: policy!.version,
    }
  }

  return {
    provider: baseline.provider,
    model: baseline.model,
    reason: aiPackage
      ? `no active routing policy default for aiPackage="${aiPackage}" -- platform default unchanged`
      : "org has no resolvable subscription aiPackage -- platform default unchanged",
  }
}

/**
 * sales_marketing scope -- new scope, no pre-existing resolver. Resolves
 * strictly from roster.ts's own existing role->model assignment as the
 * baseline (never invents a role or a model roster.ts doesn't already
 * have); a policy may only override to a DIFFERENT model for that same
 * role, never introduce a role that isn't in roster.ts.
 */
export function computeSalesMarketingResolution(
  roleKey: string,
  baselineModel: string | null,
  policy: ActivePolicy | null
): MotherRouterResolution {
  if (!baselineModel) {
    return {
      provider: ROSTER_PROVIDER,
      model: "",
      reason: `roleKey "${roleKey}" was not found in roster.ts, or has no model assigned (human/code-only role) -- nothing to resolve`,
    }
  }

  const override = policy?.rule.preferredModelByRole?.[roleKey]
  if (!override) {
    return {
      provider: ROSTER_PROVIDER,
      model: baselineModel,
      reason: "no active routing policy override -- roster.ts baseline assignment",
    }
  }
  if (override === baselineModel) {
    return {
      provider: ROSTER_PROVIDER,
      model: baselineModel,
      reason: `ai_routing_policies v${policy!.version} names the same model as the roster.ts baseline for ${roleKey} -- no change`,
      policyVersion: policy!.version,
    }
  }

  return {
    provider: ROSTER_PROVIDER,
    model: override,
    reason: `ai_routing_policies v${policy!.version} override for ${roleKey}`,
    policyVersion: policy!.version,
  }
}

/**
 * customer_success scope (AI Router registry-backed model resolution
 * follow-up, 2026-07-19) -- new scope, no pre-existing resolver and no real
 * dispatch call site wired to it yet (see this file's own DELIBERATE SCOPE
 * DECISION header and MotherRouterContext's own comment on this variant).
 * Identical resolution shape to computeSalesMarketingResolution() above:
 * strictly resolves from roster.ts's own existing role->model assignment as
 * the baseline (never invents a role or a model roster.ts doesn't already
 * have); a policy may only override to a DIFFERENT model for that same
 * role, never introduce a role that isn't in roster.ts.
 */
export function computeCustomerSuccessResolution(
  roleKey: string,
  baselineModel: string | null,
  policy: ActivePolicy | null
): MotherRouterResolution {
  if (!baselineModel) {
    return {
      provider: ROSTER_PROVIDER,
      model: "",
      reason: `roleKey "${roleKey}" was not found in roster.ts, or has no model assigned (human/code-only role) -- nothing to resolve`,
    }
  }

  const override = policy?.rule.preferredModelByRole?.[roleKey]
  if (!override) {
    return {
      provider: ROSTER_PROVIDER,
      model: baselineModel,
      reason: "no active routing policy override -- roster.ts baseline assignment",
    }
  }
  if (override === baselineModel) {
    return {
      provider: ROSTER_PROVIDER,
      model: baselineModel,
      reason: `ai_routing_policies v${policy!.version} names the same model as the roster.ts baseline for ${roleKey} -- no change`,
      policyVersion: policy!.version,
    }
  }

  return {
    provider: ROSTER_PROVIDER,
    model: override,
    reason: `ai_routing_policies v${policy!.version} override for ${roleKey}`,
    policyVersion: policy!.version,
  }
}

// ─── Subscription package resolution (Owner Phase 1: user-count-based) ────

/**
 * Resolves an org's subscription "aiPackage" (basic/standard/professional/
 * enterprise -- Owner's Phase-1 packages, see the migration's seed data).
 * Prefers an explicit organisations.subscriptionPlanId assignment; falls
 * back to classifying by the org's REAL current user count against the
 * seeded plans' userPackSize bands (ascending, smallest fitting band wins,
 * Enterprise as the ceiling for anything larger). Returns null only when
 * the org itself can't be found or no subscription_plans rows exist at all.
 */
export async function getOrgAiPackage(orgId: string): Promise<string | null> {
  const org = await db.query.organisations.findFirst({ where: eq(organisations.id, orgId) })
  if (!org) return null

  if (org.subscriptionPlanId) {
    const plan = await db.query.subscriptionPlans.findFirst({ where: eq(subscriptionPlans.id, org.subscriptionPlanId) })
    const features = plan?.features as { aiPackage?: string } | undefined
    if (features?.aiPackage) return features.aiPackage
  }

  // Independent queries -- run concurrently rather than paying their sum in
  // sequence. A real `count(*)` (not a full row/id fetch) so this stays
  // cheap for a large org's user table.
  const [[{ value: userCount }], plans] = await Promise.all([
    db.select({ value: count() }).from(users).where(eq(users.orgId, orgId)),
    db.query.subscriptionPlans.findMany({
      where: eq(subscriptionPlans.isActive, true),
      orderBy: (t, { asc }) => asc(t.userPackSize),
    }),
  ])
  if (plans.length === 0) return null

  const fit = plans.find((p) => userCount <= p.userPackSize) ?? plans[plans.length - 1]
  const features = fit.features as { aiPackage?: string } | undefined
  return features?.aiPackage ?? null
}

// ─── Main entry point ──────────────────────────────────────────────────

export async function resolveModel(context: MotherRouterContext): Promise<MotherRouterResolution> {
  let resolution: MotherRouterResolution

  if (context.scope === "software_team") {
    const policy = await getActivePolicy(context.scope)
    resolution = computeSoftwareTeamResolution(context.model, context.complexityTier, context.roleKey, policy, context.capabilityCategory)
  } else if (context.scope === "end_user_org") {
    // 3 mutually independent fetches -- none consumes another's result --
    // run concurrently instead of paying their summed latency in sequence.
    const [policy, baseline, aiPackage] = await Promise.all([
      getActivePolicy(context.scope),
      resolveModelConfig(context.orgId, context.layerKey, context.sourceType),
      getOrgAiPackage(context.orgId),
    ])
    if (!baseline) {
      resolution = {
        provider: "groq",
        model: "",
        reason: "resolveModelConfig() returned null (layer not found, cost-guard blocked the org, or no platform key is configured) -- no model to log as resolved",
      }
      await logRoutingDecision(context.scope, context, resolution)
      return resolution
    }
    resolution = computeEndUserOrgResolution(baseline, aiPackage, policy)
  } else if (context.scope === "sales_marketing") {
    const policy = await getActivePolicy(context.scope)
    const role = AI_TEAM_ROSTER.find((r) => r.roleKey === context.roleKey)
    resolution = computeSalesMarketingResolution(context.roleKey, role?.model ?? null, policy)
  } else {
    const policy = await getActivePolicy(context.scope)
    const role = AI_TEAM_ROSTER.find((r) => r.roleKey === context.roleKey)
    resolution = computeCustomerSuccessResolution(context.roleKey, role?.model ?? null, policy)
  }

  await logRoutingDecision(context.scope, context, resolution)
  return resolution
}

// ─── Emergency rollback ─────────────────────────────────────────────────

export type RollbackResult = { ok: true } | { ok: false; error: string }

/** Flips ai_routing_policies back to a previously-created version for a scope. Takes effect on the very next resolveModel() call for that scope (invalidates the cache immediately, not just relying on TTL expiry). */
export async function rollbackPolicy(scope: AiRouterScope, toVersion: number): Promise<RollbackResult> {
  const target = await db.query.aiRoutingPolicies.findFirst({
    where: and(eq(aiRoutingPolicies.scope, scope), eq(aiRoutingPolicies.version, toVersion)),
  })
  if (!target) return { ok: false, error: `No ai_routing_policies row exists for scope="${scope}" version=${toVersion}` }

  await db.transaction(async (tx) => {
    await tx.update(aiRoutingPolicies).set({ isActive: false }).where(and(eq(aiRoutingPolicies.scope, scope), eq(aiRoutingPolicies.isActive, true)))
    await tx.update(aiRoutingPolicies).set({ isActive: true }).where(eq(aiRoutingPolicies.id, target.id))
  })
  invalidateMotherRouterCache()
  return { ok: true }
}
