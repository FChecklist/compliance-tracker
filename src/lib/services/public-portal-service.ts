// Public self-service portal (Helpdesk gap-closure,
// DEEP_ERP_FUNCTIONALITY_COMPLETION_VIA_ODOO_ERPNEXT_REFERENCE Phase 0,
// 2026-07-27). Confirmed genuinely absent before building (per that
// phase's own verify-first instruction): knowledge_base_pages had no
// publish/visibility flag, /knowledge-base and /tickets are both in the
// protected-route allowlist, and every KB/ticket API route required
// requireAuth()/requireAuthOrApiKey() -- conversation_guest_access is
// always staff-issued after a ticket already exists, never self-initiated.
//
// This is the one new genuinely-unauthenticated write surface in this
// module. Builds on the same established convention this codebase already
// uses for every other pre-auth public read (getOrgBySlugWithSso in
// sso-service.ts -- "this codebase's own established convention for
// public token/slug-scoped reads"): resolves the org by its existing
// public, unique `organisations.slug` column, and uses the raw
// (RLS-bypassing) `db` client throughout, since there's no session/tenant
// context to run withTenantContext against -- same posture
// getGuestConversation()/getOrgBySlugWithSso() already document.
//
// Ticket creation does NOT reuse ticket-service.ts's createTicket(): that
// function requires a real authenticated ctx.userId (added as a
// conversation participant, and inserted into tickets.createdById), which
// a public visitor doesn't have. Following this codebase's own
// established sentinel-actor convention for an automated/non-human insert
// into a NOT-NULL-but-not-FK-enforced created-by-style column (e.g.
// "system:vercel-deployment-webhook" in the deployment webhook route --
// createdById-style columns are plain text with no DB foreign key,
// confirmed across schema.ts), createdById here is a fixed
// "system:public-ticket-form" sentinel. The ticket is only reachable by
// staff because it's routed to a real ticket_teams row with a
// leadUserId, who is added as a real conversation participant -- required
// for RLS visibility, mirroring createTicket's own team-routing behavior
// in ticket-service.ts. A public submission with no resolvable default
// team is rejected (400) rather than silently creating a ticket no
// authenticated staff member could ever see.
import {
  db, organisations, knowledgeBasePages, tickets, conversations, conversationParticipants,
  messages, conversationGuestAccess, ticketTeams, publicTicketSubmissionAttempts,
} from "@/lib/db"
import { eq, and, gte, sql } from "drizzle-orm"
import { createId } from "@paralleldrive/cuid2"
import { ServiceError } from "./compliance-service"
export { ServiceError }

const PUBLIC_TICKET_SENTINEL_ACTOR_ID = "system:public-ticket-form"
const RATE_LIMIT_WINDOW_MINUTES = 15
const RATE_LIMIT_MAX_ATTEMPTS = 5
const GUEST_ACCESS_EXPIRY_DAYS = 30
const MAX_SUBJECT_LENGTH = 300
const MAX_BODY_LENGTH = 10_000

export async function getPublicOrgBySlug(orgSlug: string) {
  const org = await db.query.organisations.findFirst({ where: eq(organisations.slug, orgSlug) })
  if (!org) throw new ServiceError("Portal not found", 404)
  return org
}

export async function listPublishedKbPages(orgSlug: string) {
  const org = await getPublicOrgBySlug(orgSlug)
  return db.query.knowledgeBasePages.findMany({
    where: and(eq(knowledgeBasePages.orgId, org.id), eq(knowledgeBasePages.isPublished, true), eq(knowledgeBasePages.isArchived, false)),
    orderBy: (t, { asc }) => asc(t.title),
    columns: { id: true, slug: true, title: true, content: true, updatedAt: true },
  })
}

export async function getPublishedKbPageBySlug(orgSlug: string, pageSlug: string) {
  const org = await getPublicOrgBySlug(orgSlug)
  const page = await db.query.knowledgeBasePages.findFirst({
    where: and(
      eq(knowledgeBasePages.orgId, org.id), eq(knowledgeBasePages.slug, pageSlug),
      eq(knowledgeBasePages.isPublished, true), eq(knowledgeBasePages.isArchived, false)
    ),
  })
  if (!page) throw new ServiceError("Page not found", 404)
  return page
}

export type PublicTicketRateLimitCheck = { limited: false } | { limited: true; retryAfterSeconds: number }

/** Same DB-log-table-plus-windowed-count shape as checkJoinCodeRateLimit (org-join-code-service.ts) -- the one established rate-limit precedent in this codebase. */
export async function checkPublicTicketRateLimit(ipAddress: string): Promise<PublicTicketRateLimitCheck> {
  const cutoff = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000)
  const [row] = await db.select({ count: sql<number>`count(*)` })
    .from(publicTicketSubmissionAttempts)
    .where(and(eq(publicTicketSubmissionAttempts.ipAddress, ipAddress), gte(publicTicketSubmissionAttempts.createdAt, cutoff)))

  if (Number(row?.count ?? 0) >= RATE_LIMIT_MAX_ATTEMPTS) {
    return { limited: true, retryAfterSeconds: RATE_LIMIT_WINDOW_MINUTES * 60 }
  }
  return { limited: false }
}

async function recordAttempt(ipAddress: string, orgId: string | null, wasSuccessful: boolean): Promise<void> {
  // Fire-and-forget, matches org-join-code-service.ts's recordAttempt() convention exactly.
  db.insert(publicTicketSubmissionAttempts).values({ ipAddress, orgId, wasSuccessful }).then(() => {})
}

export async function submitPublicTicket(
  orgSlug: string,
  ipAddress: string,
  input: { subject: string; body: string; guestName: string; guestEmail?: string }
) {
  // Checked BEFORE the org/team lookup, same posture as
  // checkJoinCodeRateLimit's own doc comment -- a rate-limited IP gets the
  // same generic response whether or not the org slug it's trying even
  // resolves.
  const limit = await checkPublicTicketRateLimit(ipAddress)
  if (limit.limited) throw new ServiceError("Too many submissions from this network -- please try again later", 429)

  const subject = input.subject?.trim()
  const body = input.body?.trim()
  const guestName = input.guestName?.trim()
  if (!subject) throw new ServiceError("subject is required", 400)
  if (!body) throw new ServiceError("body is required", 400)
  if (!guestName) throw new ServiceError("guestName is required", 400)
  if (subject.length > MAX_SUBJECT_LENGTH) throw new ServiceError("subject is too long", 400)
  if (body.length > MAX_BODY_LENGTH) throw new ServiceError("body is too long", 400)

  let org: Awaited<ReturnType<typeof getPublicOrgBySlug>>
  try {
    org = await getPublicOrgBySlug(orgSlug)
  } catch (error) {
    await recordAttempt(ipAddress, null, false)
    throw error
  }

  const team = await db.query.ticketTeams.findFirst({ where: and(eq(ticketTeams.orgId, org.id), eq(ticketTeams.isDefault, true)) })
  if (!team || !team.leadUserId) {
    await recordAttempt(ipAddress, org.id, false)
    throw new ServiceError("This helpdesk isn't accepting public tickets yet -- no default team is configured", 400)
  }

  const conversationId = createId()
  await db.insert(conversations).values({ id: conversationId, orgId: org.id, type: "direct", title: subject })
  // The team lead is the only participant -- required so a real,
  // RLS-scoped staff member can ever see this ticket (see this file's own
  // header comment).
  await db.insert(conversationParticipants).values({ conversationId, userId: team.leadUserId })
  await db.insert(messages).values({
    conversationId, senderId: null,
    content: `[Public portal submission from ${guestName}${input.guestEmail ? ` <${input.guestEmail}>` : ""}]\n\n${body}`,
  })

  const [ticket] = await db.insert(tickets).values({
    orgId: org.id, conversationId, subject, teamId: team.id,
    requesterEmail: input.guestEmail?.trim() || null,
    createdById: PUBLIC_TICKET_SENTINEL_ACTOR_ID,
  }).returning()

  // Reuses conversation_guest_access exactly as-is (same mechanism
  // inviteGuestToTicket already uses, just self-issued at submission time
  // instead of staff-issued after the fact) -- gives the anonymous
  // submitter a token to check back on/reply to their own ticket, without
  // ever exposing another guest's or another org's data.
  const [guestAccess] = await db.insert(conversationGuestAccess).values({
    conversationId, token: createId(), guestName, guestEmail: input.guestEmail?.trim() || null,
    invitedById: PUBLIC_TICKET_SENTINEL_ACTOR_ID,
    expiresAt: new Date(Date.now() + GUEST_ACCESS_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
  }).returning()

  await recordAttempt(ipAddress, org.id, true)
  return { ticket, guestAccessToken: guestAccess.token }
}
