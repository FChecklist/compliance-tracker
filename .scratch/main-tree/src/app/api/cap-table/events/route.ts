import { capTableEvents } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { desc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ events: [] })
  const rows = await withTenantContext({ orgId }, (db) => db.query.capTableEvents.findMany({ orderBy: desc(capTableEvents.createdAt) }))
  return NextResponse.json({ events: rows.map((e) => ({ id: e.id, eventType: e.eventType, description: e.description, shares: e.shares, eventDate: e.eventDate?.toISOString() ?? null, status: e.status })) })
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "admin")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const body = await request.json()
  if (!body.eventType?.trim()) return NextResponse.json({ error: "eventType is required" }, { status: 400 })

  const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
    const [event] = await db.insert(capTableEvents).values({
      eventType: body.eventType.trim(), description: body.description || null, shares: body.shares ? Number(body.shares) : null,
      eventDate: body.eventDate ? new Date(body.eventDate) : null, orgId, recordedById: dbUser.id,
    }).returning()
    await logActivity({ tx: db, action: "create", entityType: "CapTableEvent", entityId: event.id, details: `Cap table event: ${event.eventType}`, orgId, dbUser, request })
    return event
  })
  return NextResponse.json({ id: result.id }, { status: 201 })
}
