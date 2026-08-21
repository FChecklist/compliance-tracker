// Point 118 (WhatsApp share): tokenised, expiring, read-only report links --
// mirrors veri-meeting-service.ts's share-link trio (createMeetingShareLink/
// revokeMeetingShareLink/getMeetingByShareToken) exactly in shape. Rajat
// ruled: NOT the WhatsApp Business API -- a plain unguessable URL the user
// pastes into WhatsApp themselves. AR-10 applies: the public resolve path
// must render, never authorise -- see resolveReportShareLink()'s comment.
import { reportShareLinks, db } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { ServiceError } from "./compliance-service"
import { listBoqs, getBoq } from "./construction-boq-service"
import { listActivities, listCategories, listProgressEntries } from "./construction-progress-service"
export { ServiceError }

export type ReportRef = { projectId: string; from: string; to: string }

export async function createReportShareLink(
  ctx: { orgId: string; userId: string },
  input: { reportType: "work_progress"; reportRef: ReportRef; expiresInHours?: number }
) {
  if (input.reportType !== "work_progress") throw new ServiceError("Unsupported report type", 400)
  if (!input.reportRef?.projectId || !input.reportRef?.from || !input.reportRef?.to) {
    throw new ServiceError("reportRef.projectId, from and to are required", 400)
  }
  const expiresInHours = input.expiresInHours ?? 168 // 7 days, matching veri_meeting_share_links' default
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (tx) => {
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000)
    const [link] = await tx.insert(reportShareLinks).values({
      orgId: ctx.orgId, reportType: input.reportType, reportRef: JSON.stringify(input.reportRef),
      token: createId(), createdById: ctx.userId, expiresAt,
    }).returning()
    return link
  })
}

export async function listReportShareLinks(ctx: { orgId: string }, reportType: string, reportRef: ReportRef) {
  return withTenantContext({ orgId: ctx.orgId }, (tx) =>
    tx.query.reportShareLinks.findMany({
      where: and(eq(reportShareLinks.orgId, ctx.orgId), eq(reportShareLinks.reportType, reportType), eq(reportShareLinks.reportRef, JSON.stringify(reportRef))),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
  )
}

export async function revokeReportShareLink(ctx: { orgId: string }, linkId: string) {
  return withTenantContext({ orgId: ctx.orgId }, async (tx) => {
    const link = await tx.query.reportShareLinks.findFirst({ where: and(eq(reportShareLinks.id, linkId), eq(reportShareLinks.orgId, ctx.orgId)) })
    if (!link) throw new ServiceError("Share link not found", 404)
    const [updated] = await tx.update(reportShareLinks).set({ revokedAt: new Date() }).where(eq(reportShareLinks.id, linkId)).returning()
    return updated
  })
}

// Public route (no auth) -- resolves a token to the underlying report's raw
// ingredients, READ ONLY. Expired/revoked/unknown tokens all fail identically
// (do not distinguish "expired" from "never existed" -- same posture as
// getMeetingByShareToken). Uses the raw `db` export (DATABASE_URL, no RLS)
// ONLY to look up the token row itself -- there is no org context yet at
// that point, by definition, for a public visitor. Every subsequent read
// (the actual report data) goes through the EXISTING, already-orgId-scoped
// service functions (listBoqs/getBoq/listActivities/listCategories/
// listProgressEntries), called with the link's OWN stored orgId -- NEVER
// derived from the request -- so RLS (app_runtime, current_org_id()) still
// applies to every byte of report content a visitor actually sees. A public
// visitor can therefore only ever reach the one org + one report the token
// was minted for, nothing else in the multi-tenant database.
export async function resolveReportShareLink(token: string) {
  const link = await db.query.reportShareLinks.findFirst({ where: eq(reportShareLinks.token, token) })
  if (!link || link.revokedAt || link.expiresAt < new Date()) {
    throw new ServiceError("This share link is invalid or has expired", 404)
  }

  if (link.reportType !== "work_progress") throw new ServiceError("This share link is invalid or has expired", 404)
  const ref: ReportRef = JSON.parse(link.reportRef)

  const boqs = await listBoqs({ orgId: link.orgId }, ref.projectId)
  const boqsWithLineItems = await Promise.all(boqs.map((boq) => getBoq({ orgId: link.orgId }, boq.id)))
  const latestBoq = boqsWithLineItems.find((b) => b.status !== "superseded") ?? boqsWithLineItems[0]

  const [activities, categories, entries] = await Promise.all([
    listActivities({ orgId: link.orgId }, { projectId: ref.projectId }),
    listCategories({ orgId: link.orgId }, ref.projectId),
    listProgressEntries({ orgId: link.orgId }, { projectId: ref.projectId }),
  ])

  return {
    reportType: link.reportType,
    projectId: ref.projectId, from: ref.from, to: ref.to,
    boqTitle: latestBoq?.title ?? null,
    lineItems: latestBoq?.lineItems ?? [],
    activities, categories, entries,
  }
}
