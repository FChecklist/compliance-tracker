import { boardMeetings, boardActionItems } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq, desc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { canAccess } from "@/lib/classification"
import { logActivity } from "@/lib/audit"

export async function GET() {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ meetings: [], actionItems: [] })

  const [meetings, actionItems] = await withTenantContext({ orgId }, (db) =>
    Promise.all([
      db.query.boardMeetings.findMany({ orderBy: desc(boardMeetings.meetingDate) }),
      db.query.boardActionItems.findMany({ orderBy: desc(boardActionItems.createdAt) }),
    ])
  )

  return NextResponse.json({
    meetings: meetings.map((m) => {
      const cleared = canAccess(dbUser.role, m.classification as never)
      return {
        id: m.id, title: m.title, meetingType: m.meetingType, meetingDate: m.meetingDate.toISOString(),
        status: m.status, agenda: m.agenda, classification: m.classification,
        // Minutes/attendees/history are the sensitive payload -- withheld
        // entirely (not just blanked) if the caller's role ceiling doesn't
        // clear this record's classification, same principle as the mockup.
        ...(cleared ? { minutes: m.minutes, attendees: m.attendees, minutesHistory: m.minutesHistory } : { restricted: true }),
      }
    }),
    actionItems: actionItems.map((a) => ({ id: a.id, boardMeetingId: a.boardMeetingId, item: a.item, dueDate: a.dueDate?.toISOString() ?? null, status: a.status })),
  })
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const { title, meetingType, meetingDate, agenda } = body
    if (!title || !meetingDate) return NextResponse.json({ error: "title and meetingDate are required" }, { status: 400 })

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const [meeting] = await db.insert(boardMeetings).values({
        title: title.trim(),
        meetingType: meetingType || "board_meeting",
        meetingDate: new Date(meetingDate),
        agenda: Array.isArray(agenda) ? agenda : [],
        orgId, createdById: dbUser.id,
      }).returning()

      await logActivity({ tx: db, action: "create", entityType: "BoardMeeting", entityId: meeting.id, details: `Scheduled: ${meeting.title}`, orgId, dbUser, request })
      return meeting
    })

    return NextResponse.json({ id: result.id, title: result.title }, { status: 201 })
  } catch (error) {
    console.error("Board meeting create error:", error)
    return NextResponse.json({ error: "Failed to schedule meeting" }, { status: 500 })
  }
}
