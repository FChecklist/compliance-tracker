import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listSupplierQuotations, createSupplierQuotation, ServiceError } from "@/lib/services/erp-procurement-workflow-service"
import { requirePermissionForUser } from "@/lib/services/permission-service"

export async function GET(request: Request) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ quotations: [] })

  try {
    const rfqId = new URL(request.url).searchParams.get("rfqId") ?? undefined
    const quotations = await listSupplierQuotations({ orgId }, rfqId)
    return NextResponse.json({ quotations })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Supplier quotations list error:", error)
    return NextResponse.json({ error: "Failed to fetch supplier quotations" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  // member: routine procurement data entry
  const roleErr = requirePermissionForUser(dbUser, "erp.supplier_quotations.create")
  if (roleErr) return roleErr

  try {
    const body = await request.json()
    const quotation = await createSupplierQuotation({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(quotation, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Supplier quotation create error:", error)
    return NextResponse.json({ error: "Failed to create supplier quotation" }, { status: 500 })
  }
}
