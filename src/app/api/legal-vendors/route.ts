import { legalVendors } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { asc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ vendors: [] })
  const rows = await withTenantContext({ orgId }, (db) => db.query.legalVendors.findMany({ orderBy: asc(legalVendors.name) }))
  return NextResponse.json({ vendors: rows.map((v) => ({ id: v.id, name: v.name, vendorType: v.vendorType, engagementType: v.engagementType, currentMatter: v.currentMatter, status: v.status, fee: v.fee })) })
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
    const [vendor] = await db.insert(legalVendors).values({
      name: body.name.trim(), vendorType: body.vendorType || null, engagementType: body.engagementType || null,
      currentMatter: body.currentMatter || null, fee: body.fee != null ? String(body.fee) : null, orgId,
    }).returning()
    await logActivity({ tx: db, action: "create", entityType: "LegalVendor", entityId: vendor.id, details: `Legal vendor engaged: ${vendor.name}`, orgId, dbUser, request })
    return vendor
  })
  return NextResponse.json({ id: result.id }, { status: 201 })
}
