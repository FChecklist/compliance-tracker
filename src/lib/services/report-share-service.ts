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
import { getProjectDashboard } from "./construction-dashboard-service"
import { boqBudgetVarianceReport } from "./construction-reports-service"
export { ServiceError }

export type ReportRef = { projectId: string; from: string; to: string }

/**
 * R67 E-12 (R-136). The report types a public, expiring link can be minted for.
 *
 * This list is the WHOLE contract: a token may only be minted for a type that
 * resolveReportShareLink() below can really render, because a link that 404s
 * for whoever received it is worse than no link at all. Item E-09 deliberately
 * left Share on the Reports screen copying its in-app URL for exactly that
 * reason -- project_status had no public renderer. It has one now
 * (projexa src/app/share/report/[token]/page.tsx), so the type is added here
 * and in the same change, never before it.
 */
export const SHAREABLE_REPORT_TYPES = ["work_progress", "project_status"] as const
export type ShareableReportType = (typeof SHAREABLE_REPORT_TYPES)[number]

/**
 * Pure. Refuses anything this service cannot actually resolve, and names what
 * it CAN do rather than saying only "unsupported" -- a caller that guessed a
 * type is told the real vocabulary.
 */
export function assertShareableReportType(value: unknown): ShareableReportType {
  if (typeof value === "string" && (SHAREABLE_REPORT_TYPES as readonly string[]).includes(value)) {
    return value as ShareableReportType
  }
  throw new ServiceError(`Unsupported report type. Shareable reports: ${SHAREABLE_REPORT_TYPES.join(", ")}`, 400)
}

/** Pure. The reference every shareable report needs, checked before a row is written. */
export function assertReportRef(ref: unknown): ReportRef {
  const r = ref as ReportRef | undefined
  if (!r?.projectId || !r?.from || !r?.to) {
    throw new ServiceError("reportRef.projectId, from and to are required", 400)
  }
  return { projectId: r.projectId, from: r.from, to: r.to }
}

export async function createReportShareLink(
  // R38: userId is null for an API-key-authenticated (server-to-server)
  // caller -- there is no real `users` row to attribute the link to. See
  // schema.ts's createdById comment for the FK-violation bug this fixes.
  ctx: { orgId: string; userId: string | null },
  input: { reportType: ShareableReportType; reportRef: ReportRef; expiresInHours?: number }
) {
  assertShareableReportType(input.reportType)
  assertReportRef(input.reportRef)
  const expiresInHours = input.expiresInHours ?? 168 // 7 days, matching veri_meeting_share_links' default
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId ?? undefined }, async (tx) => {
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

  if (!(SHAREABLE_REPORT_TYPES as readonly string[]).includes(link.reportType)) {
    throw new ServiceError("This share link is invalid or has expired", 404)
  }
  const ref: ReportRef = JSON.parse(link.reportRef)

  // R67 E-12 (R-136): the Project Status document, publicly. The SAME two
  // reads the authenticated screen uses -- the dashboard figures and the BOQ
  // budget line by line -- so a shared link and the screen it was shared from
  // state the same facts. Both are called with the link's OWN stored orgId,
  // never one derived from the request, so RLS still bounds every byte.
  if (link.reportType === "project_status") {
    const [dashboard, variance] = await Promise.all([
      getProjectDashboard({ orgId: link.orgId }, ref.projectId),
      boqBudgetVarianceReport({ orgId: link.orgId }, ref.projectId, {}),
    ])
    return {
      reportType: link.reportType,
      projectId: ref.projectId, from: ref.from, to: ref.to,
      boqTitle: variance.boqTitle,
      dashboard,
      lines: variance.lines.filter((l) => l.isRootLine),
      totals: { budget: variance.totalBudget, vendorAmount: variance.totalVendorAmount },
    }
  }

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
