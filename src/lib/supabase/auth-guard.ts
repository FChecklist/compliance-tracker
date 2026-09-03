import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { createClient } from "./server"
import { db, users, organisations, accessReviewCertifications } from "@/lib/db"
import { eq, and, or } from "drizzle-orm"
import type { User } from "@supabase/supabase-js"
import { validateApiKey } from "./api-key-auth"
import { lookupUserByEmail } from "@/lib/db/preauth-lookups"
import { assignSeat } from "@/lib/org-license-service"
import { consumeInviteLinkAndProvisionUser } from "@/lib/invite-link-service"
import { redeemJoinCodeAndProvisionUser } from "@/lib/org-join-code-service"
import { provisionAiAssistantsForUser } from "@/lib/services/subscription-plan-service"
import { recordSessionAndCheckLimit } from "@/lib/services/session-limit-service"
import { provisionOrganisation } from "@/lib/services/org-provisioning-service"

export type AuthContext = {
  user: Awaited<ReturnType<Awaited<ReturnType<typeof createClient>>['auth']['getUser']>>['data']['user']
  dbUser: typeof users.$inferSelect | null
  orgId: string | null
  response: NextResponse | null
}

// R68 Phase 6: `UserRole` and `ROLE_RANK` themselves now live in
// ./role-rank.ts -- a leaf module with no imports at all -- and are
// re-exported here unchanged, so every existing `import { ROLE_RANK, type
// UserRole } from "@/lib/supabase/auth-guard"` in the codebase keeps working
// exactly as before. The move is not cosmetic: this file transitively pulls
// in next/server, next/headers, the drizzle schema and eight service
// modules, and a caller that needs nothing but a rank comparison should not
// have to load any of it. See role-rank.ts's own header for the case that
// forced it.
// Imported (not only re-exported) because `export ... from` creates no local
// binding, and hasRole() below reads ROLE_RANK directly.
import { ROLE_RANK, type UserRole } from "./role-rank"
export { ROLE_RANK }
export type { UserRole }

export function hasRole(dbUser: typeof users.$inferSelect | null, minimumRole: UserRole): boolean {
  if (!dbUser) return false
  const userRank = ROLE_RANK[dbUser.role as UserRole] ?? 0
  const requiredRank = ROLE_RANK[minimumRole]
  return userRank >= requiredRank
}

export function requireRole(dbUser: typeof users.$inferSelect | null, minimumRole: UserRole): NextResponse | null {
  if (!hasRole(dbUser, minimumRole)) {
    return NextResponse.json(
      { error: `This action requires ${minimumRole} role or higher` },
      { status: 403 }
    )
  }
  return null
}

/**
 * Auto-provisions a brand-new tenant (organisation + admin user + a default
 * department) for a Supabase Auth identity that has no compliance.users row
 * yet. Before this existed, signup only ever created the Auth identity --
 * auth.signUp() never created anything in compliance.*, so every new signup
 * hit a permanent "contact your administrator" wall (dashboard checks
 * orgId and shows Account Setup Incomplete otherwise). This is what makes
 * a fresh signup actually usable.
 *
 * Uses the raw (RLS-bypassing) db client deliberately -- creating a brand
 * new tenant is inherently a platform-level operation that can't be scoped
 * to an org that doesn't exist yet. Concurrency-safe: if two requests race
 * to provision the same email, the loser's insert hits the email UNIQUE
 * constraint and falls back to re-reading the row the winner created.
 */
async function autoProvisionUser(authUser: User): Promise<typeof users.$inferSelect | null> {
  const email = authUser.email
  if (!email) return null

  const meta = authUser.user_metadata as { full_name?: string; organisation?: string; ref?: string; vid?: string; vref?: string; inviteToken?: string; orgJoinCode?: string; stage0Token?: string } | null
  const fullName = meta?.full_name?.trim() || email.split("@")[0]
  const orgName = meta?.organisation?.trim() || `${fullName}'s Organisation`

  // Priority 18b (Owner directive 2026-07-15, Option B): checked FIRST,
  // before inviteToken/orgJoinCode -- a stage-0 signup is even more "not a
  // full org member" than either of those. Mirrors their exact
  // early-return-either-way posture: a bad/expired/revoked stage0Token must
  // never silently fall through to "create me a brand-new org." See
  // stage0-service.ts for the real provisioning logic (self-serve, zero
  // admin approval, off an existing guest-access/share-link token).
  const stage0Token = meta?.stage0Token?.trim()
  if (stage0Token) {
    try {
      const { consumeStage0TokenAndProvisionUser } = await import("@/lib/services/stage0-service")
      const result = await consumeStage0TokenAndProvisionUser(stage0Token, { id: authUser.id, email, fullName })
      if (result.ok) return result.user
      console.warn(`Stage-0 token redemption failed for ${email}: ${result.reason}`)
      return null
    } catch (err) {
      console.error("Stage-0 token redemption threw unexpectedly:", err)
      return null
    }
  }

  // Area 15/18 (Secure Invite Link): a signup that carried ?invite=<token>
  // (threaded into signUp()'s options.data by /signup, see
  // invite-link-service.ts) joins the invite's EXISTING org/role instead of
  // the brand-new-org path below -- this branch returns early either way,
  // it never falls through into org creation.
  const inviteToken = meta?.inviteToken?.trim()
  if (inviteToken) {
    try {
      const result = await consumeInviteLinkAndProvisionUser(inviteToken, { id: authUser.id, email, fullName })
      if (result.ok) return result.user
      // Deliberately does NOT fall through to the normal new-org
      // autoprovision below -- a broken/expired/exhausted/seat-full link
      // should never silently land the invitee as the admin of a brand-new
      // empty org instead of the team they thought they were joining. They
      // see "no organisation on this account" (requireAuth's existing
      // dbUser=null/orgId=null behavior) until an admin issues a fresh link
      // or adds them directly -- a real, honest stopping point for this
      // first slice of the mechanism, documented in the PR description.
      console.warn(`Invite link redemption failed for ${email}: ${result.reason}`)
      return null
    } catch (err) {
      console.error("Invite link redemption threw unexpectedly:", err)
      return null
    }
  }

  // Area 15 (self-registration via admin code, Path C): a signup that
  // carried a manually-typed join code (threaded into signUp()'s
  // options.data by /signup -- the user types this in, unlike inviteToken
  // above which arrives via a clicked ?invite= URL param) joins the code's
  // EXISTING org/role, same early-return-either-way posture as the invite
  // link branch above (never silently falls through to brand-new-org
  // creation on a bad/expired/revoked/seat-full code).
  const orgJoinCode = meta?.orgJoinCode?.trim()
  if (orgJoinCode) {
    try {
      const { headers } = await import("next/headers")
      const h = await headers()
      const ipAddress = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown"
      const result = await redeemJoinCodeAndProvisionUser(orgJoinCode, ipAddress, { id: authUser.id, email, fullName })
      if (result.ok) return result.user
      console.warn(`Join code redemption failed for ${email}: ${result.reason}`)
      return null
    } catch (err) {
      console.error("Join code redemption threw unexpectedly:", err)
      return null
    }
  }

  try {
    // PLATFORM-01 Wave 1: org/branch-enablement/department creation is now
    // shared with the service-to-service provisioning path
    // (POST /api/v1/platform/provision-org) via provisionOrganisation() --
    // same slug-collision loop, same VERI Reward/VERI Chat v2 auto-enable,
    // same default "General" department, same order of operations as
    // before this refactor. This path passes no primaryProductBranchId
    // (undefined -> null), matching every pre-existing human-signup org's
    // real state -- it predates the concept of "primarily belongs to one
    // product branch."
    const { organisationId, defaultDepartmentId } = await provisionOrganisation({ name: orgName })

    const [newUser] = await db.insert(users).values({
      name: fullName,
      email,
      passwordHash: "supabase-auth-managed", // legacy NOT NULL column, real auth is via Supabase
      role: "admin",
      orgId: organisationId,
      departmentId: defaultDepartmentId,
      authUserId: authUser.id,
      onboardingCompleted: false,
    }).returning()

    // Wave 2: every user gets AI Assistants provisioned at the org's real
    // resolved subscription-plan tier (User-tier, strictly per-user via RLS
    // on current_user_id()). Matches the backfill migration applied to
    // pre-existing users -- see orchestra_changes.md Wave 2.
    await provisionAiAssistantsForUser(newUser.id, organisationId)

    // Wave 109 (Sales Engine): if this signup carried a referral code
    // (threaded from /signup's ?ref= param into supabase.auth.signUp's
    // options.data), link it now -- signup and org creation happen in the
    // same request here, so there's no deferred/manual linking step
    // needed. next/headers' headers() is available in this same
    // request-scoped call tree (requireAuth -> autoProvisionUser), the
    // same way createClient() already reads cookies() here -- no need to
    // thread the raw Request through every caller of requireAuth().
    // Never blocks signup on failure.
    const ref = meta?.ref?.trim()
    if (ref) {
      try {
        const { recordReferralSignupAndOrgProvisioned } = await import("@/lib/services/sales-engine-service")
        const { headers } = await import("next/headers")
        const h = await headers()
        await recordReferralSignupAndOrgProvisioned({
          refToken: ref,
          authUserId: authUser.id,
          orgId: organisationId,
          ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null,
          userAgent: h.get("user-agent") ?? null,
        })
      } catch (err) {
        console.warn("Referral linking failed (non-fatal):", err)
      }
    }

    // Wave 113 (Visitor Intelligence): close the anonymous-visit → converted-
    // tenant loop. Same posture as ref above — never blocks signup.
    const vid = meta?.vid?.trim()
    if (vid) {
      try {
        const { recordVisitorConversion } = await import("@/lib/services/visitor-intelligence-service")
        await recordVisitorConversion(vid, organisationId)
      } catch (err) {
        console.warn("Visitor conversion linking failed (non-fatal):", err)
      }
    }

    // Wave 113 (VERI Treasure): refer-and-earn counterpart to ref above --
    // resolves a /vr/[token] click into a veri_reward_referrals row and
    // credits the referrer's points ledger. Points-only (Boss decision
    // 2026-07-08, no cash bridge), so this can run in the same raw-db,
    // best-effort style as ref/vid: never blocks signup on failure.
    const vref = meta?.vref?.trim()
    if (vref) {
      try {
        const { recordReferralSignupCompleted, awardPoints } = await import("@/lib/services/veri-reward-service")
        const { withTenantContext } = await import("@/lib/db/tenant-scoped")
        const referral = await recordReferralSignupCompleted({
          refToken: vref,
          referredUserId: newUser.id,
          referredOrgId: organisationId,
        })
        if (referral?.rewardPoints) {
          await withTenantContext({ orgId: referral.orgId, userId: referral.referrerUserId }, (tdb) =>
            awardPoints(tdb, {
              orgId: referral.orgId,
              userId: referral.referrerUserId,
              delta: referral.rewardPoints!,
              sourceType: "referral",
              sourceId: referral.id,
              reason: `Referral signup: ${orgName}`,
            })
          )
        }
      } catch (err) {
        console.warn("VERI Treasure referral linking failed (non-fatal):", err)
      }
    }

    return newUser
  } catch (err) {
    // Likely a duplicate-email race with a concurrent request -- re-read
    // whatever the other request created rather than erroring out.
    console.warn("Auto-provision race or failure, re-checking for existing user:", err)
    // CRR-027 expand step (see src/lib/db/preauth-lookups.ts): this is the
    // same preauth-by-email shape as requireAuth()'s primary lookup below,
    // so it goes through the same narrow SECURITY DEFINER function.
    return await lookupUserByEmail(email)
  }
}

export async function requireAuth(): Promise<AuthContext> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { user: null, dbUser: null, orgId: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  // CRR-027 expand step (R-CRR-14, see src/lib/db/preauth-lookups.ts's
  // header comment): this is THE preauth lookup -- runs before any tenant
  // context exists, on every authenticated request -- so it now goes
  // through the narrow SECURITY DEFINER compliance.lookup_user_by_email(text)
  // function instead of an unrestricted `select *`. The pre-existing
  // app_runtime_preauth_read_users blanket RLS policy is untouched (still
  // required by 13 other call sites elsewhere in this codebase, see that
  // file's header) -- this change alone does not narrow what app_runtime can
  // read, it only stops relying on the blanket policy at this one call site.
  let dbUser = await lookupUserByEmail(user.email!)

  // Link this Supabase Auth identity to its compliance.users row on first
  // sight, regardless of login method (password/magic-link/OAuth all resolve
  // here). Needed for Wave 1 RLS policies keyed off auth_user_id.
  if (dbUser && dbUser.authUserId !== user.id) {
    await db.update(users).set({ authUserId: user.id }).where(eq(users.id, dbUser.id))
    dbUser.authUserId = user.id
  }

  // Brand new signup with no compliance.users row at all -- provision one.
  if (!dbUser) {
    dbUser = await autoProvisionUser(user)
  }

  // Wave 97 (Comparison CSV 3 gap analysis: IAM010 "Access Review"): before
  // this check, deactivating a user (isActive=false, e.g. via an access
  // review's "revoke" decision) had zero enforcement here -- the Supabase
  // Auth session alone still granted full access. A real revoke has to
  // actually cut off access, not just flip a display flag.
  //
  // Bug fix (2026-07-11, tree4-unified/50-completion-plan PLAN-12 finding):
  // isActive=false is also the value POST /api/users sets on every newly
  // invited user ("becomes active after they accept invite" -- but nothing
  // ever performed that flip). That made this check block EVERY admin-
  // invited user permanently, the moment they completed their invite and
  // logged in for the first time -- the one real invite path in the app was
  // silently broken end-to-end. Fix: an inactive user is only actually
  // blocked if an access-review certification explicitly revoked them
  // (accessReviewCertifications.decision = 'revoked' for this user) --
  // that's the only mechanism in the codebase that's SUPPOSED to set
  // isActive=false for a deliberate reason. Absent that record, isActive=
  // false means "freshly invited, first login in progress" and this is
  // exactly that first login completing -- activate them and let them in,
  // instead of a revoke check that was never designed to gate signup at all.
  if (dbUser && !dbUser.isActive) {
    const revocation = await db.query.accessReviewCertifications.findFirst({
      where: and(eq(accessReviewCertifications.userId, dbUser.id), eq(accessReviewCertifications.decision, "revoked")),
    })
    if (revocation) {
      return { user, dbUser: null, orgId: null, response: NextResponse.json({ error: "This account has been deactivated" }, { status: 401 }) }
    }
    // Wave 172 (area 16, seat enforcement): this is the real seat-consumption
    // moment (invite acceptance, first login) -- routes through
    // org-license-service.ts so the org's licensedSeats cap (opt-in,
    // seatEnforcementEnabled) is actually checked here, not just tracked.
    // Fails closed only for orgs that explicitly turned enforcement on; every
    // other org's dbUser.orgId is falsy-checked or unenforced and this
    // behaves exactly as before (unconditional activation).
    if (dbUser.orgId) {
      const seatResult = await assignSeat(dbUser.orgId, dbUser.id)
      if (!seatResult.ok) {
        return { user, dbUser: null, orgId: null, response: NextResponse.json({ error: seatResult.reason }, { status: 403 }) }
      }
    } else {
      await db.update(users).set({ isActive: true }).where(eq(users.id, dbUser.id))
    }
    dbUser.isActive = true
  }

  // Priority 8 (U-D27.B1.S1, GAP-SESSION-LIMIT): opt-in concurrent-session
  // limit. Only runs the extra query when the org has actually turned this
  // on (organisations.sessionLimitEnforcementEnabled) -- every other org's
  // requireAuth() behavior is completely unchanged. Never blocks an
  // already-established session, only a genuinely new one over the limit --
  // see session-limit-service.ts's own header for the full safety
  // reasoning. Wrapped so any unexpected error here degrades to "allow,"
  // never to "unexpectedly lock the user out" -- matching this codebase's
  // established posture for every other non-critical guardrail lookup.
  if (dbUser?.orgId) {
    try {
      const org = await db.query.organisations.findFirst({
        where: eq(organisations.id, dbUser.orgId),
        columns: { sessionLimitEnforcementEnabled: true, maxConcurrentSessions: true, internalUseExempt: true },
      })
      if (org?.sessionLimitEnforcementEnabled) {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.access_token) {
          const userAgent = (await headers()).get("user-agent")
          const check = await recordSessionAndCheckLimit({
            userId: dbUser.id,
            orgId: dbUser.orgId,
            accessToken: session.access_token,
            userAgent,
            enforcementEnabled: org.sessionLimitEnforcementEnabled,
            internalUseExempt: org.internalUseExempt,
            maxConcurrentSessions: org.maxConcurrentSessions,
          })
          if (!check.allowed) {
            return {
              user, dbUser: null, orgId: null,
              response: NextResponse.json(
                { error: `This account is already signed in on ${check.activeSessionCount} device(s), the maximum allowed (${check.maxConcurrentSessions}). Sign out of another device to continue here.` },
                { status: 403 }
              ),
            }
          }
        }
      }
    } catch (err) {
      console.error("Session-limit check failed, allowing request through (fail-open):", err)
    }
  }

  return { user, dbUser, orgId: dbUser?.orgId ?? null, response: null }
}

// ─── Wave 9: unified external credential ────────────────────────────────
// A route that should be reachable by both the web app (session cookie)
// AND an external caller (mobile app / ChatGPT / Claude connector / a
// reseller's white-labeled app) calls this instead of requireAuth() alone.
// Session wins if both are somehow present. Exactly one of dbUser/apiKey is
// non-null on success -- callers needing to know "was this a real logged-in
// person" branch on `dbUser` being non-null, and pass whichever is present
// into logActivity()'s discriminated dbUser/apiKey params.
export type CombinedAuthContext = {
  orgId: string | null
  dbUser: typeof users.$inferSelect | null
  apiKey: { id: string; name: string; scopes: string[] } | null
  response: NextResponse | null
}

export async function requireAuthOrApiKey(request: Request): Promise<CombinedAuthContext> {
  // R36/P6 (E-122, floor_plans perf bug): requireAuth() used to run
  // unconditionally FIRST, even for a pure server-to-server Bearer-API-key
  // request with no session cookie at all (exactly how PROJEXA's server
  // authenticates) -- that's a real supabase.auth.getUser() network round
  // trip wasted on every single API-key-authenticated request, and was
  // measured taking 5.2 minutes end-to-end under load on /api/floor-plans
  // (R33) and reproduced in prod at 24.49s/19.48s (R35). Skip straight to
  // the API-key path when the request plainly has no session mechanism in
  // play (no sb-*-auth-token cookie) and does carry a Bearer key -- this is
  // the ONLY case being fast-pathed, so a real browser session (which never
  // sends this cookie-less + Bearer-vk_ combination) is completely
  // unaffected and still goes through requireAuth() exactly as before. If a
  // request somehow carries BOTH a session cookie and a Bearer key, we fall
  // through to the original session-first order below so "session wins"
  // (this function's own contract, see the type's doc comment) is
  // unchanged for that edge case.
  const cookieHeader = request.headers.get("cookie") ?? ""
  const authHeader = request.headers.get("authorization") ?? ""
  const hasSessionCookie = cookieHeader.includes("-auth-token=")
  const hasBearerApiKey = authHeader.startsWith("Bearer ")
  if (!hasSessionCookie && hasBearerApiKey) {
    const fastApiKeyResult = await validateApiKey(request)
    if (fastApiKeyResult.status === "ok") {
      const { context } = fastApiKeyResult
      return {
        orgId: context.orgId,
        dbUser: null,
        apiKey: { id: context.keyId, name: context.keyName, scopes: context.scopes },
        response: null,
      }
    }
    // Falls through to the normal path below (requireAuth() then, if that
    // also fails, the rate-limited/invalid handling on apiKeyResult further
    // down) -- an invalid/expired key with no cookie still gets exactly the
    // same error responses as before, just via the original code path.
  }

  const sessionCtx = await requireAuth()
  if (!sessionCtx.response) {
    return { orgId: sessionCtx.orgId, dbUser: sessionCtx.dbUser, apiKey: null, response: null }
  }

  const apiKeyResult = await validateApiKey(request)
  if (apiKeyResult.status === "ok") {
    const { context } = apiKeyResult
    return {
      orgId: context.orgId,
      dbUser: null,
      apiKey: { id: context.keyId, name: context.keyName, scopes: context.scopes },
      response: null,
    }
  }
  if (apiKeyResult.status === "rate_limited") {
    return {
      orgId: null,
      dbUser: null,
      apiKey: null,
      response: NextResponse.json(
        { error: "Rate limit exceeded for this API key" },
        { status: 429, headers: { "Retry-After": String(apiKeyResult.retryAfterSeconds) } }
      ),
    }
  }

  return {
    orgId: null,
    dbUser: null,
    apiKey: null,
    response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  }
}

// R39/R-C12 fix-2 (live-oracle finding): PROJEXA never forwards a per-user
// VERIDIAN identity on server-to-server calls -- every request authenticates
// with a single shared per-org API key (see PROJEXA's own auth-guard.ts
// OrgRole comment: "PROJEXA's server routes call VERIDIAN with a single
// shared per-org API key... not a per-user VERIDIAN identity"). Confirmed
// live: calling the new v1/projexa/timesheets/[id]/{submit,approve,reject}
// routes through the real deployed PROJEXA proxy always 400'd with "This
// action requires a real user session, not an API key" -- ctx.dbUser is
// always null for an API-key caller, so those routes were dead-on-arrival
// end-to-end despite passing typecheck/unit tests.
//
// Actions that MUST know a specific real acting user (timesheet self-
// approval-block, approvedById) cannot use ctx.dbUser for an API-key caller,
// and must NOT fall back to ctx.apiKey.id either -- that's the E-class
// FK-mismatch bug (api_keys.id stored where a real compliance.users.id FK is
// expected) fixed independently 3 times elsewhere this run. Instead, a
// trusted API-key caller may pass `actorEmail` in the request body; this
// resolves it to a real, org-scoped, active compliance.users row -- an
// actual person, verifiable and auditable, never a fabricated identity. A
// session caller's ctx.dbUser is always preferred and actorEmail is ignored
// for them, so this changes nothing for a direct/session-authenticated call.
//
// R67 WS-H / PROGRAMME DECISION D-05 (identity bridge for time logs and
// approvals). The actorEmail path above is a body field, so it only ever
// worked for a POST/PATCH with a JSON body -- a GET (PROJEXA's "my
// timesheet" list) had no way to say who was asking at all. D-05 adds a
// transport-level acting-user id: PROJEXA's server routes send the logged-in
// PROJEXA user's Supabase id as the `X-Acting-User` header on every call
// that needs attribution, and this function maps it to a real, org-scoped,
// active compliance.users row -- matching users.auth_user_id (the column
// that already links a compliance user to a Supabase auth identity) or, for
// a caller that already holds a VERIDIAN user id, users.id.
//
// PRECEDENCE, and the one deliberate deviation from the item's wording,
// stated plainly rather than buried: the header is PREFERRED, and an
// unmapped header id with no usable actorEmail is rejected with
// USER_NOT_LINKED, which is the behaviour item H-03's acceptance names. But
// when the same request ALSO carries an actorEmail that resolves to a real,
// active, org-scoped user, that fallback still wins over a hard failure.
// Reason: nothing in either product populates users.auth_user_id with a
// PROJEXA Supabase id yet, so a header-only-or-nothing rule would take the
// timesheet POST that correction C-08 measured returning 201 on the demo org
// and break it for every account on day one. Both paths resolve an actual
// named person (never the API key), which is what D-05 exists to guarantee;
// the header is simply the stronger of the two bindings. Linking an account
// (setting auth_user_id) upgrades it to the id path with no code change.
export const ACTING_USER_HEADER = "x-acting-user"

/**
 * The acting user's EMAIL, carried the same way the id is.
 *
 * R67 WS-H fix pass: the first cut of this bridge let PROJEXA put the acting
 * user's email in the query string (`?actorEmail=`) so that a GET could
 * identify its caller. That contradicted the reason the id is a header in the
 * first place -- a query string is written to access logs and leaks through
 * the Referer header -- and an email address is MORE identifying than an
 * opaque Supabase id, not less. The email now travels beside the id, in a
 * header, on every method including GET; `actorEmail` in a JSON body is still
 * read for the existing server-to-server callers that send it that way.
 */
export const ACTING_USER_EMAIL_HEADER = "x-acting-user-email"

/** D-05: the acting-user id PROJEXA sends on a write, or null when absent/blank. */
export function readActingUserId(request: { headers: Headers }): string | null {
  const raw = request.headers.get(ACTING_USER_HEADER)
  const trimmed = raw?.trim()
  return trimmed ? trimmed : null
}

/** D-05: the acting user's email as a header, or null when absent/blank. */
export function readActingUserEmail(request: { headers: Headers }): string | null {
  const raw = request.headers.get(ACTING_USER_EMAIL_HEADER)
  const trimmed = raw?.trim()
  return trimmed ? trimmed : null
}

/** The single sentence a caller whose acting-user id maps to nothing is shown. */
export const USER_NOT_LINKED_MESSAGE = "Your PROJEXA account is not linked to a VERIDIAN user - ask your admin"

export async function resolveActingUser(
  ctx: CombinedAuthContext,
  actorEmail?: string | null,
  actorId?: string | null
): Promise<{ user: typeof users.$inferSelect | null; error: NextResponse | null }> {
  if (ctx.dbUser) return { user: ctx.dbUser, error: null }
  if (!ctx.apiKey) return { user: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }

  if (actorId) {
    const linked = ctx.orgId
      ? (await db.query.users.findFirst({
          where: and(
            eq(users.orgId, ctx.orgId),
            or(eq(users.authUserId, actorId), eq(users.id, actorId))
          ),
        })) ?? null
      : null
    if (linked && linked.isActive) return { user: linked, error: null }
    if (linked && !linked.isActive) {
      return {
        user: null,
        error: NextResponse.json(
          { error: "The VERIDIAN user linked to this PROJEXA account is deactivated - ask your admin", code: "USER_DEACTIVATED" },
          { status: 400 }
        ),
      }
    }
    // Unmapped id: fall through to actorEmail only if one was actually sent
    // (see the precedence note above); otherwise this is D-05's own refusal.
    if (!actorEmail) {
      return {
        user: null,
        error: NextResponse.json({ error: USER_NOT_LINKED_MESSAGE, code: "USER_NOT_LINKED" }, { status: 400 }),
      }
    }
  }

  if (!actorEmail) {
    return {
      user: null,
      error: NextResponse.json({ error: "actorEmail is required in the request body when this action is called with an API key" }, { status: 400 }),
    }
  }
  const actingUser = ctx.orgId
    ? (await db.query.users.findFirst({ where: and(eq(users.email, actorEmail), eq(users.orgId, ctx.orgId)) })) ?? null
    : null
  if (!actingUser) {
    // D-05: when the caller ALSO sent an acting-user id, neither binding
    // resolved, so the user reads the linkage sentence rather than an
    // internal-sounding "actorEmail" field name they never typed.
    if (actorId) {
      return { user: null, error: NextResponse.json({ error: USER_NOT_LINKED_MESSAGE, code: "USER_NOT_LINKED" }, { status: 400 }) }
    }
    return { user: null, error: NextResponse.json({ error: `No user found for actorEmail "${actorEmail}" in this organisation`, code: "USER_NOT_LINKED" }, { status: 400 }) }
  }
  if (!actingUser.isActive) {
    return { user: null, error: NextResponse.json({ error: `actorEmail "${actorEmail}" resolves to a deactivated user` }, { status: 400 }) }
  }
  return { user: actingUser, error: null }
}

// E-52 (R60/R62 sweep, platform.r43_faults fault_id LIKE 'E52_%'): the
// house pattern this repo's v1 GET handlers kept repeating --
// `if (!ctx.orgId) return NextResponse.json({ <empty shape> })` -- returns
// a fake-success 200 with empty/default data on a broken auth/org context,
// indistinguishable from a real, legitimately-empty tenant. The sibling
// POST/PUT/DELETE in the SAME file almost always already returned a real
// 400 for the identical condition (see e544eebe/#1418, the first 4-route
// fix in this series) -- this is that same fix applied as one shared guard
// instead of 76 hand-copied one-off edits, so the next new route gets it
// for free and a future GET can't silently reintroduce the old shape.
// Structurally typed on `{ orgId }` alone (not AuthContext/
// CombinedAuthContext specifically) so it works at any call site that has
// already resolved a ctx with an orgId field, session or API-key alike.
// See src/lib/supabase/org-guard-sweep.test.ts for the filesystem-walking
// regression test that fails CI if a new silent-empty-200 orgId guard is
// ever added outside this function.
export function requireOrg(
  ctx: { orgId: string | null },
  message: string = "No organisation on this account"
): NextResponse | null {
  if (ctx.orgId) return null
  return NextResponse.json({ error: message }, { status: 400 })
}

// A real logged-in session always has full access -- scopes are an API-key-
// only concept (a session's actual permissions are governed by role/rank
// via hasRole()/requireRole(), a separate axis from read/write scopes).
export function hasScope(ctx: CombinedAuthContext, scope: "read" | "write"): boolean {
  if (ctx.dbUser) return true
  if (ctx.apiKey) return ctx.apiKey.scopes.includes(scope)
  return false
}

// The combined-auth equivalent of requireRole(): a route migrated to
// requireAuthOrApiKey() still needs its original role gate for session
// users (hasScope() alone would let ANY logged-in user through, including
// below the route's real minimum role -- a real regression this fixes,
// not a hypothetical one). API-key callers have no role, only scopes, so
// they're gated on `writeScope` instead.
export function requireRoleOrScope(
  ctx: CombinedAuthContext,
  minimumRole: UserRole,
  writeScope: "read" | "write" = "write"
): NextResponse | null {
  if (ctx.dbUser) return requireRole(ctx.dbUser, minimumRole)
  if (ctx.apiKey) {
    if (!hasScope(ctx, writeScope)) {
      return NextResponse.json({ error: `This action requires a ${writeScope}-scoped API key` }, { status: 403 })
    }
    return null
  }
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
}

// task-20260727-101145 (external-AI-facing reporting API gateway): a
// dedicated read gate for src/app/api/v1/reports/**, separate from
// requireRoleOrScope's single-scope check because this route needs OR
// semantics -- accept EITHER the pre-existing broad "read" scope (so every
// key minted before this task keeps working unchanged) OR the new,
// narrower "read:reports" scope (mintable via POST /api/settings/api-keys
// for a customer who wants to hand an external AI/ChatGPT/z.ai reports-only
// access, without also granting it "read" on every other /v1/* domain).
// A session user always passes, same as every other combined-auth gate.
export function requireReportsReadAccess(ctx: CombinedAuthContext): NextResponse | null {
  if (ctx.dbUser) return null
  if (ctx.apiKey && (ctx.apiKey.scopes.includes("read") || ctx.apiKey.scopes.includes("read:reports"))) return null
  return NextResponse.json({ error: "This action requires a read or read:reports-scoped API key" }, { status: 403 })
}
