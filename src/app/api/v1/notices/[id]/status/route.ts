import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getNoticeStatus, ServiceError } from "@/lib/services/notice-service"

type RouteContext = { params: Promise<{ id: string }> }

// Stage 11 (END_USER_ENGINE receptionist tier, 2026-07-29): a lightweight
// status-only read, distinct from the full GET /api/v1/notices/{id} (which
// also returns department/assignedTo/complianceItem/documents/audit log/
// comments) -- mirrors GET /api/v1/tasks/{id}/status (Wave 11) exactly, for
// the same reason: a customer's AI asking "has our notice been replied to
// yet" shouldn't have to pull the full detail every time.
export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const result = await getNoticeStatus({ orgId: ctx.orgId }, id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 notice status error:", error)
    return NextResponse.json({ error: "Failed to fetch notice status" }, { status: 500 })
  }
}
