// WO-DPDP-001 4.6 -- governance and publication: the Grievance Officer,
// the free public page (must work for an org with no domain/website --
// GST/CIN/document verification, never domain-only), notice versions, and
// the 72-hour breach flow.
import { and, eq, isNull } from "drizzle-orm"
import { dpdpGrievanceOfficer, dpdpPublicPage, dpdpNoticeVersion, dpdpBreach, dpdpOrganisation } from "@/lib/db"
import { withDpdpContext } from "@/lib/db/tenant-scoped"
import { logDpdpEvent } from "./dpdp-event-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type AppointGrievanceOfficerInput = {
  orgId: string; actorIdentityId: string; personName: string; email: string; phone?: string; address?: string
  appointmentMode: "board_resolution" | "office_order" | "outsourced"; resolutionRef?: string; resolutionText?: string; signatories?: string[]
}

/** Three ways to appoint (Grievance Officer screen); appointing a new one supersedes, never deletes, the previous. */
export async function appointGrievanceOfficer(input: AppointGrievanceOfficerInput) {
  if (!input.personName.trim() || !input.email.trim()) throw new ServiceError("A name and email are required", 400)
  return withDpdpContext({ orgId: input.orgId }, async (tx) => {
    const current = await tx.query.dpdpGrievanceOfficer.findFirst({ where: and(eq(dpdpGrievanceOfficer.orgId, input.orgId), isNull(dpdpGrievanceOfficer.supersededAt)) })
    if (current) await tx.update(dpdpGrievanceOfficer).set({ supersededAt: new Date() }).where(eq(dpdpGrievanceOfficer.id, current.id))

    const [officer] = await tx.insert(dpdpGrievanceOfficer).values({
      orgId: input.orgId, personName: input.personName, email: input.email, phone: input.phone, address: input.address,
      appointmentMode: input.appointmentMode, resolutionRef: input.resolutionRef, resolutionText: input.resolutionText, signatories: input.signatories,
    }).returning()

    await logDpdpEvent({ orgId: input.orgId, actorIdentityId: input.actorIdentityId, actorLabel: "Owner", kind: "grievance_officer_appointed", summary: `Appointed ${input.personName}` }, tx)
    return officer
  })
}

export async function getCurrentGrievanceOfficer(orgId: string) {
  return withDpdpContext({ orgId }, (tx) =>
    tx.query.dpdpGrievanceOfficer.findFirst({ where: and(eq(dpdpGrievanceOfficer.orgId, orgId), isNull(dpdpGrievanceOfficer.supersededAt)) })
  )
}

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "org"
}

export type PublishPublicPageInput = { orgId: string; actorIdentityId: string; verifiedVia: "domain" | "gst" | "cin" | "document" }

/** "This is free, forever." Works with no domain and no website -- verification is GST/CIN/a document, domain is only one of four paths. */
export async function publishPublicPage(input: PublishPublicPageInput) {
  return withDpdpContext({ orgId: input.orgId }, async (tx) => {
    const org = await tx.query.dpdpOrganisation.findFirst({ where: eq(dpdpOrganisation.id, input.orgId) })
    if (!org) throw new ServiceError("Not found", 404)
    const existing = await tx.query.dpdpPublicPage.findFirst({ where: eq(dpdpPublicPage.orgId, input.orgId) })
    const slug = existing?.slug ?? slugify(org.name)

    const [page] = existing
      ? await tx.update(dpdpPublicPage).set({ isLive: true, verifiedVia: input.verifiedVia, lastGeneratedAt: new Date() }).where(eq(dpdpPublicPage.orgId, input.orgId)).returning()
      : await tx.insert(dpdpPublicPage).values({ orgId: input.orgId, slug, isLive: true, verifiedVia: input.verifiedVia, lastGeneratedAt: new Date() }).returning()

    await logDpdpEvent({ orgId: input.orgId, actorIdentityId: input.actorIdentityId, actorLabel: "Owner", kind: "public_page_published", summary: `Published /g/${slug}` }, tx)
    return page
  })
}

export async function getPublicPageBySlug(slug: string) {
  const { db } = await import("@/lib/db")
  const page = await db.query.dpdpPublicPage.findFirst({ where: and(eq(dpdpPublicPage.slug, slug), eq(dpdpPublicPage.isLive, true)) })
  if (!page) return null
  const org = await db.query.dpdpOrganisation.findFirst({ where: eq(dpdpOrganisation.id, page.orgId) })
  const officer = await getCurrentGrievanceOfficer(page.orgId)
  return { page, org, officer }
}

export type PublishNoticeInput = {
  orgId: string; actorIdentityId: string; docKind: string; version: string; languages: string[]; effectiveFrom?: Date
}

/** Old versions are kept, never overwritten -- "the question is never what your notice says, it's what it said on the day this person agreed." */
export async function publishNoticeVersion(input: PublishNoticeInput) {
  return withDpdpContext({ orgId: input.orgId }, async (tx) => {
    const previous = await tx.query.dpdpNoticeVersion.findFirst({ where: and(eq(dpdpNoticeVersion.orgId, input.orgId), eq(dpdpNoticeVersion.docKind, input.docKind), eq(dpdpNoticeVersion.state, "live")) })
    const effectiveFrom = input.effectiveFrom ?? new Date()
    if (previous) await tx.update(dpdpNoticeVersion).set({ state: "superseded", effectiveTo: effectiveFrom }).where(eq(dpdpNoticeVersion.id, previous.id))

    const [notice] = await tx.insert(dpdpNoticeVersion).values({
      orgId: input.orgId, docKind: input.docKind, version: input.version, releasedOn: effectiveFrom.toISOString().slice(0, 10),
      effectiveFrom, languages: input.languages, approvedBy: input.actorIdentityId, state: "live",
    }).returning()

    await logDpdpEvent({ orgId: input.orgId, actorIdentityId: input.actorIdentityId, actorLabel: "Owner", kind: "notice_published", summary: `${input.docKind} v${input.version} published` }, tx)
    return notice
  })
}

export async function listNoticeVersions(orgId: string) {
  return withDpdpContext({ orgId }, (tx) => tx.query.dpdpNoticeVersion.findMany({ where: eq(dpdpNoticeVersion.orgId, orgId) }))
}

// ─── Breach (S.8(6), 72 hours) ─────────────────────────────────────────
const BREACH_DEADLINE_HOURS = 72

/** "The clock starts when you find out, not when you are sure." */
export async function reportBreach(orgId: string, actorIdentityId: string, scopePersonCount?: number) {
  return withDpdpContext({ orgId }, async (tx) => {
    const [breach] = await tx.insert(dpdpBreach).values({
      orgId, becameAwareAt: new Date(), deadlineAt: new Date(Date.now() + BREACH_DEADLINE_HOURS * 3600000), scopePersonCount,
    }).returning()
    await logDpdpEvent({ orgId, actorIdentityId, actorLabel: "Owner", kind: "breach_reported", summary: "🚨 Reported a leak — 72-hour clock started" }, tx)
    return breach
  })
}

export async function markBoardNotified(orgId: string, actorIdentityId: string, breachId: string) {
  return withDpdpContext({ orgId }, async (tx) => {
    const [updated] = await tx.update(dpdpBreach).set({ boardNotifiedAt: new Date() }).where(and(eq(dpdpBreach.id, breachId), eq(dpdpBreach.orgId, orgId))).returning()
    if (!updated) throw new ServiceError("Not found", 404)
    await logDpdpEvent({ orgId, actorIdentityId, actorLabel: "Owner", kind: "breach_board_notified", summary: "Board notified" }, tx)
    return updated
  })
}

export async function markIndividualsNotified(orgId: string, actorIdentityId: string, breachId: string) {
  return withDpdpContext({ orgId }, async (tx) => {
    const [updated] = await tx.update(dpdpBreach).set({ individualsNotifiedAt: new Date(), state: "notified" }).where(and(eq(dpdpBreach.id, breachId), eq(dpdpBreach.orgId, orgId))).returning()
    if (!updated) throw new ServiceError("Not found", 404)
    await logDpdpEvent({ orgId, actorIdentityId, actorLabel: "Owner", kind: "breach_individuals_notified", summary: "Affected people notified" }, tx)
    return updated
  })
}

export async function listBreaches(orgId: string) {
  return withDpdpContext({ orgId }, (tx) => tx.query.dpdpBreach.findMany({ where: eq(dpdpBreach.orgId, orgId) }))
}
