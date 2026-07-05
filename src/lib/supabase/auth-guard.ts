import { NextResponse } from "next/server"
import { createClient } from "./server"
import { db, users, organisations, departments, aiAssistants } from "@/lib/db"
import { eq } from "drizzle-orm"
import type { User } from "@supabase/supabase-js"
import { validateApiKey } from "./api-key-auth"

export type AuthContext = {
  user: Awaited<ReturnType<Awaited<ReturnType<typeof createClient>>['auth']['getUser']>>['data']['user']
  dbUser: typeof users.$inferSelect | null
  orgId: string | null
  response: NextResponse | null
}

// The DB enum (schema.ts userRoleEnum) has 10 values: the original 4 plus 6
// Wave 1 hierarchy roles. This type/ROLE_RANK previously only recognized the
// original 4 -- any user with one of the 6 newer roles (including
// veridian_admin, meant to be the MOST privileged) got `ROLE_RANK[role] ??
// 0`, i.e. rank 0, and failed every requireRole() check including the
// lowest-bar ones. That's a real, live bug: those 6 roles existed in the DB
// and were assignable, but were functionally locked out of everything.
export type UserRole = 'admin' | 'manager' | 'member' | 'viewer'
  | 'veridian_admin' | 'branch_manager' | 'senior_professional' | 'team_member' | 'client_viewer' | 'external_auditor'

export const ROLE_RANK: Record<UserRole, number> = {
  viewer: 1, client_viewer: 1, external_auditor: 1,
  member: 2, team_member: 2,
  senior_professional: 3, manager: 3,
  branch_manager: 4,
  admin: 5,
  veridian_admin: 6,
}

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

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "org"
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

  const meta = authUser.user_metadata as { full_name?: string; organisation?: string } | null
  const fullName = meta?.full_name?.trim() || email.split("@")[0]
  const orgName = meta?.organisation?.trim() || `${fullName}'s Organisation`

  try {
    const baseSlug = slugify(orgName)
    let slug = baseSlug
    let attempt = 0
    // Find a free slug (organisations.slug is unique).
    while (await db.query.organisations.findFirst({ where: eq(organisations.slug, slug) })) {
      attempt += 1
      slug = `${baseSlug}-${attempt}`
      if (attempt > 20) break // pathological collision case, give up gracefully
    }

    const [org] = await db.insert(organisations).values({
      name: orgName,
      slug,
      plan: "free",
    }).returning()

    const [dept] = await db.insert(departments).values({
      name: "General",
      orgId: org.id,
    }).returning()

    const [newUser] = await db.insert(users).values({
      name: fullName,
      email,
      passwordHash: "supabase-auth-managed", // legacy NOT NULL column, real auth is via Supabase
      role: "admin",
      orgId: org.id,
      departmentId: dept.id,
      authUserId: authUser.id,
      onboardingCompleted: false,
    }).returning()

    // Wave 2: every user gets 5 numbered AI Assistants (User-tier, strictly
    // per-user via RLS on current_user_id()). Matches the backfill migration
    // applied to pre-existing users -- see orchestra_changes.md Wave 2.
    await db.insert(aiAssistants).values(
      Array.from({ length: 5 }, (_, i) => ({
        userId: newUser.id,
        assistantNumber: i + 1,
        label: `Assistant ${i + 1}`,
      }))
    )

    return newUser
  } catch (err) {
    // Likely a duplicate-email race with a concurrent request -- re-read
    // whatever the other request created rather than erroring out.
    console.warn("Auto-provision race or failure, re-checking for existing user:", err)
    return await db.query.users.findFirst({ where: eq(users.email, email) }) ?? null
  }
}

export async function requireAuth(): Promise<AuthContext> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { user: null, dbUser: null, orgId: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  let dbUser = await db.query.users.findFirst({ where: eq(users.email, user.email!) }) ?? null

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
  if (dbUser && !dbUser.isActive) {
    return { user, dbUser: null, orgId: null, response: NextResponse.json({ error: "This account has been deactivated" }, { status: 401 }) }
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
