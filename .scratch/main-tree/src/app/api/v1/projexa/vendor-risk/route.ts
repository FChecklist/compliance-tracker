// Priority 15 (PROJEXA GRC module): thin ALIASING route over
// risk-register-service.ts's third-party/vendor risk profiles.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listVendorRiskProfiles, createVendorRiskProfile, ServiceError } from "@/lib/services/risk-register-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ vendors: [] })

  try {
    const vendors = await listVendorRiskProfiles({ orgId: ctx.orgId })
    return NextResponse.json({ vendors })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa vendor-risk list error:", error)
    return NextResponse.json({ error: "Failed to fetch vendor risk profiles" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }
    const vendor = await createVendorRiskProfile(actorCtx, { name: body.name, riskTier: body.riskTier })
    return NextResponse.json(vendor, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa vendor-risk create error:", error)
    return NextResponse.json({ error: "Failed to create vendor risk profile" }, { status: 500 })
  }
}
