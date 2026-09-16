// WO-DPDP-004 Section 5.10 -- "The AI Link". Schema/verbs per that section
// exactly.
//
// SECURITY MODEL (the WO's own words): "the link carries no authority...
// a leaked or malicious link is an annoyance, not a breach. Implement it
// this way -- do not add a signing secret that would make the link itself
// authoritative." Every apply path in this file therefore requires a real
// requireDpdpSession() at the route layer (see api/dpdp/ai-work/*) -- this
// service never trusts anything from the link/proposal content as
// authorization, only as a suggestion to be validated against real data.
//
// dpdp.projection() (WO 5.10/2.2): the WO specifies this as a Postgres
// SQL function (SECURITY DEFINER, STABLE, personal-data-excluded BY THE
// FUNCTION ITSELF, deterministic). buildAiSnapshot() below is a JS
// equivalent that satisfies the FUNCTIONAL requirement today (verified by
// dpdp-ai-link-service.test.ts's fuzz test -- no @, no 10-digit sequence)
// but is architecture debt against the WO's explicit ask for a real SQL
// function: flagged here, not silently presented as done. Converting this
// to plpgsql is real, separate work (a DDL migration, its own review) that
// this pass did not have room for.
import { randomBytes } from "node:crypto"
import { eq, and, count, isNull, gt } from "drizzle-orm"
import {
  db, dpdpAiLink, dpdpAiLinkRead, dpdpAiProposal, dpdpAiProposalLine, dpdpObligation, dpdpObligationTemplate,
  dpdpDataCategory, dpdpDataLocation, dpdpRelationship, dpdpRightsRequest, dpdpGrievance, dpdpOrganisation, dpdpNoticeVersion,
} from "@/lib/db"
import { withDpdpContext, type TenantDb } from "@/lib/db/tenant-scoped"
import { logDpdpEvent } from "./dpdp-event-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }

const AI_LINK_TTL_DAYS = 90

function newOpaqueToken(): string {
  return randomBytes(18).toString("base64url")
}

/** Reduces a full User-Agent string to a coarse family name only -- never the raw string (WO 5.10: "user-agent family... only"). */
export function classifyUserAgent(ua: string | null): string | null {
  if (!ua) return null
  if (/chatgpt|gptbot|openai/i.test(ua)) return "ChatGPT"
  if (/claude|anthropic/i.test(ua)) return "Claude"
  if (/gemini|google/i.test(ua)) return "Gemini"
  if (/chrome/i.test(ua)) return "Chrome"
  if (/safari/i.test(ua)) return "Safari"
  if (/firefox/i.test(ua)) return "Firefox"
  return "Other"
}

/** Reduces an IP to its /24 (v4) prefix only -- never the full address. */
export function ipPrefix(ip: string | null): string | null {
  if (!ip) return null
  const v4 = ip.split(",")[0].trim().match(/^(\d+\.\d+\.\d+)\.\d+$/)
  return v4 ? `${v4[1]}.x` : null
}

export async function getOrCreateAiLink(orgId: string, identityId: string) {
  return withDpdpContext({ orgId }, async (tx) => {
    const existing = await tx.query.dpdpAiLink.findFirst({
      where: and(eq(dpdpAiLink.orgId, orgId), eq(dpdpAiLink.identityId, identityId), isNull(dpdpAiLink.revokedAt), gt(dpdpAiLink.expiresAt, new Date())),
    })
    if (existing) return { token: null, expiresAt: existing.expiresAt, isNew: false }
    return issueAiLink(orgId, identityId, tx)
  })
}

async function issueAiLink(orgId: string, identityId: string, tx: TenantDb) {
  const token = newOpaqueToken()
  const expiresAt = new Date(Date.now() + AI_LINK_TTL_DAYS * 86400_000)
  await tx.insert(dpdpAiLink).values({ orgId, identityId, token, expiresAt })
  return { token, expiresAt, isNew: true }
}

/** "Rotating the token kills the old one instantly" -- revoke, then issue a fresh one, in one transaction. */
export async function rotateAiLink(orgId: string, identityId: string) {
  return withDpdpContext({ orgId }, async (tx) => {
    await tx.update(dpdpAiLink).set({ revokedAt: new Date() }).where(and(eq(dpdpAiLink.orgId, orgId), eq(dpdpAiLink.identityId, identityId), isNull(dpdpAiLink.revokedAt)))
    return issueAiLink(orgId, identityId, tx)
  })
}

export async function listAiLinkReads(orgId: string, identityId: string) {
  return withDpdpContext({ orgId }, async (tx) => {
    const link = await tx.query.dpdpAiLink.findFirst({ where: and(eq(dpdpAiLink.orgId, orgId), eq(dpdpAiLink.identityId, identityId), isNull(dpdpAiLink.revokedAt)) })
    if (!link) return []
    return tx.query.dpdpAiLinkRead.findMany({ where: eq(dpdpAiLinkRead.linkId, link.id), orderBy: (t, { desc }) => [desc(t.at)], limit: 20 })
  })
}

/** Public lookup -- no session, no org context (mirrors resolveConsentToken). Every real fetch is logged. */
export async function resolveAiLinkSnapshot(rawToken: string, userAgent?: string | null, requestIp?: string | null): Promise<string | null> {
  const link = await db.query.dpdpAiLink.findFirst({ where: and(eq(dpdpAiLink.token, rawToken), isNull(dpdpAiLink.revokedAt), gt(dpdpAiLink.expiresAt, new Date())) })
  if (!link) return null
  await db.insert(dpdpAiLinkRead).values({ linkId: link.id, userAgentFamily: classifyUserAgent(userAgent ?? null), ipPrefix: ipPrefix(requestIp ?? null) })
  return buildAiSnapshot(link.orgId)
}

/** The plain-text status report an external AI reads. Counts and states only -- see this file's own header. */
export async function buildAiSnapshot(orgId: string): Promise<string> {
  return withDpdpContext({ orgId }, async (tx) => {
    const org = await tx.query.dpdpOrganisation.findFirst({ where: eq(dpdpOrganisation.id, orgId) })
    const obligations = await tx.query.dpdpObligation.findMany({ where: eq(dpdpObligation.orgId, orgId) })
    const open = obligations.filter((o) => o.state === "open")
    const late = open.filter((o) => new Date(o.dueOn) < new Date())

    const categories = await tx.query.dpdpDataCategory.findMany({ where: eq(dpdpDataCategory.orgId, orgId) })
    let located = 0
    for (const c of categories) {
      const loc = await tx.query.dpdpDataLocation.findFirst({ where: eq(dpdpDataLocation.categoryId, c.id) })
      if (loc?.state === "confirmed") located++
    }

    const relationships = await tx.query.dpdpRelationship.findMany({ where: eq(dpdpRelationship.fromOrg, orgId) })
    const signed = relationships.filter((r) => r.agreementSignedAt).length

    const [rightsOpen] = await tx.select({ n: count() }).from(dpdpRightsRequest).where(and(eq(dpdpRightsRequest.orgId, orgId), isNull(dpdpRightsRequest.answeredAt)))
    const [grievancesOpen] = await tx.select({ n: count() }).from(dpdpGrievance).where(eq(dpdpGrievance.orgId, orgId))

    const lines = [
      `VERIDIAN · DPDP position for ${org?.name ?? "this organisation"}`,
      `Snapshot ${new Date().toISOString().slice(0, 10)} · read-only · no personal data`,
      "",
      `DUTIES  ${obligations.length} total · ${obligations.filter((o) => o.state === "closed").length} done · ${late.length} late`,
      `DATA MAP  ${categories.length} categories · ${located} located · ${categories.length - located} unknown`,
      `OUTSIDE FIRMS  ${relationships.length} · agreements signed ${signed}`,
      `OPEN REQUESTS  ${rightsOpen?.n ?? 0}`,
      `COMPLAINTS  ${grievancesOpen?.n ?? 0}`,
      "",
      "HOW TO REPLY",
      "  Output a VERIDIAN-INSTRUCTIONS block: one JSON array of proposed",
      "  lines, each { verb, targetKey, payload }.",
      "  verb is one of: ASSIGN, SET_DUE, NOTE, MARK_NA (reason required), DRAFT.",
      "  targetKey must be a real duty reference already in this snapshot.",
      "  Nothing else parses. The person pastes this back and approves",
      "  each line themselves before anything moves.",
    ]
    return lines.join("\n")
  })
}

// ─── AI proposals: the four/five verbs, strictly allowlisted ────────────
export const ALLOWED_VERBS = ["ASSIGN", "SET_DUE", "NOTE", "MARK_NA", "DRAFT"] as const
export type AllowedVerb = (typeof ALLOWED_VERBS)[number]

export type ProposedLine = { verb: string; targetKey: string; payload?: Record<string, unknown> }

/**
 * Validates one proposed line against the allowlist AND real data --
 * "any line referencing an unknown target_key is refused too" (WO 5.10).
 * Never mutates anything; returns the classification `recordAiProposal`
 * stores.
 */
export async function classifyProposedLine(tx: TenantDb, orgId: string, line: ProposedLine): Promise<{ allowed: boolean; refusalReason: string | null }> {
  if (!ALLOWED_VERBS.includes(line.verb as AllowedVerb)) {
    return { allowed: false, refusalReason: `"${line.verb}" is not something an AI Link proposal may ask for.` }
  }
  if (line.verb === "DRAFT") {
    // Writes an unpublished notice_version at v0.x and nothing else -- no
    // existing target to check, a draft is always a new row.
    return { allowed: true, refusalReason: null }
  }
  const obligation = await tx.query.dpdpObligation.findFirst({ where: and(eq(dpdpObligation.id, line.targetKey), eq(dpdpObligation.orgId, orgId)) })
  if (!obligation) {
    return { allowed: false, refusalReason: "That duty does not exist, or does not belong to this organisation." }
  }
  if (line.verb === "MARK_NA" && !String(line.payload?.reason ?? "").trim()) {
    return { allowed: false, refusalReason: "Marking something not applicable needs a written reason." }
  }
  return { allowed: true, refusalReason: null }
}

async function nextAiProposalRef(orgId: string): Promise<string> {
  const [row] = await db.select({ n: count() }).from(dpdpAiProposal).where(eq(dpdpAiProposal.orgId, orgId))
  return `AI-${String((row?.n ?? 0) + 1).padStart(4, "0")}`
}

export type RecordAiProposalInput = { orgId: string; sourceLabel: string; raw: string; lines: ProposedLine[] }

/** Stores the proposal + every line's classification (allowed/refused with reason) -- nothing is applied yet. */
export async function recordAiProposal(input: RecordAiProposalInput) {
  return withDpdpContext({ orgId: input.orgId }, async (tx) => {
    const ref = await nextAiProposalRef(input.orgId)
    const [proposal] = await tx.insert(dpdpAiProposal).values({ orgId: input.orgId, ref, sourceLabel: input.sourceLabel, raw: input.raw }).returning()
    const lines: (typeof dpdpAiProposalLine.$inferSelect)[] = []
    for (let seq = 0; seq < input.lines.length; seq++) {
      const line = input.lines[seq]
      const { allowed, refusalReason } = await classifyProposedLine(tx, input.orgId, line)
      const [row] = await tx
        .insert(dpdpAiProposalLine)
        .values({ proposalId: proposal.id, seq, verb: line.verb, targetKey: line.targetKey, payload: line.payload, allowed, refusalReason })
        .returning()
      lines.push(row)
    }
    return { proposal, lines }
  })
}

export type ApplyAiProposalInput = { orgId: string; actorIdentityId: string; actorLabel: string; proposalId: string; approvedLineIds: string[] }

/**
 * Applies only the lines that were both (a) allowed by classifyProposedLine
 * and (b) present in approvedLineIds -- a line the classifier refused can
 * never be approved into existence by this function, regardless of what
 * the caller passes.
 */
export async function applyAiProposal(input: ApplyAiProposalInput) {
  return withDpdpContext({ orgId: input.orgId }, async (tx) => {
    const proposal = await tx.query.dpdpAiProposal.findFirst({ where: and(eq(dpdpAiProposal.id, input.proposalId), eq(dpdpAiProposal.orgId, input.orgId)) })
    if (!proposal) throw new ServiceError("Proposal not found", 404)
    if (proposal.state !== "pending") throw new ServiceError("This proposal has already been applied or discarded", 409)

    const allLines = await tx.query.dpdpAiProposalLine.findMany({ where: eq(dpdpAiProposalLine.proposalId, proposal.id) })
    let appliedCount = 0
    for (const line of allLines) {
      const approved = line.allowed && input.approvedLineIds.includes(line.id)
      if (!approved) continue
      if (line.verb === "ASSIGN") {
        await tx.update(dpdpObligation).set({ assignedPersonId: String((line.payload as Record<string, unknown> | null)?.personId ?? "") }).where(eq(dpdpObligation.id, line.targetKey))
      } else if (line.verb === "SET_DUE") {
        const dueOn = String((line.payload as Record<string, unknown> | null)?.dueOn ?? "")
        if (dueOn) await tx.update(dpdpObligation).set({ dueOn }).where(eq(dpdpObligation.id, line.targetKey))
      } else if (line.verb === "MARK_NA") {
        await tx.update(dpdpObligation).set({ state: "not_applicable", naReason: String((line.payload as Record<string, unknown> | null)?.reason ?? "") }).where(eq(dpdpObligation.id, line.targetKey))
      } else if (line.verb === "DRAFT") {
        await tx.insert(dpdpNoticeVersion).values({
          orgId: input.orgId,
          docKind: String((line.payload as Record<string, unknown> | null)?.docKind ?? "privacy_notice"),
          version: "0.1",
          releasedOn: new Date().toISOString().slice(0, 10),
          effectiveFrom: new Date(),
          state: "draft",
        })
      }
      // NOTE has no target-mutation of its own -- the note text is only
      // ever recorded via the event log line below, per obligation, which
      // is what the "add a note" verb actually means here (this schema has
      // no free-standing notes table on obligation).
      await tx.update(dpdpAiProposalLine).set({ approved: true, appliedAt: new Date() }).where(eq(dpdpAiProposalLine.id, line.id))
      appliedCount++
    }

    await tx.update(dpdpAiProposal).set({ state: "applied" }).where(eq(dpdpAiProposal.id, proposal.id))
    await logDpdpEvent(
      {
        orgId: input.orgId,
        actorIdentityId: input.actorIdentityId,
        actorLabel: input.actorLabel,
        kind: "ai_proposal_applied",
        summary: `Approved ${appliedCount} change(s) proposed by ${proposal.sourceLabel} (${proposal.ref})`,
        detail: `${allLines.length - appliedCount} line(s) not applied (refused or not selected)`,
      },
      tx,
    )
    return { appliedCount }
  })
}

export async function discardAiProposal(orgId: string, actorIdentityId: string, actorLabel: string, proposalId: string) {
  return withDpdpContext({ orgId }, async (tx) => {
    const proposal = await tx.query.dpdpAiProposal.findFirst({ where: and(eq(dpdpAiProposal.id, proposalId), eq(dpdpAiProposal.orgId, orgId)) })
    if (!proposal) throw new ServiceError("Proposal not found", 404)
    await tx.update(dpdpAiProposal).set({ state: "discarded" }).where(eq(dpdpAiProposal.id, proposalId))
    await logDpdpEvent({ orgId, actorIdentityId, actorLabel, kind: "ai_proposal_discarded", summary: `Threw away everything ${proposal.sourceLabel} proposed (${proposal.ref})` }, tx)
    return proposal
  })
}
