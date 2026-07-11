// Area 15 (U-D27.B3.S1, "4 distinct invitation paths"): Path C from
// Requirement.docx -- "User Self-Registration via code -- user goes into
// Settings, enters a code given by the Master Admin, account gets
// activated." Built here as "enters the code during signup" per this
// dispatch's brief (the signup form, not a post-signup Settings screen --
// there is no authenticated pre-org-membership Settings surface to put it
// in anyway, since Settings itself requires an org). Third of the 4 paths
// to exist -- Master-Admin-direct-add (POST /api/users) and Secure Invite
// Link (invite-link-service.ts) already shipped.
//
// Path D (peer-provided-code self-registration -- any existing user, not
// just an admin, can hand out a join code) is now built here too, on the
// SAME redemption mechanism above -- the only real difference is WHO may
// mint a code, and what limits apply to that peer-minted code. Full
// privilege-escalation writeup (per the dispatch brief's explicit ask to
// consider this, not just copy the admin path's freedom):
//
//   1. Role-assignment ceiling: minting is no longer gated to a flat
//      "admin or manager" allowlist. Instead, ANY authenticated org member
//      may mint a code, but only for a role at or below their OWN
//      ROLE_RANK (src/lib/supabase/auth-guard.ts's existing hierarchy,
//      already used for this exact "can this user act at rank X" purpose
//      in approval-workflow-service.ts). isPrivilegedMinter/
//      resolveAllowedMintRoles below implement this. Concretely: a
//      'member' (rank 2) can only mint 'member' or 'viewer' codes, never
//      'manager'/'admin'; a 'viewer' (rank 1) can only mint 'viewer'
//      codes. This is a STRICTER check than the old gate, not just an
//      addition -- it also closes a real pre-existing gap: previously any
//      'manager' could mint a code granting the FULL 'admin' role to
//      whoever redeemed it (the old check only asked "is the minter an
//      admin or a manager", not "is the minter allowed to grant THIS
//      role"). That gap is fixed here as a direct consequence of doing
//      Path D properly, not a separate change.
//   2. Blast-radius limits on non-privileged (peer) mints specifically:
//      admin/manager minting (rank >= manager) is completely unchanged
//      from Path C -- nullable/indefinite expiry, no cap on how many
//      active codes they hold. A peer mint (rank < manager) additionally
//      gets a forced expiry (14-day default, 30-day max --
//      resolvePeerExpiryDays) and a hard cap of PEER_MAX_ACTIVE_CODES (3)
//      simultaneously-active codes per creator (countActiveCodesForCreator).
//      Rationale: a peer account is far more numerous and far less
//      vetted than an admin/manager account, so a compromised or
//      malicious one should only ever be able to leave a small number of
//      short-lived doors open, never an indefinite stockpile of them.
//      The existing IP-keyed redemption rate limit (below) already covers
//      brute-forcing a code's value; this is the separate, previously-
//      absent limit on how many codes a single account can mint in the
//      first place.
//   createdByRole (schema) persists the minter's role at mint time so
//   admin-minted and peer-minted codes are distinguishable in the data
//   (e.g. `created_by_role NOT IN ('admin','manager')`), without a
//   second table or a boolean that would need its own migration if the
//   privileged bar ever moves.
//
// Security properties, stated plainly for review (per dispatch brief):
//   - org-scoped + role-fixed at creation: identical posture to
//     org_invite_links -- never inferred from anything the redeemer sends.
//   - long-lived by default for privileged (admin/manager) mints
//     (expiresAt nullable) -- these codes are meant to be shared
//     verbally/in a doc and read out loud, not clicked, so they need to
//     survive longer; an admin can still set an expiry or revoke early.
//     Peer mints do NOT get this indefinite default -- see #2 above.
//   - rank-ceiling minting: see #1 above -- replaces the old flat
//     admin/manager gate with a per-role ceiling enforced for every
//     minter, privileged or not.
//   - real entropy despite being human-typeable: 12 characters from a
//     30-symbol alphabet (excludes 0/O/1/I/L/U to avoid transcription
//     errors when read aloud or handwritten) = 30^12 ≈ 5.3×10^17
//     possibilities (~59 bits) -- far more than the "8+ chars" floor the
//     brief names, formatted XXXX-XXXX-XXXX for readability.
//   - hashed at rest: only codeHash (SHA-256, same hashSHA256 as api-keys
//     and invite-link-service) is ever persisted -- the raw code is
//     returned to the creating admin exactly once, at creation.
//   - rate-limited: every preview/redemption attempt (success or failure)
//     is logged to org_join_code_attempts, keyed by requester IP.
//     checkJoinCodeRateLimit blocks further attempts from an IP once it
//     has RATE_LIMIT_MAX_FAILURES failed attempts inside
//     RATE_LIMIT_WINDOW_MINUTES -- checked BEFORE the code lookup runs, so
//     a blocked IP never even gets a valid/invalid signal. Honest
//     limitation, named rather than oversold: this is IP-keyed, not
//     code-keyed -- a distributed attacker rotating source IPs is not
//     stopped by this alone. Combined with the ~60-bit code space, the
//     realistic brute-force cost is still prohibitive (rate limiting turns
//     a fast online guess into a slow one; the entropy makes "slow" matter).
//   - redemption still requires a real Supabase Auth signup, exactly like
//     the invite link -- this mechanism only decides which ORG an
//     already-authenticating identity lands in, never authenticates by
//     itself.
import { db, organisations, orgJoinCodes, orgJoinCodeAttempts, users, aiAssistants } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { eq, desc, and, gte, sql } from "drizzle-orm"
import { randomBytes } from "crypto"
import { hashSHA256 } from "@/lib/api-keys"
import { canAssignSeat } from "@/lib/org-license-service"
import { INVITE_ROLES, isInviteRole, type InviteRole } from "@/lib/invite-link-service"
// ROLE_RANK/UserRole: auth-guard.ts imports redeemJoinCodeAndProvisionUser
// from THIS file, so this is a circular import. Safe in practice because
// ROLE_RANK is only ever read inside function bodies below (requesterRank,
// isPrivilegedMinter, resolveAllowedMintRoles), never at this module's own
// top level -- by the time any of those functions actually runs, both
// modules have finished loading. Do not hoist a top-level
// `const X = ROLE_RANK.foo` here; that would run during module init and
// could see a not-yet-populated binding depending on which side of the
// cycle loads first.
import { ROLE_RANK, type UserRole } from "@/lib/supabase/auth-guard"

export { INVITE_ROLES, isInviteRole }
export type { InviteRole }

// Excludes 0/O, 1/I/L, and U (to avoid V/U confusion when handwritten) --
// optimized for "read aloud over a phone call" and "handwritten on a
// whiteboard," the two use cases the source doc actually names ("code
// given by the Master Admin"). 30 symbols (22 letters + digits 2-9).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"
const CODE_LENGTH = 12
const CODE_GROUP_SIZE = 4

const RATE_LIMIT_WINDOW_MINUTES = 15
const RATE_LIMIT_MAX_FAILURES = 10

// Path D blast-radius limits for non-privileged (peer) mints -- see this
// file's header comment for the full reasoning. Admin/manager mints
// (isPrivilegedMinter true) are never subject to these.
export const PEER_MIN_MINT_EXPIRY_DAYS = 1
export const PEER_DEFAULT_MINT_EXPIRY_DAYS = 14
export const PEER_MAX_MINT_EXPIRY_DAYS = 30
export const PEER_MAX_ACTIVE_CODES = 3

/** Pure. Falls back to rank 0 for an unrecognized role string, same defensive posture as ROLE_RANK's other call sites (approval-workflow-service.ts). */
function requesterRank(role: string): number {
  return ROLE_RANK[role as UserRole] ?? 0
}

/**
 * Pure -- the bar for "admin path" behavior (no forced expiry, no active-
 * code cap): rank >= manager, i.e. the same two roles ('admin', 'manager')
 * the old flat gate allowed, so existing admin/manager behavior is
 * unchanged. Anyone below this rank is a "peer" minter for the purposes
 * of the limits in #2 of this file's header comment.
 */
export function isPrivilegedMinter(role: string): boolean {
  return requesterRank(role) >= ROLE_RANK.manager
}

/**
 * Pure -- the set of INVITE_ROLES a given requester may mint a code for:
 * every role at or below their own ROLE_RANK. This is the rank-ceiling
 * from #1 of this file's header comment -- it applies uniformly (not just
 * to "peers"), which is what closes the pre-existing gap where any
 * manager could mint an admin-granting code.
 */
export function resolveAllowedMintRoles(requesterRole: string): InviteRole[] {
  const rank = requesterRank(requesterRole)
  return INVITE_ROLES.filter((r) => ROLE_RANK[r] <= rank)
}

/**
 * Pure -- clamps a peer's requested expiry to
 * [PEER_MIN_MINT_EXPIRY_DAYS, PEER_MAX_MINT_EXPIRY_DAYS], defaulting to
 * PEER_DEFAULT_MINT_EXPIRY_DAYS for anything missing/non-finite/non-positive.
 * Never returns null -- unlike the privileged path, a peer-minted code
 * always expires.
 */
export function resolvePeerExpiryDays(requested: number | null | undefined): number {
  if (requested == null || !Number.isFinite(requested) || requested <= 0) return PEER_DEFAULT_MINT_EXPIRY_DAYS
  return Math.min(Math.max(Math.floor(requested), PEER_MIN_MINT_EXPIRY_DAYS), PEER_MAX_MINT_EXPIRY_DAYS)
}

/**
 * Pure -- crypto.randomBytes rejection-sampled against CODE_ALPHABET's
 * length so every symbol has exactly equal probability (a naive `% 31`
 * would bias low values slightly; with 31 not a power of 2 the bias is
 * small but avoidable at negligible cost, so it's avoided).
 */
export function generateJoinCode(): string {
  const bytes = randomBytes(CODE_LENGTH * 2) // oversample, discard out-of-range bytes below
  let raw = ""
  let i = 0
  while (raw.length < CODE_LENGTH) {
    if (i >= bytes.length) throw new Error("generateJoinCode: exhausted random buffer -- statistically should never happen")
    const b = bytes[i]!
    i += 1
    const max = Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length
    if (b >= max) continue // reject, keeps every symbol equiprobable
    raw += CODE_ALPHABET[b % CODE_ALPHABET.length]
  }
  return formatJoinCode(raw)
}

/** Pure -- "ABCDEFGHJKMN" -> "ABCD-EFGH-JKMN". */
export function formatJoinCode(raw: string): string {
  const groups: string[] = []
  for (let i = 0; i < raw.length; i += CODE_GROUP_SIZE) groups.push(raw.slice(i, i + CODE_GROUP_SIZE))
  return groups.join("-")
}

/**
 * Pure -- canonicalizes user-typed input before hashing/lookup: uppercases,
 * strips whitespace/dashes. Tolerant of "abcd efgh jkmn", "abcd-efgh-jkmn",
 * "ABCDEFGHJKMN" all resolving to the same lookup key, since this is
 * transcribed by hand far more often than the invite link's clicked token.
 */
export function normalizeJoinCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "")
}

export type JoinCodeRow = typeof orgJoinCodes.$inferSelect

export type JoinCodeStatus = "valid" | "expired" | "revoked"

/**
 * Pure -- mirrors invite-link-service.ts's evaluateInviteLinkStatus: takes
 * the row and "now" as plain data, no I/O, no clock of its own. No
 * "exhausted" state here (unlike the invite link) -- join codes are
 * reusable by design, redeemCount never gates anything.
 */
export function evaluateJoinCodeStatus(
  row: Pick<JoinCodeRow, "expiresAt" | "revokedAt">,
  now: Date
): JoinCodeStatus {
  if (row.revokedAt) return "revoked"
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return "expired"
  return "valid"
}

export async function createJoinCode(params: {
  orgId: string
  role: InviteRole
  createdByUserId: string
  createdByRole: string
  label?: string
  expiresInDays?: number | null
}): Promise<{ id: string; code: string; role: InviteRole; expiresAt: Date | null }> {
  const code = generateJoinCode()
  const normalized = normalizeJoinCode(code)
  const codeHash = await hashSHA256(normalized)
  const expiresAt = params.expiresInDays != null && params.expiresInDays > 0
    ? new Date(Date.now() + params.expiresInDays * 24 * 60 * 60 * 1000)
    : null

  const [row] = await withTenantContext({ orgId: params.orgId, userId: params.createdByUserId }, (tx) =>
    tx.insert(orgJoinCodes).values({
      orgId: params.orgId,
      role: params.role,
      codeHash,
      codePrefix: code.slice(0, CODE_GROUP_SIZE),
      label: params.label?.trim() || null,
      createdByUserId: params.createdByUserId,
      createdByRole: params.createdByRole,
      expiresAt,
    }).returning()
  )

  // The raw code is returned to the caller exactly once -- it is not
  // retrievable again after this call (only codeHash is stored), same
  // convention as createInviteLink()/generateApiKey().
  return { id: row.id, code, role: params.role, expiresAt }
}

/**
 * `filter.createdByUserId` scopes the list to codes created by that one
 * user -- used for a non-privileged (peer) caller, who should only ever
 * see/manage their own codes, not the whole org's. Privileged
 * (admin/manager) callers pass no filter, unchanged from Path C.
 */
export async function listJoinCodes(orgId: string, filter?: { createdByUserId?: string }): Promise<JoinCodeRow[]> {
  return withTenantContext({ orgId }, (tx) =>
    tx.query.orgJoinCodes.findMany({
      where: filter?.createdByUserId
        ? and(eq(orgJoinCodes.orgId, orgId), eq(orgJoinCodes.createdByUserId, filter.createdByUserId))
        : eq(orgJoinCodes.orgId, orgId),
      orderBy: desc(orgJoinCodes.createdAt),
    })
  )
}

/**
 * Counts this creator's currently-valid (not expired, not revoked) codes
 * within the org -- backs the PEER_MAX_ACTIVE_CODES cap. Evaluated
 * in-process via evaluateJoinCodeStatus rather than a SQL WHERE on
 * expiresAt, since "valid" already has to handle the no-expiry-at-all
 * case identically everywhere else in this file.
 */
export async function countActiveCodesForCreator(orgId: string, createdByUserId: string): Promise<number> {
  const rows = await withTenantContext({ orgId }, (tx) =>
    tx.query.orgJoinCodes.findMany({
      where: and(eq(orgJoinCodes.orgId, orgId), eq(orgJoinCodes.createdByUserId, createdByUserId)),
      columns: { expiresAt: true, revokedAt: true },
    })
  )
  const now = new Date()
  return rows.filter((row) => evaluateJoinCodeStatus(row, now) === "valid").length
}

/**
 * `restrictToCreatedBy`, when set, adds an ownership check to the WHERE
 * clause so a non-privileged (peer) caller can only revoke a code THEY
 * created -- a privileged (admin/manager) caller omits it and keeps the
 * unrestricted Path-C behavior (revoke any code in the org).
 */
export async function revokeJoinCode(
  orgId: string,
  id: string,
  revokedByUserId: string,
  restrictToCreatedBy?: string
): Promise<boolean> {
  const rows = await withTenantContext({ orgId, userId: revokedByUserId }, (tx) =>
    tx.update(orgJoinCodes)
      .set({ revokedAt: new Date(), revokedByUserId, updatedAt: new Date() })
      .where(
        restrictToCreatedBy
          ? and(eq(orgJoinCodes.id, id), eq(orgJoinCodes.createdByUserId, restrictToCreatedBy))
          : eq(orgJoinCodes.id, id)
        // org scoping enforced by RLS (app_runtime_tenant_isolation) in both branches, not just this WHERE
      )
      .returning({ id: orgJoinCodes.id })
  )
  return rows.length > 0
}

export type RateLimitCheck = { limited: false } | { limited: true; retryAfterSeconds: number }

/**
 * Counts failed attempts from `ipAddress` in the trailing window using the
 * raw (RLS-bypassing) db client -- same rationale as every other pre-auth
 * lookup in this file: no tenant context exists yet to scope by. Checked
 * BEFORE the code lookup in both previewJoinCode and
 * redeemJoinCodeAndProvisionUser, so a rate-limited IP gets the same
 * generic response whether or not the code it's trying even exists.
 */
export async function checkJoinCodeRateLimit(ipAddress: string): Promise<RateLimitCheck> {
  const cutoff = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000)
  const [{ count }] = await db.select({ count: sql<number>`count(*)` })
    .from(orgJoinCodeAttempts)
    .where(and(
      eq(orgJoinCodeAttempts.ipAddress, ipAddress),
      eq(orgJoinCodeAttempts.wasSuccessful, false),
      gte(orgJoinCodeAttempts.createdAt, cutoff)
    ))

  if (Number(count) >= RATE_LIMIT_MAX_FAILURES) {
    return { limited: true, retryAfterSeconds: RATE_LIMIT_WINDOW_MINUTES * 60 }
  }
  return { limited: false }
}

async function recordAttempt(ipAddress: string, orgId: string | null, wasSuccessful: boolean): Promise<void> {
  // Fire-and-forget, matches api-key-auth.ts's request-log insert
  // convention -- never blocks the caller's response on this write.
  db.insert(orgJoinCodeAttempts).values({ ipAddress, orgId, wasSuccessful }).then(() => {})
}

export type JoinCodePreview =
  | { valid: true; orgName: string; role: InviteRole }
  | { valid: false; reason: "not_found" | JoinCodeStatus | "rate_limited" }

/**
 * Public preview -- called by the signup form as the user finishes typing a
 * code, before any Supabase Auth identity exists. Rate-limit-checked first:
 * a blocked IP gets `rate_limited` without a DB lookup ever running against
 * real code data.
 */
export async function previewJoinCode(rawInput: string, ipAddress: string): Promise<JoinCodePreview> {
  const rateLimit = await checkJoinCodeRateLimit(ipAddress)
  if (rateLimit.limited) return { valid: false, reason: "rate_limited" }

  const code = normalizeJoinCode(rawInput)
  if (code.length !== CODE_LENGTH) {
    await recordAttempt(ipAddress, null, false)
    return { valid: false, reason: "not_found" }
  }
  const codeHash = await hashSHA256(code)
  const row = await db.query.orgJoinCodes.findFirst({ where: eq(orgJoinCodes.codeHash, codeHash) })
  if (!row) {
    await recordAttempt(ipAddress, null, false)
    return { valid: false, reason: "not_found" }
  }

  const status = evaluateJoinCodeStatus(row, new Date())
  if (status !== "valid") {
    await recordAttempt(ipAddress, row.orgId, false)
    return { valid: false, reason: status }
  }

  await recordAttempt(ipAddress, row.orgId, true)
  const org = await db.query.organisations.findFirst({ where: eq(organisations.id, row.orgId), columns: { name: true } })
  return { valid: true, orgName: org?.name ?? "this organisation", role: row.role as InviteRole }
}

export type RedeemJoinCodeResult =
  | { ok: true; user: typeof users.$inferSelect }
  | { ok: false; reason: string }

/**
 * Redeems a join code and provisions the compliance.users row for the
 * invitee -- mirrors consumeInviteLinkAndProvisionUser's shape closely
 * (same seat-check-before-write ordering, same "no separate accept step,
 * isActive:true immediately" reasoning), with two real differences: no
 * atomic use-count race to guard (codes are reusable, not budgeted, so
 * there is no maxUses to race against), and a rate-limit check up front
 * since this is the one redemption path an attacker can attempt without
 * ever holding a valid credential of any kind.
 */
export async function redeemJoinCodeAndProvisionUser(
  rawInput: string,
  ipAddress: string,
  authUser: { id: string; email: string; fullName: string }
): Promise<RedeemJoinCodeResult> {
  const rateLimit = await checkJoinCodeRateLimit(ipAddress)
  if (rateLimit.limited) return { ok: false, reason: "Too many attempts. Please try again later." }

  const code = normalizeJoinCode(rawInput)
  if (code.length !== CODE_LENGTH) {
    await recordAttempt(ipAddress, null, false)
    return { ok: false, reason: "This join code is invalid." }
  }
  const codeHash = await hashSHA256(code)
  const row = await db.query.orgJoinCodes.findFirst({ where: eq(orgJoinCodes.codeHash, codeHash) })
  if (!row) {
    await recordAttempt(ipAddress, null, false)
    return { ok: false, reason: "This join code is invalid." }
  }

  const status = evaluateJoinCodeStatus(row, new Date())
  if (status !== "valid") {
    await recordAttempt(ipAddress, row.orgId, false)
    return { ok: false, reason: `This join code has ${status}.` }
  }

  const seatCheck = await canAssignSeat(row.orgId)
  if (!seatCheck.allowed) {
    await recordAttempt(ipAddress, row.orgId, false)
    return { ok: false, reason: seatCheck.reason }
  }

  if (!isInviteRole(row.role)) {
    // Defensive only -- createJoinCode only ever writes an INVITE_ROLES
    // value, this guards against a hand-edited DB row with a stale role.
    await recordAttempt(ipAddress, row.orgId, false)
    return { ok: false, reason: "This join code has an invalid role and cannot be redeemed." }
  }

  await recordAttempt(ipAddress, row.orgId, true)
  // Informational counter only -- fire-and-forget, nothing gates on it.
  db.update(orgJoinCodes).set({ redeemCount: sql`${orgJoinCodes.redeemCount} + 1`, updatedAt: new Date() })
    .where(eq(orgJoinCodes.id, row.id)).then(() => {})

  const [newUser] = await db.insert(users).values({
    name: authUser.fullName,
    email: authUser.email,
    passwordHash: "supabase-auth-managed", // legacy NOT NULL column, matches autoProvisionUser's normal-signup convention exactly
    role: row.role,
    orgId: row.orgId,
    authUserId: authUser.id,
    isActive: true, // seat check already gated this -- no separate accept step left after this point
  }).returning()

  // Wave 2 parity: every user gets 5 numbered AI Assistants, same as
  // direct-add, the invite link, and normal signup.
  await db.insert(aiAssistants).values(
    Array.from({ length: 5 }, (_, i) => ({
      userId: newUser.id,
      assistantNumber: i + 1,
      label: `Assistant ${i + 1}`,
    }))
  )

  return { ok: true, user: newUser }
}
