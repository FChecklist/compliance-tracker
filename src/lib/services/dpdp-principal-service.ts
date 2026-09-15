// WO-DPDP-001 4.5 -- Data Principals: a separate plane, never accounts.
// Hard rules enforced here, not just documented: (1) a principal never
// gets a dpdp.identity/dpdp.membership row -- everything below reaches
// them only through consent_token, an opaque link; (2) their contact
// details are hashed (sha256), never stored in plaintext in this schema --
// the plaintext email/phone used to SEND the link exists only for the
// duration of the send call, in memory, never written to a dpdp table.
import { createHash, randomBytes } from "node:crypto"
import { and, eq, count } from "drizzle-orm"
import { db, dpdpConsentCampaign, dpdpConsentToken, dpdpConsentRecord, dpdpRightsRequest, dpdpGrievance, dpdpPrincipalGroup, dpdpNoticeVersion } from "@/lib/db"
import { withDpdpContext } from "@/lib/db/tenant-scoped"
import { logDpdpEvent } from "./dpdp-event-service"
import { sendEmail, emailTemplate } from "@/lib/email"
import { ServiceError } from "./compliance-service"
export { ServiceError }

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://veridian-compliance-ai.vercel.app"
const CONSENT_TOKEN_TTL_DAYS = 3650 // "This link is yours. Keep the email." -- effectively permanent, matching the artefact's own "everything above stays available on it, forever, without an account"

function hashContact(raw: string): string {
  return createHash("sha256").update(raw.trim().toLowerCase()).digest("hex")
}
function newOpaqueToken(): string {
  return randomBytes(24).toString("base64url")
}

export type SendConsentCampaignInput = {
  orgId: string; actorIdentityId: string; groupId: string; noticeVersionId: string; contacts: string[] // plaintext emails, used only to send, never persisted
}

export async function sendConsentCampaign(input: SendConsentCampaignInput) {
  return withDpdpContext({ orgId: input.orgId }, async (tx) => {
    const group = await tx.query.dpdpPrincipalGroup.findFirst({ where: and(eq(dpdpPrincipalGroup.id, input.groupId), eq(dpdpPrincipalGroup.orgId, input.orgId)) })
    if (!group) throw new ServiceError("Group not found", 404)
    const notice = await tx.query.dpdpNoticeVersion.findFirst({ where: and(eq(dpdpNoticeVersion.id, input.noticeVersionId), eq(dpdpNoticeVersion.orgId, input.orgId)) })
    if (!notice) throw new ServiceError("Notice not found", 404)

    const [campaign] = await tx.insert(dpdpConsentCampaign).values({ orgId: input.orgId, groupId: input.groupId, noticeVersionId: input.noticeVersionId, sentAt: new Date() }).returning()

    const tokens: string[] = []
    for (const email of input.contacts) {
      const raw = newOpaqueToken()
      await tx.insert(dpdpConsentToken).values({
        campaignId: campaign.id, token: raw, contactHash: hashContact(email), expiresAt: new Date(Date.now() + CONSENT_TOKEN_TTL_DAYS * 86400000),
      })
      tokens.push(raw)
      await sendEmail({
        to: email,
        subject: "A quick question about your information",
        html: emailTemplate(
          "Please tell us what you are happy for us to do with it",
          "It takes about a minute. No password needed — this link signs you in, just for this.",
          `${APP_URL}/dpdp/p/${raw}`,
          "Open it →"
        ),
      })
    }

    await logDpdpEvent({ orgId: input.orgId, actorIdentityId: input.actorIdentityId, actorLabel: "Owner", kind: "consent_campaign_sent", summary: `Sent to ${group.label} (${tokens.length})` }, tx)
    return { campaign, sent: tokens.length }
  })
}

export type ConsentTokenContext = {
  token: typeof dpdpConsentToken.$inferSelect
  campaign: typeof dpdpConsentCampaign.$inferSelect
  notice: typeof dpdpNoticeVersion.$inferSelect | null
  orgId: string
}

/** Public lookup -- no org context, no login, by design. */
export async function resolveConsentToken(rawToken: string): Promise<ConsentTokenContext | null> {
  const token = await db.query.dpdpConsentToken.findFirst({ where: eq(dpdpConsentToken.token, rawToken) })
  if (!token || token.expiresAt < new Date()) return null
  const campaign = await db.query.dpdpConsentCampaign.findFirst({ where: eq(dpdpConsentCampaign.id, token.campaignId) })
  if (!campaign) return null
  const notice = await db.query.dpdpNoticeVersion.findFirst({ where: eq(dpdpNoticeVersion.id, campaign.noticeVersionId) })
  if (!token.openedAt) await db.update(dpdpConsentToken).set({ openedAt: new Date() }).where(eq(dpdpConsentToken.id, token.id))
  return { token, campaign, notice: notice ?? null, orgId: campaign.orgId }
}

/**
 * "Tick only what you agree to" -- one row per purpose per act, never an
 * UPDATE of a prior grant. Withdrawal (`granted:false`) is the same shape:
 * "taking permission away is as easy as giving it" (S.6) is satisfied by
 * this being the exact same endpoint/table, not a separate flow.
 */
export async function recordConsent(rawToken: string, purposes: Array<{ purposeKey: string; granted: boolean }>, language: string) {
  const ctx = await resolveConsentToken(rawToken)
  if (!ctx) throw new ServiceError("This link is not valid or has expired", 400)

  return withDpdpContext({ orgId: ctx.orgId }, async (tx) => {
    const rows = await Promise.all(purposes.map((p) =>
      tx.insert(dpdpConsentRecord).values({
        tokenId: ctx.token.id, purposeKey: p.purposeKey, granted: p.granted, noticeVersionId: ctx.campaign.noticeVersionId, language,
        withdrawnAt: p.granted ? null : new Date(),
      }).returning()
    ))
    await tx.update(dpdpConsentToken).set({ actedAt: new Date() }).where(eq(dpdpConsentToken.id, ctx.token.id))
    await logDpdpEvent({ orgId: ctx.orgId, actorLabel: "A person on a link", kind: "consent_recorded", summary: `Recorded ${purposes.length} answer(s)` }, tx)
    return rows.flat()
  })
}

// ─── Rights requests (S.11) ───────────────────────────────────────────
const RIGHTS_DUE_DAYS = 90

async function nextRightsRequestRef(orgId: string): Promise<string> {
  const [row] = await db.select({ n: count() }).from(dpdpRightsRequest).where(eq(dpdpRightsRequest.orgId, orgId))
  return `R-${String((row?.n ?? 0) + 1).padStart(4, "0")}`
}

async function nextGrievanceRef(orgId: string): Promise<string> {
  const [row] = await db.select({ n: count() }).from(dpdpGrievance).where(eq(dpdpGrievance.orgId, orgId))
  return `G-${String((row?.n ?? 0) + 1).padStart(4, "0")}`
}

export type RaiseRightsRequestInput = { orgId: string; kind: string; arrivedVia: string; whatByToken?: string }

/** Called from a consent-token page ("Ask them to delete my data" etc) or the org's public page -- either way, no login. */
export async function raiseRightsRequest(input: RaiseRightsRequestInput) {
  return withDpdpContext({ orgId: input.orgId }, async (tx) => {
    const ref = await nextRightsRequestRef(input.orgId)
    const [request] = await tx.insert(dpdpRightsRequest).values({
      orgId: input.orgId, ref, kind: input.kind, arrivedVia: input.arrivedVia, dueAt: new Date(Date.now() + RIGHTS_DUE_DAYS * 86400000),
    }).returning()
    await logDpdpEvent({ orgId: input.orgId, actorLabel: "A person on a link", kind: "rights_request_received", summary: `${ref}: ${input.kind}` }, tx)
    return request
  })
}

export async function listRightsRequests(orgId: string) {
  return withDpdpContext({ orgId }, (tx) => tx.query.dpdpRightsRequest.findMany({ where: eq(dpdpRightsRequest.orgId, orgId) }))
}

export async function answerRightsRequest(orgId: string, actorIdentityId: string, requestId: string, answerText: string) {
  if (!answerText.trim()) throw new ServiceError("An answer is required", 400)
  return withDpdpContext({ orgId }, async (tx) => {
    const request = await tx.query.dpdpRightsRequest.findFirst({ where: and(eq(dpdpRightsRequest.id, requestId), eq(dpdpRightsRequest.orgId, orgId)) })
    if (!request) throw new ServiceError("Not found", 404)
    const [updated] = await tx.update(dpdpRightsRequest).set({ state: "done", answeredAt: new Date(), answerText }).where(eq(dpdpRightsRequest.id, requestId)).returning()
    await logDpdpEvent({ orgId, actorIdentityId, actorLabel: "Owner", kind: "rights_request_answered", summary: `Answered ${request.ref}` }, tx)
    return updated
  })
}

// ─── Grievances (S.13, the ladder) ─────────────────────────────────────
const OFFICER_DUE_DAYS = 30
const REVIEWER_DUE_DAYS = 30

export async function raiseGrievance(orgId: string, summary: string) {
  if (!summary.trim()) throw new ServiceError("A summary is required", 400)
  return withDpdpContext({ orgId }, async (tx) => {
    const ref = await nextGrievanceRef(orgId)
    const [grievance] = await tx.insert(dpdpGrievance).values({
      orgId, ref, summary, tier: 1, officerDueAt: new Date(Date.now() + OFFICER_DUE_DAYS * 86400000),
    }).returning()
    await logDpdpEvent({ orgId, actorLabel: "A person on a link", kind: "grievance_raised", summary: `${ref} raised` }, tx)
    return grievance
  })
}

export async function listGrievances(orgId: string) {
  return withDpdpContext({ orgId }, (tx) => tx.query.dpdpGrievance.findMany({ where: eq(dpdpGrievance.orgId, orgId) }))
}

/** Officer decision -- write-once at this layer (a second call is refused, not overwritten). DB-level enforcement is a documented follow-up (schema.ts's own comment on dpdpGrievance), not yet applied here. */
export async function recordOfficerDecision(orgId: string, actorIdentityId: string, grievanceId: string, decision: string) {
  return withDpdpContext({ orgId }, async (tx) => {
    const grievance = await tx.query.dpdpGrievance.findFirst({ where: and(eq(dpdpGrievance.id, grievanceId), eq(dpdpGrievance.orgId, orgId)) })
    if (!grievance) throw new ServiceError("Not found", 404)
    if (grievance.officerDecision) throw new ServiceError("A decision has already been recorded and cannot be changed", 409)
    const [updated] = await tx.update(dpdpGrievance).set({ officerDecision: decision }).where(eq(dpdpGrievance.id, grievanceId)).returning()
    await logDpdpEvent({ orgId, actorIdentityId, actorLabel: "Grievance Officer", kind: "grievance_determined", summary: `${grievance.ref}: officer decided` }, tx)
    return updated
  })
}

export async function escalateGrievance(orgId: string, actorIdentityId: string, grievanceId: string) {
  return withDpdpContext({ orgId }, async (tx) => {
    const grievance = await tx.query.dpdpGrievance.findFirst({ where: and(eq(dpdpGrievance.id, grievanceId), eq(dpdpGrievance.orgId, orgId)) })
    if (!grievance) throw new ServiceError("Not found", 404)
    if (grievance.tier >= 2) throw new ServiceError("Already escalated", 409)
    const [updated] = await tx.update(dpdpGrievance).set({ tier: 2, reviewerDueAt: new Date(Date.now() + REVIEWER_DUE_DAYS * 86400000) }).where(eq(dpdpGrievance.id, grievanceId)).returning()
    await logDpdpEvent({ orgId, actorIdentityId, actorLabel: "Owner", kind: "grievance_escalated", summary: `${grievance.ref} sent to the independent reviewer` }, tx)
    return updated
  })
}

/** Immutable once written, by anyone, including its author (work order 4.5) -- enforced here the same write-once way as recordOfficerDecision. */
export async function recordReviewerDetermination(orgId: string, reviewerIdentityId: string, grievanceId: string, determination: string) {
  return withDpdpContext({ orgId }, async (tx) => {
    const grievance = await tx.query.dpdpGrievance.findFirst({ where: and(eq(dpdpGrievance.id, grievanceId), eq(dpdpGrievance.orgId, orgId)) })
    if (!grievance) throw new ServiceError("Not found", 404)
    if (grievance.reviewerDetermination) throw new ServiceError("A determination has already been recorded and cannot be changed", 409)
    if (grievance.tier < 2) throw new ServiceError("Not yet escalated to the independent reviewer", 409)
    const [updated] = await tx.update(dpdpGrievance).set({ reviewerDetermination: determination, reviewerIdentityId }).where(eq(dpdpGrievance.id, grievanceId)).returning()
    await logDpdpEvent({ orgId, actorIdentityId: reviewerIdentityId, actorLabel: "Independent reviewer", kind: "grievance_determined", summary: `${grievance.ref}: reviewer determined` }, tx)
    return updated
  })
}
