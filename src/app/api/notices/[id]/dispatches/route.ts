import { noticeDispatches, notices } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { NextRequest, NextResponse } from "next/server"
import { eq, and, desc } from "drizzle-orm"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { logActivity } from "@/lib/audit"

const VALID_METHODS = ["courier", "speed_post", "email", "hand_delivery", "online_portal"] as const

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, context: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ dispatches: [] })

  try {
    const { id } = await context.params
    const dispatches = await withTenantContext({ orgId }, (db) =>
      db.query.noticeDispatches.findMany({
        where: eq(noticeDispatches.noticeId, id),
        orderBy: desc(noticeDispatches.createdAt),
      })
    )
    return NextResponse.json({
      dispatches: dispatches.map((d) => ({
        id: d.id,
        dispatchMethod: d.dispatchMethod,
        trackingNumber: d.trackingNumber,
        courierName: d.courierName,
        dispatchDate: d.dispatchDate?.toISOString() ?? null,
        deliveryConfirmedDate: d.deliveryConfirmedDate?.toISOString() ?? null,
        proofDocumentId: d.proofDocumentId,
        recordedAt: d.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error("Notice dispatches GET error:", error)
    return NextResponse.json({ error: "Failed to fetch dispatches" }, { status: 500 })
  }
}

// "A reply was filed" is a claim; this endpoint captures the proof --
// tracking number + who recorded it + when. Rows are never edited, only
// added (e.g. a later delivery-confirmation update is a new dispatch-linked
// fact recorded via the same route, not a mutation of the original row) --
// same append-only principle as costPayments/auditLogs.
export async function POST(request: NextRequest, context: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "member")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await context.params
    const body = await request.json()
    const { dispatchMethod, trackingNumber, courierName, dispatchDate, deliveryConfirmedDate, proofDocumentId } = body

    if (dispatchMethod !== undefined && dispatchMethod !== null && !(VALID_METHODS as readonly string[]).includes(dispatchMethod)) {
      return NextResponse.json({ error: "Invalid dispatchMethod" }, { status: 400 })
    }

    const result = await withTenantContext({ orgId, userId: dbUser.id }, async (db) => {
      const notice = await db.query.notices.findFirst({ where: and(eq(notices.id, id), eq(notices.orgId, orgId)) })
      if (!notice) return null

      const [dispatch] = await db.insert(noticeDispatches).values({
        noticeId: id,
        dispatchMethod: dispatchMethod || null,
        trackingNumber: trackingNumber?.trim() || null,
        courierName: courierName?.trim() || null,
        dispatchDate: dispatchDate ? new Date(dispatchDate) : null,
        deliveryConfirmedDate: deliveryConfirmedDate ? new Date(deliveryConfirmedDate) : null,
        proofDocumentId: proofDocumentId || null,
        orgId,
        clientId: notice.clientId,
        recordedById: dbUser.id,
      }).returning()

      await logActivity({
        tx: db,
        action: "dispatch_recorded",
        entityType: "Notice",
        entityId: id,
        details: `Dispatch evidence recorded${dispatchMethod ? ` (${dispatchMethod})` : ""}${trackingNumber ? `, tracking: ${trackingNumber}` : ""}`,
        orgId,
        clientId: notice.clientId,
        dbUser,
        request,
      })

      return dispatch
    })

    if (!result) return NextResponse.json({ error: "Notice not found" }, { status: 404 })
    return NextResponse.json({ id: result.id }, { status: 201 })
  } catch (error) {
    console.error("Notice dispatch POST error:", error)
    return NextResponse.json({ error: "Failed to record dispatch" }, { status: 500 })
  }
}
