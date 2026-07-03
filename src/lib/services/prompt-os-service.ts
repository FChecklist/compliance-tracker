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
