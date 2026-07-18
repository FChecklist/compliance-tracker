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
import { db, aiTeamRoleOverrides } from "@/lib/db"
import { eq } from "drizzle-orm"
import { AI_TEAM_ROSTER, getRole } from "./roster"

// Any model already assigned to at least one real role in roster.ts is
// "known" -- deliberately NOT an open string field. An override is only
// ever useful if it points at a model this codebase's own llm-client.ts/
// OPENROUTER_PROVIDER_PREFERENCE/MODEL_PRICING already knows how to call
// and price; every model with a real roster.ts assignment already
// satisfies that (see roster.ts's own header for how each model constant
// got there). Refusing an unrecognized model id here is cheaper and safer
// than discovering the typo at OpenRouter call time.
const KNOWN_MODELS = new Set(AI_TEAM_ROSTER.map((r) => r.model).filter((m): m is string => m !== null))

export function isKnownModel(model: string): boolean {
  return KNOWN_MODELS.has(model)
}

export function knownModels(): string[] {
  return Array.from(KNOWN_MODELS).sort()
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
    if (override && isKnownModel(override)) return override
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
  if (!isKnownModel(model)) {
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
  const overrides = await db.query.aiTeamRoleOverrides.findMany()
  const overrideByRole = new Map(overrides.map((o) => [o.roleKey, o.model]))

  return AI_TEAM_ROSTER.map((r) => {
    const overrideModel = overrideByRole.get(r.roleKey) ?? null
    const effectiveModel = overrideModel && isKnownModel(overrideModel) ? overrideModel : r.model
    return {
      roleKey: r.roleKey, team: r.team, title: r.title,
      staticModel: r.model, overrideModel, effectiveModel,
      isHuman: !!r.isHuman, isCodeOnly: !!r.isCodeOnly,
    }
  })
}
