import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { db, users } from "@/lib/db"
import { eq } from "drizzle-orm"

export async function PATCH(request: NextRequest) {
  const { user, dbUser, response } = await requireAuth()
  if (!user || !dbUser) return response!

  const { stage } = await request.json()
  await db.update(users).set({ onboardingStage: stage }).where(eq(users.id, dbUser.id))

  return NextResponse.json({ stage })
}