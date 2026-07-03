// Wave 29 (AppFlowy-inspired knowledge base, PLATFORM_STRATEGY.md §15).
// Org-wide, core module -- no enablement toggle, unlike PMS wiki. Plain
// text/markdown content, no CRDT/blocks/database-grid-views (same v1 scope
// line already drawn for pms_wiki_pages).
import { knowledgeBasePages } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"

export type KbContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

function slugify(title: string): string {
  return title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "page"
}

export async function listKbPages(ctx: { orgId: string }) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    return db.query.knowledgeBasePages.findMany({
      where: and(eq(knowledgeBasePages.orgId, ctx.orgId), eq(knowledgeBasePages.isArchived, false)),
      orderBy: (t, { asc }) => asc(t.title),
    })
  })
}

export async function getKbPageBySlug(ctx: { orgId: string }, slug: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const page = await db.query.knowledgeBasePages.findFirst({
      where: and(eq(knowledgeBasePages.orgId, ctx.orgId), eq(knowledgeBasePages.slug, slug)),
    })
    if (!page) throw new ServiceError("Knowledge base page not found", 404)
    return page
  })
}

export async function createKbPage(
  ctx: KbContext,
  input: { title: string; content?: string; parentPageId?: string }
) {
  const title = input.title?.trim()
  if (!title) throw new ServiceError("title is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const baseSlug = slugify(title)
    let slug = baseSlug
    let attempt = 0
    while (await db.query.knowledgeBasePages.findFirst({ where: and(eq(knowledgeBasePages.orgId, ctx.orgId), eq(knowledgeBasePages.slug, slug)) })) {
      attempt += 1
      slug = `${baseSlug}-${attempt}`
      if (attempt > 20) break
    }

    const [page] = await db.insert(knowledgeBasePages).values({
      orgId: ctx.orgId, parentPageId: input.parentPageId || null,
      slug, title, content: input.content || null, updatedById: ctx.userId,
    }).returning()
    return page
  })
}

export async function updateKbPage(
  ctx: KbContext,
  pageId: string,
  patch: Partial<{ title: string; content: string | null; isArchived: boolean }>
) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.knowledgeBasePages.findFirst({ where: and(eq(knowledgeBasePages.id, pageId), eq(knowledgeBasePages.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Knowledge base page not found", 404)

    const [page] = await db.update(knowledgeBasePages)
      .set({ ...patch, version: existing.version + 1, updatedById: ctx.userId, updatedAt: new Date() })
      .where(eq(knowledgeBasePages.id, pageId)).returning()
    return page
  })
}
