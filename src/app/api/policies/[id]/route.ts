import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { updatePolicy, ServiceError } from "@/lib/services/risk-register-service"

type RouteContext = { params: Promise<{ id: string }> }

// Priority 15: logic extracted verbatim into risk-register-service.ts so
// PROJEXA's /api/v1/projexa/policies/[id] alias can call the exact same
// implementation instead of duplicating it.
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "member")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params
    const body = await request.json()
    const { action, note } = body
    if (action !== "edit" && action !== "request_publish") return NextResponse.json({ error: "action must be 'edit' or 'request_publish'" }, { status: 400 })

    const result = await updatePolicy({ orgId, userId: dbUser.id, dbUser }, id, action, note)
    return NextResponse.json({ id: result.id, version: result.version, status: result.status })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Policy PATCH error:", error)
    return NextResponse.json({ error: "Failed to update policy" }, { status: 500 })
  }
}
