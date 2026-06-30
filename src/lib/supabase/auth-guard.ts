import { NextResponse } from "next/server"
import { createClient } from "./server"
import { db, users } from "@/lib/db"
import { eq } from "drizzle-orm"

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

export async function requireAuth(): Promise<AuthContext> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { user: null, dbUser: null, orgId: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  const dbUser = await db.query.users.findFirst({ where: eq(users.email, user.email!) }) ?? null
  return { user, dbUser, orgId: dbUser?.orgId ?? null, response: null }
}
