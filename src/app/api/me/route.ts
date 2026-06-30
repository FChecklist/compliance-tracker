import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { db, organisations } from "@/lib/db"
import { eq } from "drizzle-orm"

export async function GET() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response

  const org = orgId
    ? await db.query.organisations.findFirst({ where: eq(organisations.id, orgId) })
    : null

  return NextResponse.json({
    id: dbUser?.id ?? null,
    name: dbUser?.name ?? null,
    email: dbUser?.email ?? null,
    role: dbUser?.role ?? null,
    orgId: orgId ?? null,
    orgName: org?.name ?? null,
    orgSlug: org?.slug ?? null,
    orgEntityType: org?.entityType ?? null,
  })
}
