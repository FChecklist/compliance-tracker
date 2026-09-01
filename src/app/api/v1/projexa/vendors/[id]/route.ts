// Real-screen conversion (2026-08-30): single-vendor GET/PATCH for the
// Vendor Object Page -- getSupplier() didn't exist before this conversion
// (erp-buying-service.ts). Same toVendorShape mapping as ../route.ts's own
// GET (duplicated locally rather than imported, matching this codebase's
// sales-orders/[id] precedent -- its own comment explains why: list and
// Object Page routes intentionally stay independent files).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { getSupplier, updateSupplier, ServiceError } from "@/lib/services/erp-buying-service"

function toVendorShape(s: Awaited<ReturnType<typeof getSupplier>>) {
  return {
    id: s.id, vendorName: s.supplierName, vendorType: s.supplierType, gst: s.gstin, pan: s.panNumber,
    trade: s.trade, projectId: s.projectId, defaultPaymentTermsDays: s.defaultPaymentTermsDays,
    creditLimit: s.creditLimit, isActive: s.isActive,
    qualificationStatus: s.qualificationStatus, sanctionScreeningStatus: s.sanctionScreeningStatus,
    sanctionScreenedAt: s.sanctionScreenedAt,
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const supplier = await getSupplier({ orgId: ctx.orgId }, id)
    return NextResponse.json(toVendorShape(supplier))
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa vendor get error:", error)
    return NextResponse.json({ error: "Failed to fetch vendor" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const patch = {
      ...(body.vendorName !== undefined ? { supplierName: body.vendorName } : {}),
      ...(body.vendorType !== undefined ? { supplierType: body.vendorType } : {}),
      ...(body.gst !== undefined ? { gstin: body.gst } : {}),
      ...(body.pan !== undefined ? { panNumber: body.pan } : {}),
      ...(body.trade !== undefined ? { trade: body.trade } : {}),
      ...(body.defaultPaymentTermsDays !== undefined ? { defaultPaymentTermsDays: body.defaultPaymentTermsDays } : {}),
      ...(body.creditLimit !== undefined ? { creditLimit: body.creditLimit } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    }
    const supplier = await updateSupplier({ orgId: ctx.orgId }, id, patch)
    return NextResponse.json(toVendorShape(supplier))
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa vendor update error:", error)
    return NextResponse.json({ error: "Failed to update vendor" }, { status: 500 })
  }
}
