import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { logManualTimeEntry, listTimeEntries, ServiceError } from "@/lib/services/firm-time-tracking-service"

export async function GET(req: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const sp = req.nextUrl.searchParams
    const timeEntries = await listTimeEntries({ orgId, userId: dbUser.id, dbUser }, {
      clientId: sp.get("clientId") ?? undefined,
      engagementId: sp.get("engagementId") ?? undefined,
      userId: sp.get("userId") ?? undefined,
      billable: sp.has("billable") ? sp.get("billable") === "true" : undefined,
      unbilledOnly: sp.get("unbilledOnly") === "true",
    })
    return NextResponse.json({ timeEntries })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("List time entries error:", error)
    return NextResponse.json({ error: "Failed to list time entries" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await req.json()
    const entry = await logManualTimeEntry({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(entry, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Log time entry error:", error)
    return NextResponse.json({ error: "Failed to log time entry" }, { status: 500 })
  }
}
