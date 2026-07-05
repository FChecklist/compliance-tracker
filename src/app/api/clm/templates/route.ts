import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listContractTemplates, createContractTemplate, ServiceError } from "@/lib/services/erp-contract-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ templates: [] })

  const templates = await listContractTemplates({ orgId })
  return NextResponse.json({ templates })
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const body = await request.json()
    const template = await createContractTemplate({ orgId, userId: dbUser.id }, body)
    return NextResponse.json(template, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Contract template create error:", error)
    return NextResponse.json({ error: "Failed to create template" }, { status: 500 })
  }
}
