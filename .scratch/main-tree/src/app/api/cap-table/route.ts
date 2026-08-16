import { capTableEntries } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { asc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ entries: [] })
  const rows = await withTenantContext({ orgId }, (db) => db.query.capTableEntries.findMany({ orderBy: asc(capTableEntries.holderName) }))
  return NextResponse.json({ entries: rows.map((e) => ({ id: e.id, holderName: e.holderName, shares: e.shares, percent: e.percent, shareClass: e.shareClass })) })
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "admin")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const body = await request.json()
  if (!body.holderName?.trim() || !body.shares) return NextResponse.json({ error: "holderName and shares are required" }, { status: 400 })

  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    const [entry] = await db.insert(capTableEntries).values({ holderName: body.holderName.trim(), shares: Number(body.shares), percent: body.percent != null ? String(body.percent) : null, orgId }).returning()
    await logActivity({ tx: db, action: "create", entityType: "CapTableEntry", entityId: entry.id, details: `Cap table entry added: ${entry.holderName}`, orgId, dbUser, request })
    return entry
  })
  return NextResponse.json({ id: result.id }, { status: 201 })
}
