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

export async function createPromptVersion(
  ctx: PromptOsContext,
  input: { templateKey: string; content: string; label?: string }
) {
  if (!hasRole(ctx.dbUser, "veridian_admin")) {
    throw new ServiceError("Creating a prompt version requires veridian_admin", 403)
  }
  const content = input.content?.trim()
  if (!content) throw new ServiceError("content is required", 400)

  const template = await db.query.promptTemplates.findFirst({ where: eq(promptTemplates.templateKey, input.templateKey) })
  if (!template) throw new ServiceError("Unknown templateKey", 404)

  const label = input.label ?? null

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

    const [row] = await tx.insert(promptVersions).values({
      promptTemplateId: template.id, version: nextVersion, content, label, createdById: ctx.userId,
    }).returning()

    return { id: row.id, templateKey: input.templateKey, version: row.version, label: row.label, createdAt: row.createdAt.toISOString() }
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
        })),
      }
    })
  )
  return results
}
