import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { linkHiredEmployee, ServiceError } from "@/lib/services/recruitment-service"

type RouteContext = { params: Promise<{ id: string }> }

// Admin-gated: explicitly links an application to an already-created
// employeeProfiles row. Never creates the profile itself -- see
// recruitment-service.ts's linkHiredEmployee for why.
export async function POST(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "admin")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await context.params
    const body = await request.json()
    const updated = await linkHiredEmployee({ orgId, userId: dbUser.id }, id, body.employeeProfileId)
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Hire link error:", error)
    return NextResponse.json({ error: "Failed to link hired employee" }, { status: 500 })
  }
}
