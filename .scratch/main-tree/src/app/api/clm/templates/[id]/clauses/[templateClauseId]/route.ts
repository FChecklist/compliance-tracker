import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { removeClauseFromTemplate, ServiceError } from "@/lib/services/erp-contract-service"

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; templateClauseId: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id, templateClauseId } = await params
    const result = await removeClauseFromTemplate({ orgId }, id, templateClauseId)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Remove clause from template error:", error)
    return NextResponse.json({ error: "Failed to remove clause from template" }, { status: 500 })
  }
}
