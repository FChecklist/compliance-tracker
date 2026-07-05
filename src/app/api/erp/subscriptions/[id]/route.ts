import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { updateSubscriptionStatus, ServiceError } from "@/lib/services/erp-contract-service"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()
    const subscription = await updateSubscriptionStatus({ orgId }, id, body.status)
    return NextResponse.json(subscription)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Subscription status update error:", error)
    return NextResponse.json({ error: "Failed to update subscription status" }, { status: 500 })
  }
}
