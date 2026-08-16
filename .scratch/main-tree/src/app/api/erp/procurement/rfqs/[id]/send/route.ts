import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { sendRfq, ServiceError } from "@/lib/services/erp-procurement-workflow-service"
import { requirePermissionForUser } from "@/lib/services/permission-service"

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  // member: changes status to sent, no financial impact
  const roleErr = requirePermissionForUser(dbUser, "erp.rfqs.send")
  if (roleErr) return roleErr

  try {
    const { id } = await params
    const rfq = await sendRfq({ orgId, userId: dbUser.id, dbUser }, id)
    return NextResponse.json(rfq)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("RFQ send error:", error)
    return NextResponse.json({ error: "Failed to send RFQ" }, { status: 500 })
  }
}
