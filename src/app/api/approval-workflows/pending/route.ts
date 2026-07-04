import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listMyPendingApprovals, ServiceError } from "@/lib/services/approval-workflow-service"

export async function GET() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ pending: [] })

  try {
    const pending = await listMyPendingApprovals({ orgId, userId: dbUser.id, dbUser })
    return NextResponse.json({ pending })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Pending approvals list error:", error)
    return NextResponse.json({ error: "Failed to fetch pending approvals" }, { status: 500 })
  }
}
