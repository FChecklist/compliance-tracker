// Wave 22 (Prompt Operating System) service layer. Creating a new prompt
// version is veridian_admin-gated -- prompt content is a platform-governed
// asset, same authority bar as publishing a worker agent (Wave 16), not
// something any org admin can edit.
import { db, promptTemplates, promptVersions } from "@/lib/db"
import { and, eq } from "drizzle-orm"
import { hasRole } from "@/lib/supabase/auth-guard"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { recordAuditTrigger } from "@/lib/audit-event-triggers"

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
  if (!hasRole(ctx.dbUser, "veridian_admin")) {
    throw new ServiceError("Creating a prompt version requires veridian_admin", 403)
  }
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

export async function transitionPromptLifecycle(
  ctx: PromptOsContext,
  input: { versionId: string; toState: PromptLifecycleState }
) {
  if (!hasRole(ctx.dbUser, "veridian_admin")) {
    throw new ServiceError("Transitioning a prompt version's lifecycle requires veridian_admin", 403)
  }

  const version = await db.query.promptVersions.findFirst({ where: eq(promptVersions.id, input.versionId) })
  if (!version) throw new ServiceError("Unknown prompt version", 404)

  const fromState = version.lifecycleState as PromptLifecycleState
  if (!isLegalLifecycleTransition(fromState, input.toState)) {
    throw new ServiceError(`Illegal lifecycle transition: ${fromState} -> ${input.toState}`, 400)
  }

  const [row] = await db.update(promptVersions)
    .set({ lifecycleState: input.toState })
    .where(eq(promptVersions.id, input.versionId))
    .returning()

  return { id: row.id, lifecycleState: row.lifecycleState, previousState: fromState }
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
  if (!hasRole(ctx.dbUser, "veridian_admin")) {
    throw new ServiceError("Rolling back a prompt version requires veridian_admin", 403)
  }

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
