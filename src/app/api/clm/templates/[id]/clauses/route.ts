import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { addClauseToTemplate, ServiceError } from "@/lib/services/erp-contract-service"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()
    const row = await addClauseToTemplate({ orgId }, id, body.clauseId, body.isOptional)
    return NextResponse.json(row, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Add clause to template error:", error)
    return NextResponse.json({ error: "Failed to add clause to template" }, { status: 500 })
  }
}
