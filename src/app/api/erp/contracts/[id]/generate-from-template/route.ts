import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { generateContractFromTemplate, ServiceError } from "@/lib/services/erp-contract-service"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()
    if (!body.templateId) return NextResponse.json({ error: "templateId is required" }, { status: 400 })
    const contract = await generateContractFromTemplate({ orgId, userId: dbUser.id, dbUser }, id, body.templateId, body.includeOptionalClauseIds)
    return NextResponse.json(contract)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Generate contract from template error:", error)
    return NextResponse.json({ error: "Failed to generate contract" }, { status: 500 })
  }
}
