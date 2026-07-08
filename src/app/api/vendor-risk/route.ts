import { vendorRiskProfiles } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { asc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ vendors: [] })
  const rows = await withTenantContext({ orgId }, (db) => db.query.vendorRiskProfiles.findMany({ orderBy: asc(vendorRiskProfiles.name) }))
  return NextResponse.json({ vendors: rows.map((v) => ({ id: v.id, name: v.name, riskTier: v.riskTier, riskScore: v.riskScore, riskFactors: v.riskFactors, certifications: v.certifications, lastAssessedDate: v.lastAssessedDate?.toISOString() ?? null })) })
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const body = await request.json()
  if (!body.name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 })

  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    const [vendor] = await db.insert(vendorRiskProfiles).values({ name: body.name.trim(), riskTier: body.riskTier || "medium", orgId }).returning()
    await logActivity({ tx: db, action: "create", entityType: "VendorRiskProfile", entityId: vendor.id, details: `Vendor added for risk assessment: ${vendor.name}`, orgId, dbUser, request })
    return vendor
  })
  return NextResponse.json({ id: result.id }, { status: 201 })
}
