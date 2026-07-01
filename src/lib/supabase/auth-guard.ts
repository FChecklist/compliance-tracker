import { NextResponse } from "next/server"
import { createClient } from "./server"
import { db, users, organisations, departments, aiAssistants } from "@/lib/db"
import { eq } from "drizzle-orm"
import type { User } from "@supabase/supabase-js"

export type AuthContext = {
  user: Awaited<ReturnType<Awaited<ReturnType<typeof createClient>>['auth']['getUser']>>['data']['user']
  dbUser: typeof users.$inferSelect | null
  orgId: string | null
  response: NextResponse | null
}

export type UserRole = 'admin' | 'manager' | 'member' | 'viewer'

const ROLE_RANK: Record<UserRole, number> = { admin: 4, manager: 3, member: 2, viewer: 1 }

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

  return { user, dbUser, orgId: dbUser?.orgId ?? null, response: null }
}
