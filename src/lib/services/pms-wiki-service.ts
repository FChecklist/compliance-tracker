// Wave 28 (VERIDIAN AI PMS) service layer -- project wiki. Genuinely new,
// general-purpose pages kept deliberately separate from the existing
// `documents` table (compliance-coupled: complianceItemId/noticeId FKs,
// the wrong shape for this). Plain text/markdown content, no CRDT
// collaborative editor (explicit out-of-scope per PLATFORM_STRATEGY.md
// §14). Callers must have already passed requirePmsEnabled() (enforced
// at the route layer).
import { pmsWikiPages, projects } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"

export type PmsContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

function slugify(title: string): string {
  return title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "page"
}

export async function listWikiPages(ctx: { orgId: string }, projectId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)
    return db.query.pmsWikiPages.findMany({
      where: and(eq(pmsWikiPages.orgId, ctx.orgId), eq(pmsWikiPages.projectId, projectId), eq(pmsWikiPages.isArchived, false)),
      orderBy: (t, { asc }) => asc(t.title),
    })
  })
}

export async function getWikiPageBySlug(ctx: { orgId: string }, projectId: string, slug: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const page = await db.query.pmsWikiPages.findFirst({
      where: and(eq(pmsWikiPages.orgId, ctx.orgId), eq(pmsWikiPages.projectId, projectId), eq(pmsWikiPages.slug, slug)),
    })
    if (!page) throw new ServiceError("Wiki page not found", 404)
    return page
  })
}

// Same isRealUser gate as knowledge-base-service.ts's createKbPage(), for
// the same reason: pmsWikiPages.updatedById has a real FK to users.id, and
// PROJEXA's server-to-server calls authenticate via API key (ctx.userId is
// the key's own id, not a users row) -- the PROJEXA-facing route used to
// hard-block API-key callers entirely to avoid that FK 500, which meant
// PROJEXA could never create a project wiki page at all.
export async function createWikiPage(
  ctx: { orgId: string; userId: string; isRealUser?: boolean },
  projectId: string,
  input: { title: string; content?: string; parentPageId?: string }
) {
  const title = input.title?.trim()
  if (!title) throw new ServiceError("title is required", 400)

  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const project = await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, ctx.orgId)) })
    if (!project) throw new ServiceError("Project not found", 404)

    const baseSlug = slugify(title)
    let slug = baseSlug
    let attempt = 0
    while (await db.query.pmsWikiPages.findFirst({ where: and(eq(pmsWikiPages.projectId, projectId), eq(pmsWikiPages.slug, slug)) })) {
      attempt += 1
      slug = `${baseSlug}-${attempt}`
      if (attempt > 20) break
    }

    const [page] = await db.insert(pmsWikiPages).values({
      orgId: ctx.orgId, projectId, parentPageId: input.parentPageId || null,
      slug, title, content: input.content || null, updatedById: ctx.isRealUser ? ctx.userId : null,
    }).returning()
    return page
  })
}

export async function updateWikiPage(
  ctx: PmsContext,
  pageId: string,
  patch: Partial<{ title: string; content: string | null; isArchived: boolean }>
) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const existing = await db.query.pmsWikiPages.findFirst({ where: and(eq(pmsWikiPages.id, pageId), eq(pmsWikiPages.orgId, ctx.orgId)) })
    if (!existing) throw new ServiceError("Wiki page not found", 404)

    const [page] = await db.update(pmsWikiPages)
      .set({ ...patch, version: existing.version + 1, updatedById: ctx.userId, updatedAt: new Date() })
      .where(eq(pmsWikiPages.id, pageId)).returning()
    return page
  })
}
