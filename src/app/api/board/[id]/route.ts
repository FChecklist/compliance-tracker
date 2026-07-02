import { boardMeetings } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

type RouteContext = { params: Promise<{ id: string }> }

// action='hold' records real minutes for the first time; action='amend'
// appends the current minutes text to minutesHistory before replacing it --
// never overwrites without archiving, same principle as Policy versioning.
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params
    const body = await request.json()
    const { action, minutes, attendees } = body

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const existing = await db.query.boardMeetings.findFirst({ where: eq(boardMeetings.id, id) })
      if (!existing) return null

      if (action === "hold") {
        const [updated] = await db.update(boardMeetings).set({
          status: "held", minutes: minutes || null, attendees: Array.isArray(attendees) ? attendees : [], updatedAt: new Date(),
        }).where(eq(boardMeetings.id, id)).returning()
        await logActivity({ tx: db, action: "status_change", entityType: "BoardMeeting", entityId: id, details: `"${existing.title}" recorded as held`, orgId, dbUser, request })
        return updated
      }

      if (action === "amend") {
        const history = Array.isArray(existing.minutesHistory) ? existing.minutesHistory : []
        const newHistory = existing.minutes
          ? [{ date: new Date().toISOString(), amendedBy: dbUser.name, text: existing.minutes }, ...history]
          : history
        const [updated] = await db.update(boardMeetings).set({
          minutes: minutes || existing.minutes, minutesHistory: newHistory, updatedAt: new Date(),
        }).where(eq(boardMeetings.id, id)).returning()
        await logActivity({ tx: db, action: "update", entityType: "BoardMeeting", entityId: id, details: `Minutes amended for "${existing.title}"`, orgId, dbUser, request })
        return updated
      }

      return existing
    })

    if (!result) return NextResponse.json({ error: "Meeting not found" }, { status: 404 })
    return NextResponse.json({ id: result.id, status: result.status })
  } catch (error) {
    console.error("Board meeting PATCH error:", error)
    return NextResponse.json({ error: "Failed to update meeting" }, { status: 500 })
  }
}
