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

export async function requireAuth(): Promise<AuthContext> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { user: null, dbUser: null, orgId: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  const dbUser = await db.query.users.findFirst({ where: eq(users.email, user.email!) }) ?? null
  return { user, dbUser, orgId: dbUser?.orgId ?? null, response: null }
}
