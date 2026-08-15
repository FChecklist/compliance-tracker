// VERIDIAN Review Framework remediation (Multi-AI Provider Support gap,
// 2026-07-18): "internal AI Team roster is static, not admin-editable."
// This is the resolution layer schema.ts's ai_team_role_overrides table
// comment describes -- roster.ts stays the single source of truth for role
// METADATA (team/title/promptKey/isHuman/isCodeOnly); this module only
// answers "which model does this role actually call right now," checking
// the DB override first and falling back to roster.ts's own static default.
//
// Used by team-service.ts's runRole() (the actual LLM call, for both the
// main dispatch path and every runGuardrailLevel() check underneath it) and
// the tier-eligibility pre-flight check at all 3 real dispatch surfaces
// named in AGENTS.md Operating Rule 10 (/api/ai/team/dispatch,
// dispatch-repo.ts, scripts/ai-workforce-agent.mjs) -- resolving the SAME
// effective model at both the check and the actual call is what keeps an
// override from ever being a way to silently bypass model-tier-
// eligibility.ts's guardrail (checking the static model but calling an
// overridden weaker one would be exactly that bypass).
import { db, aiTeamRoleOverrides, aiModelRegistry } from "@/lib/db"
import { eq } from "drizzle-orm"
import { AI_TEAM_ROSTER, getRole } from "./roster"
import { isModelEligibleForTier } from "../model-tier-eligibility"
import type { ComplexityTier } from "../task-tightening"

// VERIDIAN Review Framework remediation (AI Router model-agnosticism gap,
// 2026-07-19): before this, "known model" meant "already hardcoded
// somewhere in roster.ts's own static AI_TEAM_ROSTER array" -- so an
// override could only ever REASSIGN a role to a model some role already
// used, and introducing a genuinely new model still required a code
// change, contradicting the platform's own "swap a model without a code
// deploy" principle. Now sources from platform.ai_model_registry (the
// Mother Router's registry, see mother-router.ts/schema.ts) instead: a
// model is "known" once it has an active row there, which is a DB insert,
// not a deploy. Deliberately does NOT touch model-tier-eligibility.ts's
// JUDGMENT_ELIGIBLE/INTEGRATIVE_ELIGIBLE -- "is this a real/known model at
// all" and "is it TRUSTED for judgment-critical work" are different
// questions; the latter stays a hardcoded, code-reviewed guardrail per
// AGENTS.md Operating Rule 9.
async function activeRegistryModels(): Promise<string[]> {
  const rows = await db.query.aiModelRegistry.findMany({ where: eq(aiModelRegistry.status, "active") })
  return rows.map((r) => r.model)
}

/**
 * Async, registry-backed. Fails OPEN to roster.ts's own static models on a
 * DB error -- same "never let a transient DB hiccup break an otherwise-
 * working resolution/validation path" posture as resolveEffectiveModel()
 * below, not a new one invented for this function.
 */
export async function isKnownModel(model: string): Promise<boolean> {
  try {
    const registryModels = await activeRegistryModels()
    return registryModels.includes(model)
  } catch (err) {
    // `model` is externally controlled (passed through from setRoleOverride's
    // API caller) -- kept OUT of the template literal and passed as its own
    // console.error argument instead, so it's never part of the first
    // argument util.format() parses for %-style format specifiers (CodeQL
    // js/tainted-format-string).
    console.error("[roster-overrides] failed to read ai_model_registry, falling back to roster.ts's static models for isKnownModel():", model, err)
    return AI_TEAM_ROSTER.some((r) => r.model === model)
  }
}

export async function knownModels(): Promise<string[]> {
  try {
    const registryModels = await activeRegistryModels()
    return Array.from(new Set(registryModels)).sort()
  } catch (err) {
    console.error("[roster-overrides] failed to read ai_model_registry, falling back to roster.ts's static models for knownModels():", err)
    const staticModels = AI_TEAM_ROSTER.map((r) => r.model).filter((m): m is string => m !== null)
    return Array.from(new Set(staticModels)).sort()
  }
}

type RoleOverrideRow = { model: string; candidateModel: string | null; rolloutPercentage: number | null }

async function getRoleOverrideRow(roleKey: string): Promise<RoleOverrideRow | null> {
  const row = await db.query.aiTeamRoleOverrides.findFirst({ where: eq(aiTeamRoleOverrides.roleKey, roleKey) })
  if (!row) return null
  return { model: row.model, candidateModel: row.candidateModel ?? null, rolloutPercentage: row.rolloutPercentage ?? null }
}

async function getRoleOverride(roleKey: string): Promise<string | null> {
  const row = await getRoleOverrideRow(roleKey)
  return row?.model ?? null
}

/**
 * Effective model for a role: the DB override if one exists and is still a
 * recognized model, else roster.ts's own static default. Returns null for
 * human/code-only roles (nothing to override) or an unknown roleKey.
 *
 * Fails OPEN to the static default, never closed: a DB read error here
 * must never be the reason an otherwise-working dispatch breaks -- an
 * override layer that can take down the whole AI Team on a transient DB
 * hiccup would be a net reliability regression, not an improvement.
 *
 * Deliberately unaware of candidateModel/rolloutPercentage (below) --
 * every pre-existing caller of this function keeps resolving exactly the
 * plain override it always has, unaffected by this wave's addition. Only
 * resolveDispatchModel() (below) reads the rollout columns.
 */
export async function resolveEffectiveModel(roleKey: string): Promise<string | null> {
  const role = getRole(roleKey)
  if (!role?.model) return role?.model ?? null

  try {
    const override = await getRoleOverride(roleKey)
    if (override && (await isKnownModel(override))) return override
    return role.model
  } catch (err) {
    console.error(`[roster-overrides] failed to resolve override for '${roleKey}', falling back to roster.ts's static default:`, err)
    return role.model
  }
}

export type ModelResolution = { model: string; variant: "primary" | "candidate" }

/**
 * A/B / shadow-testing candidate-model resolver (VERIDIAN Review Framework
 * gap-closure, 2026-08-15, "AI Model Lifecycle & Benchmarking: A/B or
 * shadow-testing capability for a candidate model" -- Critical). Extends
 * the SAME admin-editable ai_team_role_overrides row resolveEffectiveModel()
 * already reads (drizzle/0313's candidate_model/rollout_percentage
 * columns) -- a real A/B rollout needs the identical live-toggle-without-
 * a-deploy property that table already gives the plain model override, so
 * this is additive to that existing config surface, not a second one.
 *
 * Deliberately REQUIRES `complexityTier` to ever select the candidate: if
 * omitted, this always returns the primary effective model (identical to
 * resolveEffectiveModel()). This is the fail-safe -- a call site that
 * doesn't know (or doesn't pass) the task's tier has no way to
 * accidentally route judgment-critical work to an unproven candidate; only
 * a caller that explicitly supplies the tier can ever activate a rollout,
 * and even then only when the candidate is itself eligible for that tier
 * per model-tier-eligibility.ts -- a rollout config can never be used to
 * sneak a not-yet-trusted model past that guardrail.
 *
 * `randomValue` defaults to Math.random() but is a real parameter (not
 * just a test seam): a caller that must keep a tier pre-flight check and
 * the actual dispatched model in agreement (e.g. checking eligibility,
 * then calling the model) should draw ONE random value and pass it to
 * both calls -- otherwise each call draws its own bucket independently and
 * the tier check could pass for a different variant than the one that
 * actually runs. See /api/ai/team/dispatch/route.ts for the real call site
 * that does this.
 */
export async function resolveDispatchModel(roleKey: string, complexityTier?: ComplexityTier, randomValue: number = Math.random()): Promise<ModelResolution | null> {
  const role = getRole(roleKey)
  if (!role?.model) return null

  try {
    const override = await getRoleOverrideRow(roleKey)
    const primary = override?.model && (await isKnownModel(override.model)) ? override.model : role.model

    if (!complexityTier || !override?.candidateModel || !override.rolloutPercentage || override.rolloutPercentage <= 0) {
      return { model: primary, variant: "primary" }
    }
    if (!(await isKnownModel(override.candidateModel))) return { model: primary, variant: "primary" }
    if (!isModelEligibleForTier(override.candidateModel, complexityTier)) return { model: primary, variant: "primary" }

    const pct = Math.min(100, Math.max(0, override.rolloutPercentage))
    if (randomValue * 100 < pct) return { model: override.candidateModel, variant: "candidate" }
    return { model: primary, variant: "primary" }
  } catch (err) {
    // roleKey is caller-controlled -- never fold it into console.error's first (format-string)
    // argument; Node treats %s/%d/etc in that position as printf-style substitutions against the
    // args that follow, so an attacker-influenced roleKey could otherwise corrupt/inject log
    // output (CodeQL js/tainted-format-string). Pass it as plain data instead.
    console.error("[roster-overrides] failed to resolve dispatch model, falling back to roster.ts's static default:", { roleKey, err })
    return { model: role.model, variant: "primary" }
  }
}

/**
 * Sets (or replaces) a role's A/B rollout config. Validates against
 * roster.ts and the model registry directly, same posture as
 * setRoleOverride() below -- an admin UI bug or malformed request must
 * never persist a rollout for a human/code-only role, an unrecognized
 * candidate model id, or an out-of-range percentage (the DB CHECK
 * constraint, drizzle/0313, is the last-resort backstop, not the primary
 * gate). Preserves any existing plain `model` override untouched (falls
 * back to the role's static default only when no override row exists yet)
 * -- setting a rollout must never silently reset an unrelated override.
 */
export async function setRoleRollout(roleKey: string, candidateModel: string, rolloutPercentage: number, updatedByUserId: string, reason?: string): Promise<void> {
  const role = getRole(roleKey)
  if (!role) throw new Error(`Unknown role_key '${roleKey}'`)
  if (role.isHuman || role.isCodeOnly || !role.model) {
    throw new Error(`Role '${roleKey}' is not LLM-backed (human or code-only) -- it has no model to test a candidate against.`)
  }
  if (!Number.isInteger(rolloutPercentage) || rolloutPercentage < 0 || rolloutPercentage > 100) {
    throw new Error(`rolloutPercentage must be an integer between 0 and 100 (got ${rolloutPercentage}).`)
  }
  if (!(await isKnownModel(candidateModel))) {
    throw new Error(`Candidate model '${candidateModel}' is not a recognized model (see roster-overrides.ts's knownModels()) -- refusing to roll out an unverified model id.`)
  }

  const existing = await getRoleOverrideRow(roleKey)
  const baseModel = existing?.model ?? role.model

  await db
    .insert(aiTeamRoleOverrides)
    .values({ roleKey, model: baseModel, candidateModel, rolloutPercentage, updatedByUserId, reason: reason ?? null })
    .onConflictDoUpdate({
      target: aiTeamRoleOverrides.roleKey,
      set: { candidateModel, rolloutPercentage, updatedByUserId, reason: reason ?? null, updatedAt: new Date() },
    })
}

/** Turns off a role's rollout (candidateModel/rolloutPercentage -> NULL) without touching any plain model override on the same row. */
export async function clearRoleRollout(roleKey: string): Promise<void> {
  await db
    .update(aiTeamRoleOverrides)
    .set({ candidateModel: null, rolloutPercentage: null, updatedAt: new Date() })
    .where(eq(aiTeamRoleOverrides.roleKey, roleKey))
}

/** Sets (or replaces) the model override for one LLM-backed role. Validates against roster.ts directly rather than trusting the caller -- an admin UI bug or a malformed request must never persist an override for a human/code-only role or an unrecognized model id. */
export async function setRoleOverride(roleKey: string, model: string, updatedByUserId: string, reason?: string): Promise<void> {
  const role = getRole(roleKey)
  if (!role) throw new Error(`Unknown role_key '${roleKey}'`)
  if (role.isHuman || role.isCodeOnly || !role.model) {
    throw new Error(`Role '${roleKey}' is not LLM-backed (human or code-only) -- it has no model to override.`)
  }
  if (!(await isKnownModel(model))) {
    throw new Error(`Model '${model}' is not a recognized model (see roster-overrides.ts's knownModels()) -- refusing to set an override to an unverified model id.`)
  }

  await db
    .insert(aiTeamRoleOverrides)
    .values({ roleKey, model, updatedByUserId, reason: reason ?? null })
    .onConflictDoUpdate({
      target: aiTeamRoleOverrides.roleKey,
      set: { model, updatedByUserId, reason: reason ?? null, updatedAt: new Date() },
    })
}

// A full row delete -- clearing the plain override also clears any active
// rollout on the same role (candidateModel/rolloutPercentage live on this
// same row, drizzle/0313), since there's no override row left for
// resolveDispatchModel() to read a candidate from. If a role has BOTH a
// plain override and an active rollout and only the rollout should be
// turned off, call clearRoleRollout() instead -- it nulls just those two
// columns and leaves the row (and any plain override) intact.
export async function clearRoleOverride(roleKey: string): Promise<void> {
  await db.delete(aiTeamRoleOverrides).where(eq(aiTeamRoleOverrides.roleKey, roleKey))
}

export type RosterRowWithOverride = {
  roleKey: string
  team: string
  title: string
  staticModel: string | null
  overrideModel: string | null
  effectiveModel: string | null
  candidateModel: string | null
  rolloutPercentage: number | null
  isHuman: boolean
  isCodeOnly: boolean
}

/** Every roster role joined against its current override + rollout config (if any) -- what the admin UI/roster API actually renders. */
export async function listRosterWithOverrides(): Promise<RosterRowWithOverride[]> {
  // Fetches the active registry list ONCE (not per-role via isKnownModel())
  // -- same fail-open fallback as isKnownModel() itself, just batched so
  // rendering the full roster doesn't issue one query per role.
  const [overrides, knownModelsList] = await Promise.all([db.query.aiTeamRoleOverrides.findMany(), knownModels()])
  const overrideByRole = new Map(overrides.map((o) => [o.roleKey, o]))
  const knownModelSet = new Set(knownModelsList)

  return AI_TEAM_ROSTER.map((r) => {
    const override = overrideByRole.get(r.roleKey)
    const overrideModel = override?.model ?? null
    const effectiveModel = overrideModel && knownModelSet.has(overrideModel) ? overrideModel : r.model
    return {
      roleKey: r.roleKey, team: r.team, title: r.title,
      staticModel: r.model, overrideModel, effectiveModel,
      candidateModel: override?.candidateModel ?? null,
      rolloutPercentage: override?.rolloutPercentage ?? null,
      isHuman: !!r.isHuman, isCodeOnly: !!r.isCodeOnly,
    }
  })
}
