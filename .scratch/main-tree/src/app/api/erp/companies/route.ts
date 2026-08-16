import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listCompanies, createCompany, ServiceError } from "@/lib/services/erp-company-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ companies: [] })

  try {
    const companies = await listCompanies({ orgId })
    return NextResponse.json({ companies })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Companies list error:", error)
    return NextResponse.json({ error: "Failed to fetch companies" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const company = await createCompany({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(company, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Company create error:", error)
    return NextResponse.json({ error: "Failed to create company" }, { status: 500 })
  }
}
