import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listReviewCycles, createReviewCycle, ServiceError } from "@/lib/services/performance-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ cycles: [] })

  try {
    const cycles = await listReviewCycles({ orgId })
    return NextResponse.json({ cycles })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Review cycles list error:", error)
    return NextResponse.json({ error: "Failed to fetch review cycles" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "admin")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const cycle = await createReviewCycle({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(cycle, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Review cycle create error:", error)
    return NextResponse.json({ error: "Failed to create review cycle" }, { status: 500 })
  }
}
