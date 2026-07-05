import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { createAccessReviewCycle, listAccessReviewCycles, ServiceError } from "@/lib/services/access-review-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ cycles: [] })

  const cycles = await listAccessReviewCycles({ orgId })
  return NextResponse.json({ cycles })
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "admin")
  if (roleCheck) return roleCheck

  try {
    const body = await request.json()
    const cycle = await createAccessReviewCycle({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(cycle, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Access review cycle create error:", error)
    return NextResponse.json({ error: "Failed to create access review cycle" }, { status: 500 })
  }
}
