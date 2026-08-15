import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listOutageWindows, recordOutageWindow, ServiceError } from "@/lib/services/provider-outage-service"

// Provider outage windows -- VERIDIAN Review Framework gap-closure,
// "Provider-outage historical incident correlation with role failures."
// veridian_admin-gated, same posture as /api/ai/team/scorecard.
export async function GET(request: NextRequest) {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Provider outage windows are veridian_admin-only" }, { status: 403 })
  }

  const provider = request.nextUrl.searchParams.get("provider") ?? undefined

  try {
    const windows = await listOutageWindows({ provider })
    return NextResponse.json({ windows })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load provider outage windows"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Recording a provider outage window is veridian_admin-only" }, { status: 403 })
  }

  try {
    const body = await request.json()
    const row = await recordOutageWindow({
      provider: body.provider,
      model: body.model ?? null,
      startedAt: body.startedAt ? new Date(body.startedAt) : undefined as unknown as Date,
      endedAt: body.endedAt ? new Date(body.endedAt) : null,
      source: body.source ?? "manual",
      detectionNote: body.detectionNote ?? null,
      recordedById: dbUser.id,
    })
    return NextResponse.json(row, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Provider outage window create error:", error)
    return NextResponse.json({ error: "Failed to record provider outage window" }, { status: 500 })
  }
}
