import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { db, organisations, users } from "@/lib/db"
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

export async function PATCH(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!dbUser) return NextResponse.json({ error: "User not found" }, { status: 404 })

  try {
    const body = await request.json()
    const { name, phone, orgName, orgAddress, orgCin, orgGstin, orgPan } = body

    // Update user profile
    if (name && typeof name === 'string' && name.trim()) {
      await db.update(users).set({ name: name.trim() }).where(eq(users.id, dbUser.id))
    }

    // Update org details (admin only)
    if (orgId && dbUser.role === 'admin') {
      const orgUpdate: Record<string, unknown> = {}
      if (orgName && typeof orgName === 'string') orgUpdate.name = orgName.trim()
      if (orgAddress && typeof orgAddress === 'string') orgUpdate.address = orgAddress.trim()
      if (orgCin && typeof orgCin === 'string') orgUpdate.cinNumber = orgCin.trim()
      if (orgGstin && typeof orgGstin === 'string') orgUpdate.gstin = orgGstin.trim()
      if (orgPan && typeof orgPan === 'string') orgUpdate.panNumber = orgPan.trim()
      if (Object.keys(orgUpdate).length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await db.update(organisations).set(orgUpdate as any).where(eq(organisations.id, orgId))
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Profile update error:", error)
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 })
  }
}
