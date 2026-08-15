// Wave 22 (Prompt Operating System) service layer. Creating a new prompt
// version is veridian_admin-gated -- prompt content is a platform-governed
// asset, same authority bar as publishing a worker agent (Wave 16), not
// something any org admin can edit.
import { db, promptTemplates, promptVersions } from "@/lib/db"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"
import { withTenantContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { recordAuditTrigger } from "@/lib/audit-event-triggers"
import { requirePromptPermissionForUser } from "./permission-service"
import { runLifecycleTransitionGates, recordPromptGovernanceEvent } from "./prompt-governance-service"

export type PromptOsContext = { userId: string; dbUser: typeof users.$inferSelect }

export type PromptVersionBump = "major" | "minor" | "patch"

// Computes the next MAJOR.MINOR.PATCH from the latest version's own triple
// (VERIDIAN_Architecture_v2.0 phase_1, 2026-07-25) -- standard semver bump
// semantics: a major bump resets minor+patch, a minor bump resets patch, a
// patch bump only increments patch. A template's first-ever version always
// starts at 1.0.0 regardless of `bump`.
export function nextSemanticVersion(latest: { major: number; minor: number; patch: number } | undefined, bump: PromptVersionBump) {
  if (!latest) return { major: 1, minor: 0, patch: 0 }
  if (bump === "major") return { major: latest.major + 1, minor: 0, patch: 0 }
  if (bump === "minor") return { major: latest.major, minor: latest.minor + 1, patch: 0 }
  return { major: latest.major, minor: latest.minor, patch: latest.patch + 1 }
}

export async function createPromptVersion(
  ctx: PromptOsContext,
  input: { templateKey: string; content: string; label?: string; bump?: PromptVersionBump }
) {
  requirePromptPermissionForUser(ctx.dbUser, "prompt.version.create")
  const content = input.content?.trim()
  if (!content) throw new ServiceError("content is required", 400)

  const template = await db.query.promptTemplates.findFirst({ where: eq(promptTemplates.templateKey, input.templateKey) })
  if (!template) throw new ServiceError("Unknown templateKey", 404)

  const label = input.label ?? null
  const bump = input.bump ?? "minor"

  // Only one version per template may hold a given label at a time --
  // demote the current holder before promoting the new version, same
  // upsert-adjacent discipline as module-rule-service.ts's setModuleRule.
  return db.transaction(async (tx) => {
    if (label) {
      await tx.update(promptVersions)
        .set({ label: null })
        .where(and(eq(promptVersions.promptTemplateId, template.id), eq(promptVersions.label, label)))
    }

    const latest = await tx.query.promptVersions.findFirst({
      where: eq(promptVersions.promptTemplateId, template.id),
      orderBy: (t, { desc }) => desc(t.version),
    })
    const nextVersion = (latest?.version ?? 0) + 1
    const semver = nextSemanticVersion(latest, bump)

    const [row] = await tx.insert(promptVersions).values({
      promptTemplateId: template.id, version: nextVersion, content, label, createdById: ctx.userId,
      major: semver.major, minor: semver.minor, patch: semver.patch,
    }).returning()

    return {
      id: row.id, templateKey: input.templateKey, version: row.version, label: row.label,
      major: row.major, minor: row.minor, patch: row.patch, lifecycleState: row.lifecycleState,
      createdAt: row.createdAt.toISOString(),
    }
  }).then(async (result) => {
    // D15.B2.S1 named event #9, "New Prompt -> Prompt Audit". Prompt
    // templates/versions are deliberately platform-wide (PromptOsContext has
    // no orgId -- see this file's own header), but audit_logs.orgId is
    // NOT NULL (schema.ts) and there is no platform-scoped audit-trail table
    // in this codebase to write into instead (checked: activity_log.orgId is
    // also NOT NULL). Rather than invent a new table/migration for one event,
    // this uses the acting admin's own real orgId (ctx.dbUser.orgId) -- never
    // fabricated -- which is null only for the rare platform-only admin
    // account with no org membership at all, in which case this best-effort
    // write is skipped rather than faked. Runs in its own transaction, after
    // the version write above already committed, since createPromptVersion
    // doesn't run inside withTenantContext (platform-wide tables have no RLS
    // org scope to establish).
    if (ctx.dbUser.orgId) {
      await withTenantContext({ orgId: ctx.dbUser.orgId, userId: ctx.userId }, (tx) =>
        recordAuditTrigger({
          tx, event: "new_prompt", entityType: "prompt_version", entityId: result.id, orgId: ctx.dbUser.orgId!,
          dbUser: ctx.dbUser, details: `New version ${result.version} of prompt template "${input.templateKey}" created.`,
        })
      ).catch((err) => console.error(`[audit-trigger] failed to record new_prompt for prompt version ${result.id}:`, err))
    }
    return result
  })
}

export async function listPromptVersions(templateKey?: string) {
  const template = templateKey
    ? await db.query.promptTemplates.findFirst({ where: eq(promptTemplates.templateKey, templateKey) })
    : null
  if (templateKey && !template) throw new ServiceError("Unknown templateKey", 404)

  const templates = template
    ? [template]
    : await db.query.promptTemplates.findMany({ orderBy: (t, { asc }) => asc(t.templateKey) })

  const results = await Promise.all(
    templates.map(async (t) => {
      const versions = await db.query.promptVersions.findMany({
        where: eq(promptVersions.promptTemplateId, t.id),
        orderBy: (v, { desc }) => desc(v.version),
      })
      return {
        templateKey: t.templateKey, displayName: t.displayName, description: t.description,
        versions: versions.map((v) => ({
          id: v.id, version: v.version, content: v.content, label: v.label, isActive: v.isActive, createdAt: v.createdAt.toISOString(),
          major: v.major, minor: v.minor, patch: v.patch, lifecycleState: v.lifecycleState,
          rolledBackFromVersionId: v.rolledBackFromVersionId,
        })),
      }
    })
  )
  return results
}

// ─── VERIDIAN_Architecture_v2.0 phase_1 (2026-07-25): lifecycle state
// machine + diff/rollback, additive on top of createPromptVersion/
// listPromptVersions above -- see schema.ts's promptVersions header
// comment and drizzle/0262 for what changed at the data layer.

export type PromptLifecycleState = "Draft" | "Review" | "Staging" | "Production" | "Deprecated"

// Bare state machine only -- this is what the phase plan's own scope note
// calls out as this phase's boundary: WHICH transitions are structurally
// legal. The APPROVAL-GATE enforcement on top (e.g. requiring a second
// admin's sign-off before Staging -> Production) is phase_3
// (governance_policy_cost_engines) scope, not this one's.
export const ALLOWED_LIFECYCLE_TRANSITIONS: Record<PromptLifecycleState, PromptLifecycleState[]> = {
  Draft: ["Review"],
  Review: ["Draft", "Staging"],
  Staging: ["Review", "Production"],
  Production: ["Deprecated"],
  Deprecated: [],
}

export function isLegalLifecycleTransition(from: PromptLifecycleState, to: PromptLifecycleState): boolean {
  return (ALLOWED_LIFECYCLE_TRANSITIONS[from] ?? []).includes(to)
}

// VERIDIAN_Architecture_v2.0 phase_3 (2026-07-26): the approval-gate
// PERMISSION_ACTION_FOR_TRANSITION below is the named, per-transition
// permission phase_1's own comment deferred here ("distinct access/edit/
// approve/deploy permissions rather than one coarse admin role" --
// engine-permission). Role bar is unchanged (still veridian_admin -- see
// permission-service.ts's own header for why this session doesn't lower
// it); what governs whether a SPECIFIC transition is allowed right now is
// prompt-governance-service.ts's runLifecycleTransitionGates() below.
function permissionActionForTransition(toState: PromptLifecycleState): "prompt.version.transition_review" | "prompt.version.approve_staging" | "prompt.version.promote_production" | "prompt.version.deprecate" {
  if (toState === "Staging") return "prompt.version.approve_staging"
  if (toState === "Production") return "prompt.version.promote_production"
  if (toState === "Deprecated") return "prompt.version.deprecate"
  return "prompt.version.transition_review" // Review or back to Draft
}

export async function transitionPromptLifecycle(
  ctx: PromptOsContext,
  input: { versionId: string; toState: PromptLifecycleState }
) {
  requirePromptPermissionForUser(ctx.dbUser, permissionActionForTransition(input.toState))

  const version = await db.query.promptVersions.findFirst({ where: eq(promptVersions.id, input.versionId) })
  if (!version) throw new ServiceError("Unknown prompt version", 404)

  const fromState = version.lifecycleState as PromptLifecycleState
  if (!isLegalLifecycleTransition(fromState, input.toState)) {
    throw new ServiceError(`Illegal lifecycle transition: ${fromState} -> ${input.toState}`, 400)
  }

  const template = await db.query.promptTemplates.findFirst({ where: eq(promptTemplates.id, version.promptTemplateId) })
  if (!template) throw new ServiceError("Prompt template for this version no longer exists", 404)

  // The full governance-lifecycle-state-machine gate stack (business rule,
  // policy/ABAC, compliance/PII, governance/ownership, maker-checker) --
  // read-only advisory dependents list + which timestamp fields this
  // transition should set on success, per runLifecycleTransitionGates'
  // own contract. Runs OUTSIDE withTenantContext (this function has none
  // open) since prompt lifecycle objects are platform-wide -- ABAC checks
  // inside the gate function only fire when ctx.dbUser.orgId is real,
  // matching the exact same best-effort-when-orgless posture
  // createPromptVersion's audit write already established.
  const gateResult = await withTenantContextOrPlain(ctx, (tx) =>
    runLifecycleTransitionGates(tx, {
      versionId: version.id, templateId: template.id, templateKey: template.templateKey, content: version.content,
      createdById: version.createdById, fromState, toState: input.toState, stagingEnteredAt: version.stagingEnteredAt,
      actingUserId: ctx.userId, actingOrgId: ctx.dbUser.orgId ?? null,
    })
  )

  const updateValues: Partial<typeof promptVersions.$inferInsert> = { lifecycleState: input.toState }
  if (gateResult.setStagingEnteredAt) updateValues.stagingEnteredAt = new Date()
  if (gateResult.setApproval) {
    updateValues.approvedById = ctx.userId
    updateValues.approvedAt = new Date()
  }

  const [row] = await db.update(promptVersions)
    .set(updateValues)
    .where(eq(promptVersions.id, input.versionId))
    .returning()

  if (ctx.dbUser.orgId) {
    await withTenantContext({ orgId: ctx.dbUser.orgId, userId: ctx.userId }, (tx) =>
      recordPromptGovernanceEvent(tx, {
        orgId: ctx.dbUser.orgId!, dbUser: ctx.dbUser, entityId: row.id,
        action: "prompt_lifecycle.transition",
        details: `Prompt template "${template.templateKey}" version ${version.version}: ${fromState} -> ${input.toState}.${gateResult.dependents.length ? ` ${gateResult.dependents.length} known call site(s): ${gateResult.dependents.map((d) => d.file).join(", ")}` : ""}`,
      })
    ).catch((err) => console.error(`[audit] failed to record prompt_lifecycle.transition for version ${row.id}:`, err))
  }

  return { id: row.id, lifecycleState: row.lifecycleState, previousState: fromState, dependents: gateResult.dependents }
}

// runLifecycleTransitionGates needs a TenantDb (checkAbacDenyPoliciesWithDb/
// tx.query.promptTemplates require it), but this function has no tenant
// context open for an orgless platform admin. withTenantContext requires a
// real orgId, so this opens one only when ctx.dbUser.orgId is real;
// otherwise runs the gate function against the raw `db` client cast as
// TenantDb -- safe here because every gate that actually needs org-scoped
// RLS (the ABAC check) is itself skipped internally when actingOrgId is
// null, and promptTemplates/promptVersions are platform-wide tables with no
// RLS policy gating this read either way.
async function withTenantContextOrPlain<T>(ctx: PromptOsContext, fn: (tx: TenantDb) => Promise<T>): Promise<T> {
  if (ctx.dbUser.orgId) {
    return withTenantContext({ orgId: ctx.dbUser.orgId, userId: ctx.userId }, fn)
  }
  return fn(db as unknown as TenantDb)
}

export type PromptVersionDiffLine = { type: "context" | "added" | "removed"; value: string }

export async function diffPromptVersions(templateKey: string, fromVersion: number, toVersion: number) {
  const template = await db.query.promptTemplates.findFirst({ where: eq(promptTemplates.templateKey, templateKey) })
  if (!template) throw new ServiceError("Unknown templateKey", 404)

  const [from, to] = await Promise.all([
    db.query.promptVersions.findFirst({ where: and(eq(promptVersions.promptTemplateId, template.id), eq(promptVersions.version, fromVersion)) }),
    db.query.promptVersions.findFirst({ where: and(eq(promptVersions.promptTemplateId, template.id), eq(promptVersions.version, toVersion)) }),
  ])
  if (!from) throw new ServiceError(`Version ${fromVersion} not found for prompt template "${templateKey}"`, 404)
  if (!to) throw new ServiceError(`Version ${toVersion} not found for prompt template "${templateKey}"`, 404)

  return { templateKey, fromVersion, toVersion, lines: diffContentLines(from.content, to.content) }
}

// Minimal line-level LCS diff. Deliberately no external dependency for
// this: package.json's "diff": "5.2.2" entry lives under `overrides` (a
// transitive-version pin for whatever pulls it in indirectly), not under
// `dependencies`/`devDependencies`, so it is not a real installed app
// dependency to import from -- confirmed before writing this. Prompt
// content here is at most a few hundred lines, so plain O(n*m) LCS is
// fine; this is not a general-purpose diff library.
export function diffContentLines(a: string, b: string): PromptVersionDiffLine[] {
  const linesA = a.split("\n")
  const linesB = b.split("\n")
  const n = linesA.length
  const m = linesB.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = linesA[i] === linesB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const result: PromptVersionDiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (linesA[i] === linesB[j]) {
      result.push({ type: "context", value: linesA[i] }); i++; j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      result.push({ type: "removed", value: linesA[i] }); i++
    } else {
      result.push({ type: "added", value: linesB[j] }); j++
    }
  }
  while (i < n) { result.push({ type: "removed", value: linesA[i] }); i++ }
  while (j < m) { result.push({ type: "added", value: linesB[j] }); j++ }
  return result
}

export async function rollbackPromptVersion(
  ctx: PromptOsContext,
  input: { templateKey: string; toVersion: number; label?: string }
) {
  requirePromptPermissionForUser(ctx.dbUser, "prompt.version.rollback")

  const template = await db.query.promptTemplates.findFirst({ where: eq(promptTemplates.templateKey, input.templateKey) })
  if (!template) throw new ServiceError("Unknown templateKey", 404)

  const target = await db.query.promptVersions.findFirst({
    where: and(eq(promptVersions.promptTemplateId, template.id), eq(promptVersions.version, input.toVersion)),
  })
  if (!target) throw new ServiceError(`Version ${input.toVersion} not found for prompt template "${input.templateKey}"`, 404)

  const label = input.label ?? null

  // Rollback NEVER mutates or deletes history -- it appends a brand new
  // version whose content matches the target, same append-only posture
  // createPromptVersion already has (this is why prompt_versions has no
  // UPDATE-content path anywhere in this file). rolledBackFromVersionId
  // records real provenance; lifecycleState always restarts at 'Draft' --
  // a restored version re-earns Production status through the state
  // machine above, it is never silently re-promoted.
  return db.transaction(async (tx) => {
    if (label) {
      await tx.update(promptVersions)
        .set({ label: null })
        .where(and(eq(promptVersions.promptTemplateId, template.id), eq(promptVersions.label, label)))
    }

    const latest = await tx.query.promptVersions.findFirst({
      where: eq(promptVersions.promptTemplateId, template.id),
      orderBy: (t, { desc }) => desc(t.version),
    })
    const nextVersion = (latest?.version ?? 0) + 1
    const semver = nextSemanticVersion(latest, "patch")

    const [row] = await tx.insert(promptVersions).values({
      promptTemplateId: template.id, version: nextVersion, content: target.content, label, createdById: ctx.userId,
      major: semver.major, minor: semver.minor, patch: semver.patch,
      lifecycleState: "Draft", rolledBackFromVersionId: target.id,
    }).returning()

    return {
      id: row.id, templateKey: input.templateKey, version: row.version, rolledBackFromVersion: input.toVersion,
      label: row.label, major: row.major, minor: row.minor, patch: row.patch, lifecycleState: row.lifecycleState,
      createdAt: row.createdAt.toISOString(),
    }
  }).then(async (result) => {
    if (ctx.dbUser.orgId) {
      await withTenantContext({ orgId: ctx.dbUser.orgId, userId: ctx.userId }, (tx) =>
        recordAuditTrigger({
          tx, event: "new_prompt", entityType: "prompt_version", entityId: result.id, orgId: ctx.dbUser.orgId!,
          dbUser: ctx.dbUser, details: `Rolled back prompt template "${input.templateKey}" to version ${input.toVersion} (new version ${result.version}).`,
        })
      ).catch((err) => console.error(`[audit-trigger] failed to record new_prompt for prompt version rollback ${result.id}:`, err))
    }
    return result
  })
}
