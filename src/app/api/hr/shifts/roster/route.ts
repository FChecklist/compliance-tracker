import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listRosterAssignments, createRosterAssignment, ServiceError } from "@/lib/services/hr-shift-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ assignments: [] })

  try {
    const userId = request.nextUrl.searchParams.get("userId") || undefined
    const assignments = await listRosterAssignments({ orgId }, { userId })
    return NextResponse.json({ assignments })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Roster assignments list error:", error)
    return NextResponse.json({ error: "Failed to fetch roster assignments" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await createRosterAssignment({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Roster assignment create error:", error)
    return NextResponse.json({ error: "Failed to create roster assignment" }, { status: 500 })
  }
}
