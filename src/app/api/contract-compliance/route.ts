import { contractComplianceItems } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { asc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ items: [] })
  const rows = await withTenantContext({ orgId }, (db) => db.query.contractComplianceItems.findMany({ orderBy: asc(contractComplianceItems.vendorName) }))
  return NextResponse.json({ items: rows.map((i) => ({ id: i.id, vendorName: i.vendorName, clauseDescription: i.clauseDescription, renewalDate: i.renewalDate?.toISOString() ?? null })) })
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const body = await request.json()
  if (!body.vendorName?.trim()) return NextResponse.json({ error: "vendorName is required" }, { status: 400 })

  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    const [item] = await db.insert(contractComplianceItems).values({ vendorName: body.vendorName.trim(), clauseDescription: body.clauseDescription || null, renewalDate: body.renewalDate ? new Date(body.renewalDate) : null, orgId }).returning()
    await logActivity({ tx: db, action: "create", entityType: "ContractComplianceItem", entityId: item.id, details: `Contract clause tracked: ${item.vendorName}`, orgId, dbUser, request })
    return item
  })
  return NextResponse.json({ id: result.id }, { status: 201 })
}
