import { bcmPlans } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { asc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"
import { logger } from "@/lib/logger"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ plans: [] })
  try {
    const rows = await withTenantContext({ orgId }, (db) => db.query.bcmPlans.findMany({ orderBy: asc(bcmPlans.planName) }))
    return NextResponse.json({ plans: rows.map((p) => ({ id: p.id, planName: p.planName, lastTestedDate: p.lastTestedDate?.toISOString() ?? null, status: p.status })) })
  } catch (error) {
    logger.error("Failed to list BCM plans", error, { orgId, route: "/api/bcm" })
    return NextResponse.json({ error: "Failed to load BCM plans" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    if (!body.planName?.trim()) return NextResponse.json({ error: "planName is required" }, { status: 400 })

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const [plan] = await db.insert(bcmPlans).values({ planName: body.planName.trim(), orgId }).returning()
      await logActivity({ tx: db, action: "create", entityType: "BcmPlan", entityId: plan.id, details: `BCM plan added: ${plan.planName}`, orgId, dbUser, request })
      return plan
    })
    return NextResponse.json({ id: result.id }, { status: 201 })
  } catch (error) {
    logger.error("Failed to create BCM plan", error, { orgId, route: "/api/bcm" })
    return NextResponse.json({ error: "Failed to create BCM plan" }, { status: 500 })
  }
}
