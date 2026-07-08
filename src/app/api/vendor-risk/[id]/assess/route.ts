// Real deterministic vendor risk assessment (VCEL GRC Workflow Engine) --
// replaces the manually-picked riskTier free-text field with a real 0-100
// weighted score. Reuses the existing GSTIN checksum/PAN format validators
// rather than re-implementing them.
import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { vendorRiskProfiles } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { logActivity } from "@/lib/audit"
import { computeVendorRiskScore } from "@/lib/engines/grc-workflow-engine"
import { isValidGstinChecksum, isValidPanFormat } from "@/lib/engines/data-quality-engine"

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const { id } = await ctx.params
  const body = await request.json()

  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    const vendor = await db.query.vendorRiskProfiles.findFirst({ where: and(eq(vendorRiskProfiles.id, id), eq(vendorRiskProfiles.orgId, orgId)) })
    if (!vendor) return null

    const certificationCount = Array.isArray(vendor.certifications) ? vendor.certifications.length : 0
    const hasValidGstin = body.gstin ? isValidGstinChecksum(body.gstin) : null
    const hasValidPan = body.pan ? isValidPanFormat(body.pan) : null
    const monthsSinceLastAssessment = vendor.lastAssessedDate
      ? Math.floor((Date.now() - vendor.lastAssessedDate.getTime()) / (30 * 24 * 60 * 60 * 1000))
      : null

    const assessment = computeVendorRiskScore({
      certificationCount, hasValidGstin, hasValidPan,
      incidentCount: Number(body.incidentCount ?? 0),
      contractValueInr: Number(body.contractValueInr ?? 0),
      monthsSinceLastAssessment,
    })

    const [updated] = await db.update(vendorRiskProfiles).set({
      riskScore: assessment.score, riskFactors: assessment.factors, riskTier: assessment.tier,
      lastAssessedDate: new Date(), updatedAt: new Date(),
    }).where(eq(vendorRiskProfiles.id, id)).returning()

    await logActivity({ tx: db, action: "update", entityType: "VendorRiskProfile", entityId: id, details: `Risk assessed: score ${assessment.score}, tier ${assessment.tier}`, orgId, dbUser, request })
    return { updated, assessment }
  })

  if (!result) return NextResponse.json({ error: "Vendor risk profile not found" }, { status: 404 })
  return NextResponse.json({ vendor: result.updated, assessment: result.assessment })
}
