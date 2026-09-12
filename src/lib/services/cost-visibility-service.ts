// R85 Addendum 3 v4, Phase 6 -- VISIBILITY AND THE CLIENT BOUNDARY (Part H:
// deliberately sequenced BEFORE Phase 7 exports -- build the boundary before
// the thing it protects exists). Owner rulings D87 (claude_log 366), D88
// (372), D89 (373), D90 (374), D91 (375). Work order: Google Drive
// WORK_ORDER_R85_ADDENDUM_3_v4_R50_FINAL.md, gates 6-01..6-05. Supersession
// notice: claude_log id 379. Section A9 explicitly discarded (do not
// resurrect): a per-project toggle, a one-unit-cost-with-two-quantities
// model, and a hard freeze at award. None of that lives here.
//
// ★★★ THIS FILE IS THE ONE GATE (6-01/6-04) ★★★
// Every screen/route that shows cost/variance/project-side BOQ figures
// (rate_project above all -- "THE MOST SENSITIVE FIELD IN THE PRODUCT", D91
// B1, schema.ts's own column comment on constructionBoqLineItems.rateProject)
// MUST call canRoleSeeCost() (or the redactProjectSideFields()/
// applyCostVisibility() helpers built on top of it) before returning data to
// a caller. No screen or route may invent its own cost-visibility check --
// that is exactly the "one project telling three different money stories on
// three screens" class of bug this whole work order (see
// boq-dual-view-service.ts's own SINGLE PRODUCER RULE header) exists to
// prevent, applied to WHO sees the number instead of HOW it's computed.
//
// ★★★ THE HARD FLOOR (6-01), NOT CONFIGURABLE BY ANYONE ★★★
// client_viewer can NEVER see cost. This is checked here in application code
// BEFORE any config lookup (so a config-table bug or an empty read can never
// accidentally grant it), and independently enforced at the DB layer by
// compliance.cost_visibility_config's own CHECK constraint
// (cost_visibility_config_no_client_viewer_grant, drizzle/0596) -- belt and
// suspenders, matching this codebase's established convention (audit_logs,
// boq_baseline). See cost-visibility-service.test.ts for the live proof that
// a direct DB write attempting to violate this is rejected by Postgres
// itself (23514), independent of this file.
//
// FAIL-CLOSED BY DESIGN: a role with no configured row for an org is treated
// as NOT having cost visibility (canSeeCost defaults to false), not true --
// an org that never touches the config UI gets the safe default, not an
// accidental leak. An API-key-authenticated caller with no real session user
// (ctx.dbUser) is ALSO treated as not cost-visible, unconditionally -- this
// repo's own auth-guard.ts documents that PROJEXA's server today calls this
// API with a single shared per-org API key, not a per-user VERIDIAN
// identity, so there is no real internal role to check for that caller.
// Nothing in this codebase's current UI reads rate_project/qty_project
// today (Phase 2's dual-view math has no wired-in consumer yet, per the
// Phase 3 claim's own "NOT touching: the BOQ grid UI" note), so this default
// changes no observed behaviour -- it only closes a gap before anything
// depends on it being open, which is exactly why Part H sequences this phase
// before Phase 7 exports.
import { costVisibilityConfig } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { eq, and } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { ROLE_RANK, type UserRole } from "@/lib/supabase/role-rank"

/**
 * Every real role in the system, per src/lib/supabase/role-rank.ts -- the
 * SAME role model every other route/service in this repo already uses
 * (requireRole/hasRole/ROLE_RANK). Deliberately NOT the PROJEXA-repo-only
 * OrgRole shape (owner/admin/pm/site_engineer/member/client_viewer) -- that
 * type lives in the separate FChecklist/projexa repo and is not reachable
 * from here (see this repo's own CLAUDE.md "PROJEXA is a SEPARATE
 * repository" section). Investigated first per G-25 -- no second role model
 * is introduced by this phase.
 */
const ALL_ROLES = Object.keys(ROLE_RANK) as UserRole[]

/**
 * 6-01: the roles a cost-visibility config UI may ever offer a grant for.
 * EVERY real role EXCEPT client_viewer -- this is the list the config
 * route's GET response is built from, so client_viewer is never even an
 * option the frontend can see, let alone submit (the second of the three
 * independent layers the spec asks for, alongside the DB CHECK and the API
 * refusal in setCostVisibilityForRole below).
 */
export const CONFIGURABLE_ROLES: readonly UserRole[] = Object.freeze(
  ALL_ROLES.filter((role) => role !== "client_viewer")
)

export type CostVisibilityConfigRow = {
  role: UserRole
  canSeeCost: boolean
  changedById: string | null
  changedAt: Date | null
}

function toConfigRow(row: {
  role: string
  canSeeCost: boolean
  changedById: string
  changedAt: Date
}): CostVisibilityConfigRow {
  return {
    role: row.role as UserRole,
    canSeeCost: row.canSeeCost,
    changedById: row.changedById,
    changedAt: row.changedAt,
  }
}

/**
 * ★ THE ONE GATE ★ (6-01/6-04). `role` is nullable/undefined on purpose --
 * an API-key-only caller with no resolvable internal user has no role at
 * all, and per this file's own fail-closed default that resolves to false,
 * not an error and not a throw. client_viewer is refused BEFORE the config
 * table is ever read (the hard floor holds even if the config table is
 * empty, mis-seeded, or briefly unreachable).
 */
export async function canRoleSeeCost(ctx: { orgId: string }, role: UserRole | null | undefined): Promise<boolean> {
  if (!role) return false
  if (role === "client_viewer") return false
  return withTenantContext({ orgId: ctx.orgId }, (db) => canRoleSeeCostWithDb(db, ctx.orgId, role))
}

/**
 * *WithDb variant (this codebase's established pattern -- see
 * isBranchEnabledForOrgWithDb/computeUserChainUsageScoresWithDb, and
 * CLAUDE.md's R74/R75 nested-withTenantContext notes) so a caller that
 * already holds an open transaction never opens a second one just to check
 * cost visibility.
 */
export async function canRoleSeeCostWithDb(db: TenantDb, orgId: string, role: UserRole | null | undefined): Promise<boolean> {
  if (!role) return false
  if (role === "client_viewer") return false // hard floor, checked again even inside the *WithDb path
  const row = await db.query.costVisibilityConfig.findFirst({
    where: and(eq(costVisibilityConfig.orgId, orgId), eq(costVisibilityConfig.role, role)),
  })
  // Fail-closed: no row for this org+role means "never configured", which
  // means "not granted" -- never treated as true by omission.
  return row?.canSeeCost ?? false
}

/** 6-01 config read: every configurable role (never client_viewer, see
 * CONFIGURABLE_ROLES) with its current grant, defaulting an unconfigured
 * role to `canSeeCost: false` so the UI can render a complete, honest
 * picture rather than only the rows someone has already touched. */
export async function listCostVisibilityConfig(ctx: { orgId: string }): Promise<CostVisibilityConfigRow[]> {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const rows = await db.query.costVisibilityConfig.findMany({ where: eq(costVisibilityConfig.orgId, ctx.orgId) })
    const byRole = new Map(rows.map((r) => [r.role, toConfigRow(r)]))
    return CONFIGURABLE_ROLES.map(
      (role) => byRole.get(role) ?? { role, canSeeCost: false, changedById: null, changedAt: null }
    )
  })
}

/**
 * 6-01/6-02: grant or revoke one role's cost visibility for this org.
 * APPLICATION-LAYER refusal of a client_viewer grant -- the FIRST of the two
 * independent layers the spec asks for (the DB CHECK constraint,
 * cost_visibility_config_no_client_viewer_grant, is the second and does not
 * depend on this check ever running). changedById/changedAt are ALWAYS
 * rewritten together (6-02: "every visibility change captured") -- there is
 * no code path that updates canSeeCost without also stamping who and when.
 */
export async function setCostVisibilityForRole(
  ctx: { orgId: string; userId: string },
  role: UserRole,
  canSeeCost: boolean
): Promise<CostVisibilityConfigRow> {
  if (role === "client_viewer" && canSeeCost) {
    throw new ServiceError(
      "client_viewer can never be granted cost visibility -- this is a hard floor, not a configurable option (D91 B1).",
      400
    )
  }
  if (!ALL_ROLES.includes(role)) {
    throw new ServiceError(`Unknown role "${role}".`, 400)
  }

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [row] = await db
      .insert(costVisibilityConfig)
      .values({ orgId: ctx.orgId, role, canSeeCost, changedById: ctx.userId })
      .onConflictDoUpdate({
        target: [costVisibilityConfig.orgId, costVisibilityConfig.role],
        set: { canSeeCost, changedById: ctx.userId, changedAt: new Date() },
      })
      .returning()
    return toConfigRow(row)
  })
}

// ─── Response redaction (6-03) ────────────────────────────────────────────

/**
 * The R85 Addendum 3 dual-view project-side field names (camelCase, as they
 * appear in an actual JSON API response) -- the raw stored columns
 * (qtyProject/rateProject) plus every computed figure
 * boq-dual-view-service.ts's computeBoqLineMoneyView/rollUpRootLines/
 * computeCostCoverage can produce. Deliberately does NOT include
 * qtyContract/rateContract/contractValue (the customer-facing, contract
 * side -- what a client is actually billed, always visible) or the
 * pre-existing, separate budgetPercentage/vendorAmount/materialAmount/
 * manpowerAmount budget-overlay columns (Point 154, out of scope for this
 * phase -- see this phase's ACTIVE-CLAIMS.yaml entry).
 */
export const PROJECT_SIDE_COST_FIELDS: ReadonlySet<string> = new Set([
  "qtyProject",
  "rateProject",
  "projectValue",
  "variance",
  "variancePercent",
  "quantityVariance",
  "rateVariance",
  "coveredContractValue",
  "coverageRatio",
  // Baseline delta shapes (boq-baseline-service.ts's BoqBaselineLineDelta),
  // named distinctly from the fields above but carrying the same
  // information -- redacted for the same reason.
  "projectValueDelta",
])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date)
}

/**
 * Deep-walks any JSON-serializable value (exactly what NextResponse.json()
 * sends) and strips every key in PROJECT_SIDE_COST_FIELDS, at any nesting
 * depth -- a BOQ list's `lineItems[]`, a compare route's
 * `added[]`/`removed[]`/`changed[].before`/`changed[].after`, a baseline
 * delta's nested `a`/`b` BoqLineMoneyView, etc. all get the same treatment
 * with no per-shape adapter required. This is what makes it safe to call
 * from any route regardless of that route's exact response shape (6-03/6-04
 * -- "no screen should invent its own visibility check", the same posture
 * extended to "no screen should invent its own redaction shape" either).
 *
 * Does not mutate the input -- returns a new structure, so a caller that
 * still holds a reference to the original (unredacted) object elsewhere in
 * the same request cannot accidentally leak it back out.
 */
export function redactProjectSideFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactProjectSideFields(item)) as unknown as T
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value)) {
      if (PROJECT_SIDE_COST_FIELDS.has(key)) continue
      out[key] = redactProjectSideFields(v)
    }
    return out as T
  }
  return value
}

/**
 * The single call a route makes: resolve visibility, then redact if needed.
 * Combines canRoleSeeCost() + redactProjectSideFields() so a route body
 * never has to remember to call both in the right order.
 */
export async function applyCostVisibility<T>(ctx: { orgId: string }, role: UserRole | null | undefined, data: T): Promise<T> {
  const canSeeCost = await canRoleSeeCost(ctx, role)
  return canSeeCost ? data : redactProjectSideFields(data)
}

/**
 * Same as applyCostVisibility, but for an UNAUTHENTICATED context (a public
 * share-token resolve, 6-03b) where there is no role to check at all --
 * always redacts, unconditionally, regardless of which internal user
 * created the link. "must never carry cost/project-side/variance fields
 * either, even for a share token an internal user created" -- there is no
 * canRoleSeeCost lookup here on purpose: a public link has no caller
 * identity to grant visibility to, ever.
 */
export function redactForPublicShare<T>(data: T): T {
  return redactProjectSideFields(data)
}
