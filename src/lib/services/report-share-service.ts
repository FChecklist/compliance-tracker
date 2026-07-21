// src/lib/services/report-share-service.ts
//
// audit198 RULE-053 gap closure (wave 6, SHARING_SECURITY category):
// "Users shall be able to securely share reports, dashboards, and business
// analysis through controlled shareable links without exposing
// unauthorized information."
//
// Mirrors createMeetingShareLink/listMeetingShareLinks/
// revokeMeetingShareLink/getMeetingByShareToken in veri-meeting-service.ts
// exactly in shape (see that file's own "mirrors conversationShareLinks
// (Wave 36) exactly" comment -- this is the third instance of the same
// pattern, not a new design). The one real difference, and the reason this
// is its own service rather than a copy-paste with s/meeting/report/: the
// snapshot-at-creation-time security model documented on reportShareLinks
// in schema.ts. Read that table comment before changing this file.
import { reportDefinitions, reportShareLinks, db } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { logActivity } from "@/lib/audit"
import { executeReportDefinition } from "@/lib/services/report-engine-service"
import { evaluateShareLinkStatus } from "@/lib/services/share-link-kernel"
import { ServiceError } from "@/lib/services/compliance-service"
export { ServiceError }
import type { users } from "@/lib/db"

export type ReportShareContext = { orgId: string; userId: string; dbUser: typeof users.$inferSelect }

const DEFAULT_EXPIRY_HOURS = 168 // 7 days, matches createMeetingShareLink's default

/**
 * Runs the report definition through the SAME tenant-scoped execution
 * engine the authenticated /run route uses (report-engine-service.ts's
 * executeReportDefinition), then freezes that result into the share link
 * row. This call happens while `ctx` is still a real authenticated,
 * org-scoped session -- the only place in this flow a report is ever
 * actually executed. Nothing downstream (getReportByShareToken) re-runs
 * it.
 */
export async function createReportShareLink(
  ctx: ReportShareContext,
  reportDefinitionId: string,
  expiresInHours = DEFAULT_EXPIRY_HOURS
) {
  // Deliberately three SEQUENTIAL withTenantContext calls, not one nested
  // block -- withTenantContext opens a real db.transaction() against a
  // max:1-connection pool (src/lib/db/tenant-scoped.ts, src/lib/db/
  // index.ts). Nesting a second withTenantContext (either directly, or
  // transitively via executeReportDefinition below, which opens its own)
  // inside an outer one would try to acquire a second connection from a
  // pool that only has one, while the outer transaction still holds it --
  // a real deadlock risk, not just a style preference.
  const definition = await withTenantContext({ orgId: ctx.orgId }, (txDb) =>
    txDb.query.reportDefinitions.findFirst({
      where: and(eq(reportDefinitions.id, reportDefinitionId), eq(reportDefinitions.status, "built")),
    })
  )
  if (!definition) throw new ServiceError("Report not found or not available to share", 404)
  // orgId null = platform-wide catalog report -- sharable by any org that
  // can see it. A non-null orgId must match the sharer's own org; this is
  // the tenant-isolation check that keeps one org from sharing (and
  // thereby leaking snapshot access to) another org's private report --
  // the literal "without exposing unauthorized information" clause.
  if (definition.orgId && definition.orgId !== ctx.orgId) {
    throw new ServiceError("Report not found or not available to share", 404)
  }

  const result = await executeReportDefinition({ orgId: ctx.orgId, userId: ctx.userId }, reportDefinitionId, {})

  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (txDb) => {
    const [link] = await txDb.insert(reportShareLinks).values({
      reportDefinitionId,
      orgId: ctx.orgId,
      token: createId(),
      createdById: ctx.userId,
      snapshotName: definition.name,
      snapshotDescription: definition.description,
      snapshotResult: result,
      snapshotGeneratedAt: new Date(),
      expiresAt,
    }).returning()

    await logActivity({
      tx: txDb, action: "report.share_link_created", entityType: "report_definition", entityId: reportDefinitionId,
      details: `Share link created for "${definition.name}"`, orgId: ctx.orgId, dbUser: ctx.dbUser,
    })
    return link
  })
}

export async function listReportShareLinks(ctx: { orgId: string }, reportDefinitionId: string) {
  return withTenantContext({ orgId: ctx.orgId }, (txDb) =>
    txDb.query.reportShareLinks.findMany({
      where: and(eq(reportShareLinks.reportDefinitionId, reportDefinitionId), eq(reportShareLinks.orgId, ctx.orgId)),
      orderBy: (t, { desc }) => desc(t.createdAt),
      columns: {
        // Deliberately excludes snapshotResult -- the management/list view
        // (an authenticated admin listing their own org's links) doesn't
        // need the full payload repeated per row, only link metadata.
        id: true, reportDefinitionId: true, token: true, createdById: true,
        snapshotName: true, snapshotGeneratedAt: true, expiresAt: true,
        revokedAt: true, viewCount: true, createdAt: true,
      },
    })
  )
}

export async function revokeReportShareLink(ctx: ReportShareContext, linkId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (txDb) => {
    const link = await txDb.query.reportShareLinks.findFirst({
      where: and(eq(reportShareLinks.id, linkId), eq(reportShareLinks.orgId, ctx.orgId)),
    })
    if (!link) throw new ServiceError("Share link not found", 404)

    const [updated] = await txDb.update(reportShareLinks).set({ revokedAt: new Date() }).where(eq(reportShareLinks.id, linkId)).returning()
    await logActivity({
      tx: txDb, action: "report.share_link_revoked", entityType: "report_definition", entityId: link.reportDefinitionId,
      details: "Share link revoked", orgId: ctx.orgId, dbUser: ctx.dbUser,
    })
    return updated
  })
}

export type SharedReportView = {
  name: string
  description: string | null
  generatedAt: string
  result: unknown
}

/**
 * Public route (no auth) -- resolves a token to the FROZEN snapshot only.
 * Uses the raw `db` export since there's no session/org context for a
 * public link to run withTenantContext against (same rationale
 * getMeetingByShareToken/previewInviteLink already document for their own
 * public-route equivalents). Never touches reportDefinitions or
 * report-engine-service.ts -- this function cannot execute a query against
 * live org data no matter what token is presented, by construction.
 */
export async function getReportByShareToken(token: string): Promise<SharedReportView> {
  const link = await db.query.reportShareLinks.findFirst({ where: eq(reportShareLinks.token, token) })
  if (!link || !evaluateStatusIsValid(link)) throw new ServiceError("This share link is invalid or has expired", 404)

  await db.update(reportShareLinks).set({ viewCount: link.viewCount + 1 }).where(eq(reportShareLinks.id, link.id))

  return {
    name: link.snapshotName,
    description: link.snapshotDescription,
    generatedAt: link.snapshotGeneratedAt.toISOString(),
    result: link.snapshotResult,
  }
}

function evaluateStatusIsValid(link: { expiresAt: Date; revokedAt: Date | null }): boolean {
  return evaluateShareLinkStatus(link, new Date()) === "valid"
}
