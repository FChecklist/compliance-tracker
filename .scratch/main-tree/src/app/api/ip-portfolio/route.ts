import { ipPortfolio } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { asc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ items: [] })
  const rows = await withTenantContext({ orgId }, (db) => db.query.ipPortfolio.findMany({ orderBy: asc(ipPortfolio.mark) }))
  return NextResponse.json({ items: rows.map((i) => ({ id: i.id, mark: i.mark, ipType: i.ipType, status: i.status, renewalDate: i.renewalDate?.toISOString() ?? null, classDescription: i.classDescription })) })
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const body = await request.json()
  if (!body.mark?.trim()) return NextResponse.json({ error: "mark is required" }, { status: 400 })

  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    const [ip] = await db.insert(ipPortfolio).values({
      mark: body.mark.trim(), ipType: body.ipType || null, renewalDate: body.renewalDate ? new Date(body.renewalDate) : null, orgId,
    }).returning()
    await logActivity({ tx: db, action: "create", entityType: "IpPortfolio", entityId: ip.id, details: `IP asset added: ${ip.mark}`, orgId, dbUser, request })
    return ip
  })
  return NextResponse.json({ id: result.id }, { status: 201 })
}
