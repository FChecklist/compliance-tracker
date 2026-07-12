import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getWorkDashboard } from "@/lib/services/work-dashboard-service"

// Wave 173 (GAP-UNIVERSAL-DASHBOARD): GET /api/work-dashboard -- the real,
// reachable API surface for the read-only cross-type aggregation built in
// work-dashboard-service.ts. See that file's own header for the DEC-03
// "approximated, not a unified Work Object" scope note.
export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const result = await getWorkDashboard({ orgId })
    return NextResponse.json(result)
  } catch (error) {
    console.error("Work dashboard aggregation error:", error)
    return NextResponse.json({ error: "Failed to build work dashboard" }, { status: 500 })
  }
}
