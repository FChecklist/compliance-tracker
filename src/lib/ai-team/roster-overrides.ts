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
    console.error(`[roster-overrides] failed to read ai_model_registry, falling back to roster.ts's static models for isKnownModel('${model}'):`, err)
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

async function getRoleOverride(roleKey: string): Promise<string | null> {
  const row = await db.query.aiTeamRoleOverrides.findFirst({ where: eq(aiTeamRoleOverrides.roleKey, roleKey) })
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
  isHuman: boolean
  isCodeOnly: boolean
}

/** Every roster role joined against its current override (if any) -- what the admin UI/roster API actually renders. */
export async function listRosterWithOverrides(): Promise<RosterRowWithOverride[]> {
  // Fetches the active registry list ONCE (not per-role via isKnownModel())
  // -- same fail-open fallback as isKnownModel() itself, just batched so
  // rendering the full roster doesn't issue one query per role.
  const [overrides, knownModelsList] = await Promise.all([db.query.aiTeamRoleOverrides.findMany(), knownModels()])
  const overrideByRole = new Map(overrides.map((o) => [o.roleKey, o.model]))
  const knownModelSet = new Set(knownModelsList)

  return AI_TEAM_ROSTER.map((r) => {
    const overrideModel = overrideByRole.get(r.roleKey) ?? null
    const effectiveModel = overrideModel && knownModelSet.has(overrideModel) ? overrideModel : r.model
    return {
      roleKey: r.roleKey, team: r.team, title: r.title,
      staticModel: r.model, overrideModel, effectiveModel,
      isHuman: !!r.isHuman, isCodeOnly: !!r.isCodeOnly,
    }
  })
}
