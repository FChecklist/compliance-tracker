import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getOutageCorrelationReport, recordOutageWindow } from "@/lib/services/provider-outage-correlation-service"

// AI Model Lifecycle & Benchmarking gap-closure, Finding 3: provider-outage
// historical incident correlation with role failures -- see
// provider-outage-correlation-service.ts's own header for the full
// investigation trail and why outage windows are admin-recorded (no
// external status-page integration exists in this codebase). veridian_
// admin-gated, same posture as every other route in this gap-closure.
export async function GET(request: NextRequest) {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Provider-outage correlation is veridian_admin-only" }, { status: 403 })
  }

  const sinceDaysParam = request.nextUrl.searchParams.get("sinceDays")
  const sinceDays = sinceDaysParam ? Math.max(1, Math.min(365, Number(sinceDaysParam) || 90)) : 90

  try {
    const report = await getOutageCorrelationReport(sinceDays)
    return NextResponse.json(report)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load provider-outage correlation report"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/** Manually records a provider-outage window. No automated status-page feed exists yet (see this module's header) -- an admin logs the window (e.g. after confirming an incident on the provider's own status page), and every subsequent GET's correlation picks it up automatically. */
export async function POST(request: NextRequest) {
  const { user, dbUser, response: authError } = await requireAuth()
  if (!user) return authError!
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "Recording a provider-outage window is veridian_admin-only" }, { status: 403 })
  }

  try {
    const body = await request.json()
    const { provider, startedAt, endedAt, notes } = body as { provider?: string; startedAt?: string; endedAt?: string | null; notes?: string | null }

    if (!provider || typeof provider !== "string") {
      return NextResponse.json({ error: "provider is required" }, { status: 400 })
    }
    const startedAtDate = startedAt ? new Date(startedAt) : null
    if (!startedAtDate || Number.isNaN(startedAtDate.getTime())) {
      return NextResponse.json({ error: "startedAt must be a valid ISO timestamp" }, { status: 400 })
    }
    let endedAtDate: Date | null = null
    if (endedAt) {
      endedAtDate = new Date(endedAt)
      if (Number.isNaN(endedAtDate.getTime())) {
        return NextResponse.json({ error: "endedAt must be a valid ISO timestamp" }, { status: 400 })
      }
    }

    const created = await recordOutageWindow({
      provider,
      startedAt: startedAtDate,
      endedAt: endedAtDate,
      notes: notes ?? null,
      createdBy: user.id,
    })
    return NextResponse.json({ id: created.id }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to record provider-outage window"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
