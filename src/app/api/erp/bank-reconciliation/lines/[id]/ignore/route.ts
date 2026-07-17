import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { requirePermissionForUser } from "@/lib/services/permission-service"
import { ignoreLine, ServiceError } from "@/lib/services/erp-bank-reconciliation-service"

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  // member: routine reconciliation data entry, marking a line as irrelevant
  const roleErr = requirePermissionForUser(dbUser, "erp.banking.ignore")
  if (roleErr) return roleErr

  try {
    const { id } = await params
    const line = await ignoreLine({ orgId, userId: dbUser.id, dbUser }, id)
    return NextResponse.json(line)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Ignore line error:", error)
    return NextResponse.json({ error: "Failed to ignore line" }, { status: 500 })
  }
}
