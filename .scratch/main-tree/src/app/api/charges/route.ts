import { companyCharges } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { desc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ charges: [] })
  const rows = await withTenantContext({ orgId }, (db) => db.query.companyCharges.findMany({ orderBy: desc(companyCharges.createdAt) }))
  return NextResponse.json({ charges: rows.map((c) => ({ id: c.id, chargeHolder: c.chargeHolder, chargeType: c.chargeType, amount: c.amount, filingReference: c.filingReference, status: c.status })) })
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const body = await request.json()
  if (!body.chargeHolder?.trim()) return NextResponse.json({ error: "chargeHolder is required" }, { status: 400 })

  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    const [charge] = await db.insert(companyCharges).values({
      chargeHolder: body.chargeHolder.trim(), chargeType: body.chargeType || null,
      amount: body.amount != null ? String(body.amount) : null, filingReference: body.filingReference || null, orgId,
    }).returning()
    await logActivity({ tx: db, action: "create", entityType: "CompanyCharge", entityId: charge.id, details: `Charge recorded: ${charge.chargeHolder}`, orgId, dbUser, request })
    return charge
  })
  return NextResponse.json({ id: result.id }, { status: 201 })
}
