import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { scanForDuplicateTasks } from "@/lib/services/task-dedup-service"

// VERIDIAN Review Framework gap closure, 2026-07-18 ("Duplicate Work
// Detection"). On-demand audit, not a background job -- each row costs a
// real embedding-similarity search, mirroring
// /api/capability-registry/duplicates and /api/mdm/duplicates/scan's own
// admin/manager-gated, cost-conscious pattern. Never cancels or merges a
// task itself; surfaces candidates for a human to decide.
export async function GET(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId) return NextResponse.json({ duplicates: [] })

  try {
    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get("projectId") ?? undefined
    const duplicates = await scanForDuplicateTasks({ orgId, projectId })
    return NextResponse.json({ duplicates })
  } catch (error) {
    console.error("Task duplicate audit error:", error)
    return NextResponse.json({ error: "Duplicate task audit failed" }, { status: 500 })
  }
}
