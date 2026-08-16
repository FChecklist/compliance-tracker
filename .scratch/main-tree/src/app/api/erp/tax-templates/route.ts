import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listTaxTemplates, createTaxTemplate, ServiceError } from "@/lib/services/erp-invoicing-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ templates: [] })

  try {
    const templates = await listTaxTemplates({ orgId })
    return NextResponse.json({ templates })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Tax templates list error:", error)
    return NextResponse.json({ error: "Failed to fetch tax templates" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const template = await createTaxTemplate({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(template, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Tax template create error:", error)
    return NextResponse.json({ error: "Failed to create tax template" }, { status: 500 })
  }
}
