import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listVendorRiskProfiles, createVendorRiskProfile, ServiceError } from "@/lib/services/risk-register-service"

// Priority 15: logic extracted verbatim into risk-register-service.ts so
// PROJEXA's /api/v1/projexa/vendor-risk alias can call the exact same
// implementation instead of duplicating it.
export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ vendors: [] })
  const vendors = await listVendorRiskProfiles({ orgId })
  return NextResponse.json({ vendors })
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const vendor = await createVendorRiskProfile({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json({ id: vendor.id }, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Vendor risk profile create error:", error)
    return NextResponse.json({ error: "Failed to create vendor risk profile" }, { status: 500 })
  }
}
