import { litigationMatters } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { desc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ matters: [] })
  const rows = await withTenantContext({ orgId }, (db) => db.query.litigationMatters.findMany({ orderBy: desc(litigationMatters.createdAt) }))
  return NextResponse.json({
    matters: rows.map((m) => ({ id: m.id, matter: m.matter, matterType: m.matterType, forum: m.forum, stage: m.stage, nextHearingDate: m.nextHearingDate?.toISOString() ?? null, counsel: m.counsel, amount: m.amount, linkedNoticeId: m.linkedNoticeId })),
  })
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const body = await request.json()
  if (!body.matter?.trim()) return NextResponse.json({ error: "matter is required" }, { status: 400 })

  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    const [litigation] = await db.insert(litigationMatters).values({
      matter: body.matter.trim(), matterType: body.matterType || null, forum: body.forum || null,
      counsel: body.counsel || null, amount: body.amount != null ? String(body.amount) : null,
      linkedNoticeId: body.linkedNoticeId || null, orgId,
    }).returning()
    await logActivity({ tx: db, action: "create", entityType: "LitigationMatter", entityId: litigation.id, details: `Litigation matter filed: ${litigation.matter}`, orgId, dbUser, request })
    return litigation
  })
  return NextResponse.json({ id: result.id }, { status: 201 })
}
