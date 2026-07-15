// Priority 18b (Owner directive 2026-07-15, Option B). Full design writeup:
// ai-os/priority18b_stage0_design.md + its Option B addendum. Anyone
// holding a shared VERI Chat guest-access or share-link token can
// self-register as an unpaid "stage 0" user -- zero admin approval,
// identity proven only via passwordless email/Gmail magic-link. This file
// is the one place that logic lives: provisioning off an existing token,
// the scoped-inbox query predicate, the org-admin outreach audit view, and
// both auto-upgrade triggers (person-level and org-level).
//
// Security properties, stated plainly for review (same discipline this
// codebase's other auth-adjacent files use):
//   - accountStage is UX-only (nav visibility), never a security boundary
//     -- see schema.ts's own comment on users.accountStage. The real
//     boundary is role: 'stage_0' ranking 1 in ROLE_RANK (auth-guard.ts),
//     which already rejects every requireRole(..., 'member')-or-higher
//     check in the app with zero new code, PLUS this file's own
//     listStage0Inbox() query predicate (direct-conversation-only, never
//     group/org-wide) as the real, narrow, auditable read-scope.
//   - stage0Sources is genuinely multi-org (Option B) -- users.orgId/role
//     stays the single "real home org" anchor. A stage-0 relationship in
//     org A never grants any visibility into org B; each row is
//     independently org_id-scoped by RLS (app_runtime_tenant_isolation,
//     see the migration).
//   - Auto-upgrade never silently reassigns someone's real home org: both
//     triggers below only ever touch a users row whose orgId IS NULL.
//     Someone who already has a different real home org keeps their
//     stage-0 access working exactly as before -- untouched, not broken,
//     not silently reassigned.
//   - Token consumption (consumeStage0TokenAndProvisionUser) uses the raw
//     (RLS-bypassing) db client, following the exact
//     conversationGuestAccess/conversationShareLinks precedent
//     veri-chat-service.ts already documents -- the token itself is the
//     security boundary, same as every other public token-consumption path
//     in this codebase (getSharedConversation, getGuestConversation,
//     autoProvisionUser, consumeInviteLinkAndProvisionUser).
import {
  db, users, aiAssistants, conversations, conversationParticipants, messages,
  conversationGuestAccess, conversationShareLinks, stage0Sources, tasks, instructionCommitments,
} from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, and, inArray, sql as drizzleSql } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }

// --- Token resolution ------------------------------------------------------
export type Stage0SourceType = "guest_access" | "share_link"

export type Stage0TokenRow = {
  sourceType: Stage0SourceType
  sourceTokenId: string
  conversationId: string
  expiresAt: Date
  revokedAt: Date | null
}

export type Stage0TokenStatus = "valid" | "expired" | "revoked"

/**
 * Pure -- mirrors invite-link-service.ts's evaluateInviteLinkStatus and
 * org-join-code-service.ts's evaluateJoinCodeStatus exactly (same shape, no
 * I/O, no clock of its own), so all three "is this token still good" checks
 * in this codebase can never independently drift.
 */
export function evaluateStage0TokenStatus(
  row: Pick<Stage0TokenRow, "expiresAt" | "revokedAt">,
  now: Date
): Stage0TokenStatus {
  if (row.revokedAt) return "revoked"
  if (row.expiresAt.getTime() <= now.getTime()) return "expired"
  return "valid"
}

/**
 * Both conversationGuestAccess and conversationShareLinks tokens are
 * eligible stage-0 on-ramps (design doc section 2.1). Both use plain
 * createId()/cuid2 tokens with no distinguishing prefix, so this tries
 * guest access first, then share links. Raw db client -- see this file's
 * header comment for why.
 */
async function resolveStage0Token(token: string): Promise<Stage0TokenRow | null> {
  const guestAccess = await db.query.conversationGuestAccess.findFirst({ where: eq(conversationGuestAccess.token, token) })
  if (guestAccess) {
    return {
      sourceType: "guest_access",
      sourceTokenId: guestAccess.id,
      conversationId: guestAccess.conversationId,
      expiresAt: guestAccess.expiresAt,
      revokedAt: guestAccess.revokedAt,
    }
  }
  const shareLink = await db.query.conversationShareLinks.findFirst({ where: eq(conversationShareLinks.token, token) })
  if (shareLink) {
    return {
      sourceType: "share_link",
      sourceTokenId: shareLink.id,
      conversationId: shareLink.conversationId,
      expiresAt: shareLink.expiresAt,
      revokedAt: shareLink.revokedAt,
    }
  }
  return null
}

// --- Provisioning (self-serve, zero admin approval) ------------------------
export type ConsumeStage0TokenResult =
  | { ok: true; user: typeof users.$inferSelect; orgId: string; isNewRelationship: boolean }
  | { ok: false; reason: string }

/**
 * Resolves a shared guest-access/share-link token, then provisions (or
 * reuses) the compliance.users row and the (userId, orgId) stage0Sources
 * relationship. No approval step anywhere in this path -- the token itself
 * (created by an org member for an unrelated reason: sharing a chat) is the
 * entire authorization, per the Owner's explicit "no approval needed from
 * any admin" instruction.
 *
 * Option B (multi-org): if authUser.email already has a users row -- an
 * existing stage-0-only person picking up a SECOND org's stage-0
 * relationship, or even a real full member of a different org opening a
 * shared link from this org -- this never inserts a second users row
 * (email is globally unique) and never touches their existing orgId/role.
 * It only adds a new stage0Sources row for THIS org, if one doesn't already
 * (actively) exist.
 */
export async function consumeStage0TokenAndProvisionUser(
  token: string,
  authUser: { id: string; email: string; fullName: string }
): Promise<ConsumeStage0TokenResult> {
  const resolved = await resolveStage0Token(token)
  if (!resolved) return { ok: false, reason: "This link is invalid." }

  const status = evaluateStage0TokenStatus(resolved, new Date())
  if (status !== "valid") {
    return { ok: false, reason: `This link has ${status}.` }
  }

  const convo = await db.query.conversations.findFirst({ where: eq(conversations.id, resolved.conversationId) })
  if (!convo) return { ok: false, reason: "This link is invalid." }
  const orgId = convo.orgId

  let user = await db.query.users.findFirst({ where: eq(users.email, authUser.email) })
  if (!user) {
    const [newUser] = await db.insert(users).values({
      name: authUser.fullName,
      email: authUser.email,
      passwordHash: "supabase-auth-managed", // legacy NOT NULL column, matches every other provisioning path's convention
      role: "stage_0",
      accountStage: "stage_0",
      orgId: null, // Option B: no real home org yet -- stage0Sources is the actual membership record
      authUserId: authUser.id,
      isActive: true, // no separate accept step, matching every other self-serve/no-approval path in this codebase
    }).returning()
    user = newUser
    // Deliberately NO aiAssistants provisioning here -- a stage-0 account is
    // Chat-only by design; if later auto-upgraded to a real member (the 2
    // triggers below), that upgrade path provisions AI Assistants then --
    // the first time this person becomes a genuine full member.
  } else if (!user.authUserId) {
    await db.update(users).set({ authUserId: authUser.id }).where(eq(users.id, user.id))
    user = { ...user, authUserId: authUser.id }
  }

  const existingSource = await db.query.stage0Sources.findFirst({
    where: and(eq(stage0Sources.userId, user.id), eq(stage0Sources.orgId, orgId)),
    columns: { id: true, revokedAt: true },
  })

  let isNewRelationship = false
  if (!existingSource || existingSource.revokedAt) {
    if (existingSource) {
      // Rejoining after a revoke -- reactivate the same row rather than a
      // second one, keeping the partial-unique-index invariant simple.
      await db.update(stage0Sources).set({ revokedAt: null, joinedAt: new Date() }).where(eq(stage0Sources.id, existingSource.id))
    } else {
      await db.insert(stage0Sources).values({
        userId: user.id,
        orgId,
        sourceType: resolved.sourceType,
        sourceTokenId: resolved.sourceTokenId,
        sourceConversationId: resolved.conversationId,
      })
    }
    isNewRelationship = true

    // Growth-loop counter (design doc section 2.5) -- only on a genuinely
    // new/reactivated relationship, so re-visiting an already-joined link
    // doesn't double-count. Mirrors sales-engine-service.ts's
    // resolveReferralLinkAndRecordClick's clickCount increment shape.
    if (resolved.sourceType === "guest_access") {
      await db.update(conversationGuestAccess)
        .set({ stage0SignupCount: drizzleSql`${conversationGuestAccess.stage0SignupCount} + 1` })
        .where(eq(conversationGuestAccess.id, resolved.sourceTokenId))
    } else {
      await db.update(conversationShareLinks)
        .set({ stage0SignupCount: drizzleSql`${conversationShareLinks.stage0SignupCount} + 1` })
        .where(eq(conversationShareLinks.id, resolved.sourceTokenId))
    }
  }

  // If this user isn't already a participant of the token's own
  // conversation, add them -- otherwise a brand-new stage-0 signup off a
  // guest-access token would have no way to actually see or reply to the
  // conversation they just joined via (conversation_participants is the
  // real read/write boundary once they're a real user -- design doc
  // section 2.3's "Posting" note).
  const alreadyParticipant = await db.query.conversationParticipants.findFirst({
    where: and(eq(conversationParticipants.conversationId, resolved.conversationId), eq(conversationParticipants.userId, user.id)),
  })
  if (!alreadyParticipant) {
    await db.insert(conversationParticipants).values({ conversationId: resolved.conversationId, userId: user.id })
  }

  return { ok: true, user, orgId, isNewRelationship }
}

// --- Auto-upgrade Trigger A (person-level) ----------------------------------
export type UpgradeStage0Result =
  | { ok: true; user: typeof users.$inferSelect; wasStage0: boolean }
  | { ok: false; reason: "not_found" | "different_org" }

/**
 * Shared by every real "add/invite an already-existing email as a real
 * member" path in this codebase (consumeInviteLinkAndProvisionUser,
 * redeemJoinCodeAndProvisionUser, POST /api/users direct-add) -- all 3
 * previously assumed the target email was brand new and would hit the
 * users.email UNIQUE constraint (an unhandled insert failure) the moment a
 * stage-0-only person's email was invited for real. This is the single
 * place that assumption is corrected.
 *
 * - No existing row at all -> {ok:false, reason:'not_found'}: the caller
 *   proceeds with its own normal brand-new-user insert, unchanged.
 * - Existing row, orgId already NOT NULL (a real home org elsewhere) ->
 *   {ok:false, reason:'different_org'}: the caller MUST surface a clear
 *   rejection to the inviting admin -- never silently reassign someone's
 *   real home org.
 * - Existing row, orgId IS NULL (a stage-0-only person) -> upgrades that
 *   SAME row in place (no new row/id, so stage0Sources rows, task
 *   assignments, message senderId all keep working) and provisions their
 *   first-ever 5 AI Assistants if they don't already have any (idempotent,
 *   same "seed only if empty" posture pms-enablement-service.ts's own
 *   copy-on-enable seeding uses).
 */
export type Stage0UpgradeDecision = "not_found" | "different_org" | "upgrade"

/**
 * Pure -- the actual decision Trigger A's 3 call sites all need: given
 * whether a users row already exists for this email and its current orgId,
 * what should happen. Extracted so this decision (the safety-critical part
 * -- "never silently reassign a real home org") is unit-testable without a
 * database.
 */
export function decideStage0UpgradeAction(existing: { orgId: string | null } | null): Stage0UpgradeDecision {
  if (!existing) return "not_found"
  if (existing.orgId) return "different_org"
  return "upgrade"
}

export async function tryUpgradeStage0UserInPlace(
  email: string,
  target: { orgId: string; role: string; authUserId?: string }
): Promise<UpgradeStage0Result> {
  const found = await db.query.users.findFirst({ where: eq(users.email, email) })
  const decision = decideStage0UpgradeAction(found ?? null)
  if (decision === "not_found") return { ok: false, reason: "not_found" }
  if (decision === "different_org") return { ok: false, reason: "different_org" }
  const existing = found! // decision === "upgrade" implies found is non-null, per decideStage0UpgradeAction's own logic

  const wasStage0 = existing.role === "stage_0" || existing.accountStage === "stage_0"

  const [updated] = await db.update(users)
    .set({
      orgId: target.orgId,
      role: target.role as typeof users.$inferSelect.role,
      isActive: true,
      accountStage: null, // real member now -- clear the stage-0 nav-visibility flag
      authUserId: target.authUserId ?? existing.authUserId,
      updatedAt: new Date(),
    })
    .where(eq(users.id, existing.id))
    .returning()

  const existingAssistants = await db.query.aiAssistants.findFirst({ where: eq(aiAssistants.userId, existing.id) })
  if (!existingAssistants) {
    await db.insert(aiAssistants).values(
      Array.from({ length: 5 }, (_, i) => ({
        userId: existing.id,
        assistantNumber: i + 1,
        label: `Assistant ${i + 1}`,
      }))
    )
  }

  return { ok: true, user: updated, wasStage0 }
}

// --- Auto-upgrade Trigger B (org-level) -------------------------------------
export type AutoUpgradeOnBranchEnableResult = { upgraded: number; blocked: number }

/**
 * Called (non-fatally, never blocking the branch-enable call itself) from
 * product-branch-service.ts's enableProductBranchForOrg -- the single real
 * chokepoint every enable*ForOrg wrapper in this codebase routes through
 * (erp/pms/construction/crm/firm/fm/veri_chat_v2/veri_reward-enablement-
 * service.ts), so this correctly fires no matter which vertical's paid
 * branch gets enabled, present or future.
 *
 * Promotes every stage-0 user currently linked to THIS org (via an active
 * stage0Sources row) whose users.orgId IS NULL to a real member
 * (role:'member', the safe default) of this org. A stage-0 user who already
 * has a DIFFERENT real home org is deliberately left untouched -- their
 * stage-0 access into this org keeps working exactly as before, counted in
 * `blocked` so the caller can surface it to the enabling admin rather than
 * silently dropping the information.
 */
/**
 * Pure -- the actual partition Trigger B needs: which candidate users are
 * safe to auto-upgrade (orgId IS NULL, no real home org elsewhere) vs which
 * must be left untouched (already have a different real home org).
 * Extracted so this safety-critical partition is unit-testable without a
 * database.
 */
export function partitionEligibleForAutoUpgrade<T extends { orgId: string | null }>(
  candidates: T[]
): { eligible: T[]; blocked: T[] } {
  return {
    eligible: candidates.filter((u) => u.orgId === null),
    blocked: candidates.filter((u) => u.orgId !== null),
  }
}

export async function autoUpgradeStage0UsersOnBranchEnable(orgId: string): Promise<AutoUpgradeOnBranchEnableResult> {
  const sources = await withTenantContext({ orgId }, (tx) =>
    tx.query.stage0Sources.findMany({ where: eq(stage0Sources.orgId, orgId) })
  )
  const activeSources = sources.filter((s) => !s.revokedAt)
  if (activeSources.length === 0) return { upgraded: 0, blocked: 0 }

  const candidateUserIds = Array.from(new Set(activeSources.map((s) => s.userId)))
  const candidateUsers = await db.query.users.findMany({ where: inArray(users.id, candidateUserIds) })

  const { eligible, blocked } = partitionEligibleForAutoUpgrade(candidateUsers)

  if (eligible.length > 0) {
    await db.update(users)
      .set({ orgId, role: "member", isActive: true, accountStage: null, updatedAt: new Date() })
      .where(inArray(users.id, eligible.map((u) => u.id)))

    for (const u of eligible) {
      const existingAssistants = await db.query.aiAssistants.findFirst({ where: eq(aiAssistants.userId, u.id) })
      if (!existingAssistants) {
        await db.insert(aiAssistants).values(
          Array.from({ length: 5 }, (_, i) => ({ userId: u.id, assistantNumber: i + 1, label: `Assistant ${i + 1}` }))
        )
      }
    }
  }

  return { upgraded: eligible.length, blocked: blocked.length }
}

// --- Visibility scope (design doc section 2.3) ------------------------------
export type Stage0InboxItem =
  | { kind: "conversation"; id: string; title: string | null; updatedAt: string }
  | { kind: "task"; id: string; title: string; status: string; assignedById: string | null; dueDate: string | null }
  | { kind: "instruction"; id: string; describedAction: string; assignerId: string; status: string; dueDate: string | null }

/**
 * The real, narrow, auditable authorization + query boundary for a
 * stage-0 user's inbox. Verifies an ACTIVE stage0Sources row exists for
 * (userId, orgId) first (a stage-0 user with a revoked or nonexistent
 * relationship to this org gets a 403, not an empty list -- fails closed).
 * Then unions exactly 3 sources, each scoped by an explicit
 * userId-equals-them predicate:
 *   1. Direct conversations they're a participant of -- type:'direct' ONLY.
 *      A group/channel admin cannot broaden a stage-0 user's inbox by
 *      adding them to a group; this filter is the concrete fix for "not
 *      general channels, even if nominally a participant" (the Owner's own
 *      words).
 *   2. Tasks assigned to them (tasks.userId).
 *   3. Instructions assigned to them (instructionCommitments.assigneeId).
 * All 3 run inside withTenantContext -- RLS (app_runtime, no bypass) is the
 * actual enforcement layer, same posture every other tenant-scoped query in
 * this codebase uses.
 */
/**
 * Shared membership check -- throws 403 unless an ACTIVE stage0Sources row
 * exists for (userId, orgId). Used by listStage0Inbox below and by the
 * stage-0-scoped conversation-messages route (a stage-0 user's
 * requireAuth().orgId is always null under Option B, so the existing
 * org-scoped /api/conversations/[id]/messages route is not usable by them
 * as-is -- this is the real authorization boundary the dedicated
 * /api/stage0/conversations/[id]/messages route runs before delegating to
 * chat-service.ts's existing getMessages/sendMessage).
 */
export async function assertActiveStage0Membership(userId: string, orgId: string): Promise<void> {
  await withTenantContext({ orgId, userId }, async (tx) => {
    const source = await tx.query.stage0Sources.findFirst({
      where: and(eq(stage0Sources.userId, userId), eq(stage0Sources.orgId, orgId)),
    })
    if (!source || source.revokedAt) throw new ServiceError("No stage-0 relationship with this organisation", 403)
  })
}

export async function listStage0Inbox(userId: string, orgId: string): Promise<Stage0InboxItem[]> {
  await assertActiveStage0Membership(userId, orgId)
  return withTenantContext({ orgId, userId }, async (tx) => {

    const myParticipation = await tx.query.conversationParticipants.findMany({ where: eq(conversationParticipants.userId, userId) })
    const convoIds = myParticipation.map((p) => p.conversationId)
    const directConvos = convoIds.length
      ? await tx.query.conversations.findMany({
          where: and(inArray(conversations.id, convoIds), eq(conversations.type, "direct"), eq(conversations.orgId, orgId)),
          orderBy: (t, { desc }) => desc(t.updatedAt),
        })
      : []

    const myTasks = await tx.query.tasks.findMany({
      where: and(eq(tasks.userId, userId), eq(tasks.orgId, orgId)),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })

    const myInstructions = await tx.query.instructionCommitments.findMany({
      where: and(eq(instructionCommitments.assigneeId, userId), eq(instructionCommitments.orgId, orgId)),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })

    const items: Stage0InboxItem[] = [
      ...directConvos.map((c): Stage0InboxItem => ({ kind: "conversation", id: c.id, title: c.title, updatedAt: c.updatedAt.toISOString() })),
      ...myTasks.map((t): Stage0InboxItem => ({ kind: "task", id: t.id, title: t.title, status: t.status, assignedById: t.assignedById, dueDate: t.dueDate?.toISOString() ?? null })),
      ...myInstructions.map((i): Stage0InboxItem => ({ kind: "instruction", id: i.id, describedAction: i.describedAction, assignerId: i.assignerId, status: i.status, dueDate: i.dueDate?.toISOString() ?? null })),
    ]
    return items
  })
}

/**
 * Self-scoped only -- returns the orgIds a userId has an ACTIVE stage0Sources
 * relationship with, so a caller (the /api/stage0/inbox route) can call
 * listStage0Inbox once per org and merge results, exactly as the design doc
 * intended for Option B ("the one place in the app that is deliberately not
 * single-org-scoped"). Uses the raw db client filtered explicitly by the
 * caller's OWN userId -- legitimate the same way requireAuth() itself reads
 * the users table pre-tenant-context: this is "list MY OWN memberships",
 * never an arbitrary cross-org query.
 */
export async function listStage0OrgsForUser(userId: string): Promise<{ orgId: string; orgName: string }[]> {
  const rows = await db.query.stage0Sources.findMany({
    where: eq(stage0Sources.userId, userId),
    with: { org: { columns: { id: true, name: true } } },
  })
  return rows.filter((r) => !r.revokedAt).map((r) => ({ orgId: r.orgId, orgName: r.org?.name ?? "Organisation" }))
}

// --- Tracking / org-admin audit view (design doc section 2.4) --------------
export type Stage0OutreachRow = {
  stage0UserId: string
  stage0UserName: string
  senderId: string | null
  senderName: string | null
  conversationId: string
  lastMessageAt: string
}

/**
 * "Which of our real users have messaged which stage-0 users, and when" --
 * an org-admin-facing audit view, not a new ledger. The actual "what was
 * sent" content already lives in `messages`; this just joins stage0Sources
 * against that existing data, matching getPartnerDashboard()'s own
 * read-model pattern (sales-engine-service.ts) rather than duplicating data
 * that already exists (this codebase's "Zero duplication" precedent).
 */
export async function listStage0OutreachForOrg(orgId: string): Promise<Stage0OutreachRow[]> {
  return withTenantContext({ orgId }, async (tx) => {
    const stage0Users = await tx.query.stage0Sources.findMany({
      where: eq(stage0Sources.orgId, orgId),
      with: { user: { columns: { id: true, name: true } } },
    })
    const activeStage0Users = stage0Users.filter((s) => !s.revokedAt)
    if (activeStage0Users.length === 0) return []
    const stage0UserIds = activeStage0Users.map((s) => s.userId)
    const nameById = new Map(activeStage0Users.map((s) => [s.userId, s.user?.name ?? "Stage-0 user"]))

    const participations = await tx.query.conversationParticipants.findMany({
      where: inArray(conversationParticipants.userId, stage0UserIds),
    })
    const convoIds = Array.from(new Set(participations.map((p) => p.conversationId)))
    if (convoIds.length === 0) return []

    const orgConvos = await tx.query.conversations.findMany({
      where: and(inArray(conversations.id, convoIds), eq(conversations.orgId, orgId)),
    })
    const orgConvoIds = new Set(orgConvos.map((c) => c.id))

    const convoIdByStage0User = new Map(
      participations.filter((p) => orgConvoIds.has(p.conversationId)).map((p) => [p.conversationId, p.userId])
    )

    const rows = await tx.query.messages.findMany({
      where: inArray(messages.conversationId, Array.from(orgConvoIds)),
      orderBy: (t, { desc }) => desc(t.createdAt),
    })

    const senderIds = Array.from(new Set(rows.map((m) => m.senderId).filter((id): id is string => !!id)))
    const senders = senderIds.length ? await tx.query.users.findMany({ where: inArray(users.id, senderIds) }) : []
    const senderNameById = new Map(senders.map((s) => [s.id, s.name]))

    return rows
      .filter((m) => convoIdByStage0User.has(m.conversationId))
      .map((m) => ({
        stage0UserId: convoIdByStage0User.get(m.conversationId)!,
        stage0UserName: nameById.get(convoIdByStage0User.get(m.conversationId)!) ?? "Stage-0 user",
        senderId: m.senderId,
        senderName: m.senderId ? senderNameById.get(m.senderId) ?? null : null,
        conversationId: m.conversationId,
        lastMessageAt: m.createdAt.toISOString(),
      }))
  })
}
