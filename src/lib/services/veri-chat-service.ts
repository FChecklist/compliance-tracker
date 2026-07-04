// Wave 32 (VERI Chat, PLATFORM_STRATEGY.md §16). Extends chat-service.ts --
// does not duplicate its conversation/message CRUD. Covers the 3 genuinely
// new capabilities: context-linking a conversation to any module record,
// document attachments, and the share-out/share-in mechanism confirmed
// technically sound by §16.2's research (a tokenized read-only public page,
// never raw chat content in a wa.me/t.me URL; a Web Share Target for
// receiving content shared from any app, including WhatsApp/Telegram's own
// native "Export Chat"/Share Sheet).
import { createId } from "@paralleldrive/cuid2"
import {
  db, conversations, conversationParticipants, messages, messageAttachments,
  conversationShareLinks, documents,
} from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type VeriChatContext = { orgId: string; userId: string }

async function assertParticipant(orgId: string, userId: string, conversationId: string) {
  return withTenantContext({ orgId, userId }, async (db) => {
    const membership = await db.query.conversationParticipants.findFirst({
      where: and(eq(conversationParticipants.conversationId, conversationId), eq(conversationParticipants.userId, userId)),
    })
    if (!membership) throw new ServiceError("Conversation not found", 404)
  })
}

export async function setConversationContext(
  ctx: VeriChatContext,
  conversationId: string,
  input: { contextEntityType: string | null; contextEntityId: string | null }
) {
  await assertParticipant(ctx.orgId, ctx.userId, conversationId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [updated] = await db.update(conversations)
      .set({ contextEntityType: input.contextEntityType, contextEntityId: input.contextEntityId, updatedAt: new Date() })
      .where(eq(conversations.id, conversationId)).returning()
    return updated
  })
}

export async function attachDocumentToMessage(ctx: VeriChatContext, messageId: string, documentId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const message = await db.query.messages.findFirst({ where: eq(messages.id, messageId) })
    if (!message) throw new ServiceError("Message not found", 404)
    await assertParticipant(ctx.orgId, ctx.userId, message.conversationId)
    const document = await db.query.documents.findFirst({ where: and(eq(documents.id, documentId), eq(documents.orgId, ctx.orgId)) })
    if (!document) throw new ServiceError("Document not found", 404)

    const [attachment] = await db.insert(messageAttachments).values({ messageId, documentId }).returning()
    return attachment
  })
}

// ─── Share-out: tokenized, time-limited, read-only public page ──────────
export async function createShareLink(ctx: VeriChatContext, conversationId: string, expiresInHours = 72) {
  await assertParticipant(ctx.orgId, ctx.userId, conversationId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000)
    const [link] = await db.insert(conversationShareLinks).values({
      conversationId, token: createId(), createdById: ctx.userId, expiresAt,
    }).returning()
    return link
  })
}

export async function listShareLinks(ctx: VeriChatContext, conversationId: string) {
  await assertParticipant(ctx.orgId, ctx.userId, conversationId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, (db) =>
    db.query.conversationShareLinks.findMany({
      where: eq(conversationShareLinks.conversationId, conversationId),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })
  )
}

export async function revokeShareLink(ctx: VeriChatContext, linkId: string) {
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const link = await db.query.conversationShareLinks.findFirst({ where: eq(conversationShareLinks.id, linkId) })
    if (!link) throw new ServiceError("Share link not found", 404)
    await assertParticipant(ctx.orgId, ctx.userId, link.conversationId)
    const [updated] = await db.update(conversationShareLinks).set({ revokedAt: new Date() }).where(eq(conversationShareLinks.id, linkId)).returning()
    return updated
  })
}

// Public route (no auth) -- resolves a token to a read-only message list.
// Expired/revoked tokens 404 rather than distinguish "expired" from "never
// existed", so an attacker can't use response differences to enumerate
// valid-but-expired tokens. Uses the raw `db` export (the `postgres` role,
// same one every not-yet-migrated route in this codebase already uses) --
// there is no session/org context for a public link to run withTenantContext
// against, so this is the legitimate, existing RLS-bypass path, not a new one.
export async function getSharedConversation(token: string) {
  const link = await db.query.conversationShareLinks.findFirst({ where: eq(conversationShareLinks.token, token) })
  if (!link || link.revokedAt || link.expiresAt < new Date()) throw new ServiceError("This share link is invalid or has expired", 404)

  const convo = await db.query.conversations.findFirst({ where: eq(conversations.id, link.conversationId) })
  if (!convo) throw new ServiceError("This share link is invalid or has expired", 404)

  const rows = await db.query.messages.findMany({
    where: eq(messages.conversationId, link.conversationId),
    orderBy: (t, { asc }) => asc(t.createdAt),
  })
  return {
    title: convo.title,
    messages: rows.map((m) => ({ senderId: m.senderId, content: m.content, createdAt: m.createdAt.toISOString() })),
  }
}

// ─── Share-in: Web Share Target handler ──────────────────────────────────
// Lands imported content in a dedicated per-user "Shared In" conversation
// (created lazily, mirroring ensureAiThread()'s own lazy-create pattern in
// chat-service.ts), tagged with where it came from. The user can move
// individual messages into a real conversation later; this pass just
// guarantees nothing shared in is ever lost or silently dropped.
async function ensureSharedInConversation(orgId: string, userId: string): Promise<string> {
  return withTenantContext({ orgId, userId }, async (db) => {
    const existing = await db.query.conversations.findFirst({
      where: and(eq(conversations.contextEntityType, "shared_in_inbox"), eq(conversations.contextEntityId, userId)),
    })
    if (existing) return existing.id

    const [created] = await db.insert(conversations).values({
      orgId, type: "direct", title: "Shared In", contextEntityType: "shared_in_inbox", contextEntityId: userId,
    }).returning()
    await db.insert(conversationParticipants).values({ conversationId: created.id, userId })
    return created.id
  })
}

export async function importSharedContent(
  ctx: VeriChatContext,
  input: { text: string; sourcePlatform?: string; sourceRef?: string }
) {
  const content = input.text?.trim()
  if (!content) throw new ServiceError("Shared content had no text", 400)

  const conversationId = await ensureSharedInConversation(ctx.orgId, ctx.userId)
  return withTenantContext({ orgId: ctx.orgId, userId: ctx.userId }, async (db) => {
    const [message] = await db.insert(messages).values({
      conversationId, senderId: ctx.userId, content,
      sourcePlatform: input.sourcePlatform || null, sourceRef: input.sourceRef || null,
    }).returning()
    await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId))
    return { conversationId, message }
  })
}
