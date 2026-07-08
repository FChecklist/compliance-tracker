// Wave 124: /api/v1/projexa/* is a thin ALIASING namespace -- zero new
// business logic. Calls the exact same erp-buying-service.ts functions the
// generic /api/v1/erp/* surface would, just reshapes field names into
// construction-domain language (vendorName/vendorType/gst instead of
// supplierName/supplierType/gstin) since VERIDIAN's shared erp_suppliers
// table also serves GRC/ERP customers who never see "vendor" terminology.
// The underlying erp_suppliers table itself is NOT renamed (shared with
// other products) -- only this response shape is.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listSuppliers, createSupplier, ServiceError, type SupplierInput } from "@/lib/services/erp-buying-service"

function toVendorShape(s: Awaited<ReturnType<typeof listSuppliers>>[number]) {
  return {
    id: s.id, vendorName: s.supplierName, vendorType: s.supplierType, gst: s.gstin, pan: s.panNumber,
    trade: s.trade, projectId: s.projectId, defaultPaymentTermsDays: s.defaultPaymentTermsDays,
    creditLimit: s.creditLimit, isActive: s.isActive,
  }
}

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ vendors: [] })

  try {
    const suppliers = await listSuppliers({ orgId: ctx.orgId })
    return NextResponse.json({ vendors: suppliers.map(toVendorShape) })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa vendors list error:", error)
    return NextResponse.json({ error: "Failed to fetch vendors" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const input: SupplierInput = {
      supplierName: body.vendorName, supplierType: body.vendorType, gstin: body.gst, panNumber: body.pan,
      defaultPaymentTermsDays: body.defaultPaymentTermsDays, creditLimit: body.creditLimit,
      trade: body.trade, projectId: body.projectId,
    }
    const supplier = await createSupplier({ orgId: ctx.orgId }, input)
    return NextResponse.json(toVendorShape(supplier), { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa vendor create error:", error)
    return NextResponse.json({ error: "Failed to create vendor" }, { status: 500 })
  }
}
