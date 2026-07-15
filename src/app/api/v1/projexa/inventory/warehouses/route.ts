// Priority 17 Wave 1 (PROJEXA Inventory/Stock exposure): thin alias over
// erp-stock-service.ts's listWarehouses/createWarehouse -- erp_warehouses has
// existed since Wave 49 with a real service layer (Wave 53) but zero
// PROJEXA-reachable route until now. Distinct from PROJEXA's pre-existing
// "Materials" page, which is backed by a separate construction-specific
// materials table, not real warehouse/stock tracking.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listWarehouses, createWarehouse, ServiceError } from "@/lib/services/erp-stock-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ warehouses: [] })

  try {
    const warehouses = await listWarehouses({ orgId: ctx.orgId })
    return NextResponse.json({ warehouses })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa inventory warehouses list error:", error)
    return NextResponse.json({ error: "Failed to fetch warehouses" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

  try {
    const body = await request.json()
    if (!body.warehouseName?.trim()) return NextResponse.json({ error: "warehouseName is required" }, { status: 400 })
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: actorId, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: actorId, apiKey: ctx.apiKey! }
    const warehouse = await createWarehouse(actorCtx, { warehouseName: body.warehouseName, parentWarehouseId: body.parentWarehouseId })
    return NextResponse.json(warehouse, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa inventory warehouse create error:", error)
    return NextResponse.json({ error: "Failed to create warehouse" }, { status: 500 })
  }
}
