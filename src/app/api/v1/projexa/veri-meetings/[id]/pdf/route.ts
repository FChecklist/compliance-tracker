// Wave 143: real PDF export for a Minutes of Meeting -- same posture as
// quotations/[id]/pdf/route.ts (thin GET, generates+streams a real binary
// PDF, no requireRoleOrScope gate beyond auth since it's read-only).
//
// R67 lane D22 (item D-58, rec R-187): the document a site team sends out has
// to name the PROJECT and carry the action items that were really agreed. The
// project name is resolved from the meeting's own contextEntityId (PROJEXA
// always sets contextEntityType 'project' when creating from a project screen)
// and the action items come off getVeriMeeting's existing task join -- neither
// needed a new query of their own beyond the one project lookup.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getVeriMeeting, ServiceError } from "@/lib/services/veri-meeting-service"
import { generateMeetingMinutesPdf } from "@/lib/pdf/meeting-minutes-pdf"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { projects, users } from "@/lib/db"
import { and, eq, inArray } from "drizzle-orm"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const orgId = ctx.orgId

  try {
    const { id } = await params
    const meeting = await getVeriMeeting({ orgId }, id)

    const ownerIds = [...new Set(meeting.actionItems.map((a) => a.task?.userId).filter((v): v is string => !!v))]
    const projectId = meeting.contextEntityType === "project" ? meeting.contextEntityId : null

    // One transaction for both lookups rather than two, and neither is fatal:
    // a MoM must still export when its project was renamed away or an owner's
    // user row is gone -- the PDF then simply shows no project / a dash.
    const { projectName, nameByUserId } = await withTenantContext({ orgId }, async (db) => {
      const project = projectId
        ? await db.query.projects.findFirst({ where: and(eq(projects.id, projectId), eq(projects.orgId, orgId)), columns: { name: true } })
        : null
      const owners = ownerIds.length
        ? await db.query.users.findMany({ where: and(eq(users.orgId, orgId), inArray(users.id, ownerIds)), columns: { id: true, name: true } })
        : []
      return { projectName: project?.name ?? null, nameByUserId: new Map(owners.map((u) => [u.id, u.name])) }
    })

    const pdfBuffer = generateMeetingMinutesPdf({
      systemId: meeting.systemId,
      projectName,
      title: meeting.title,
      meetingType: meeting.meetingType,
      scheduledAt: meeting.scheduledAt,
      status: meeting.status,
      attendees: (meeting.attendees ?? []) as string[],
      agenda: (meeting.agenda ?? []) as string[],
      minutes: meeting.minutes,
      actionItems: meeting.actionItems.map((a) => ({
        title: a.task?.title ?? "(untitled action)",
        // A name, never a raw user id -- the whole point of item D-58's people
        // picker is that no screen or document prints "usr_abc123".
        owner: (a.task?.userId && nameByUserId.get(a.task.userId)) || null,
        dueDate: a.task?.dueDate ?? null,
        status: a.task?.status ?? null,
      })),
      aiSummary: meeting.aiSummary,
      aiKeyDecisions: (meeting.aiKeyDecisions ?? []) as string[],
      aiSuggestedActionItems: (meeting.aiSuggestedActionItems ?? []) as { title: string; assignee: string | null; dueDateHint: string | null }[],
    })
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="mom-${meeting.systemId ?? meeting.id}.pdf"`,
        "Content-Length": String(pdfBuffer.byteLength),
      },
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa veri-meeting pdf error:", error)
    return NextResponse.json({ error: "Failed to generate meeting PDF" }, { status: 500 })
  }
}
