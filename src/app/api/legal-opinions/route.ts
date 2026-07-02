import { legalOpinions } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { desc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ opinions: [] })
  const rows = await withTenantContext({ orgId }, (db) => db.query.legalOpinions.findMany({ orderBy: desc(legalOpinions.createdAt) }))
  return NextResponse.json({ opinions: rows.map((o) => ({ id: o.id, topic: o.topic, opinionDate: o.opinionDate?.toISOString() ?? null, advisor: o.advisor })) })
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const body = await request.json()
  if (!body.topic?.trim()) return NextResponse.json({ error: "topic is required" }, { status: 400 })

  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    const [opinion] = await db.insert(legalOpinions).values({ topic: body.topic.trim(), advisor: body.advisor || null, opinionDate: body.opinionDate ? new Date(body.opinionDate) : new Date(), orgId }).returning()
    await logActivity({ tx: db, action: "create", entityType: "LegalOpinion", entityId: opinion.id, details: `Legal opinion recorded: ${opinion.topic}`, orgId, dbUser, request })
    return opinion
  })
  return NextResponse.json({ id: result.id }, { status: 201 })
}
