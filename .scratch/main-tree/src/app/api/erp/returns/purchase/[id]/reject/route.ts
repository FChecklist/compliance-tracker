import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { rejectPurchaseReturn, ServiceError } from "@/lib/services/erp-returns-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await context.params
    const updated = await rejectPurchaseReturn({ orgId, userId: dbUser.id, dbUser }, id)
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Purchase return reject error:", error)
    return NextResponse.json({ error: "Failed to reject purchase return" }, { status: 500 })
  }
}
