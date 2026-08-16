// Priority 21, Layer 2 Workspace Memory -- lists this user's own past
// export/import events (ai-os/priority21_workspace_memory_design.md §3.5),
// backing the Settings > Workspace Memory section's history list.
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { listWorkspaceMemoryEvents } from "@/lib/services/workspace-memory-service"

export async function GET(_request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ events: [] })

  try {
    const events = await withTenantContext({ orgId, userId: dbUser.id }, (db) =>
      listWorkspaceMemoryEvents({ orgId, userId: dbUser.id }, db)
    )
    return NextResponse.json({ events })
  } catch (error) {
    console.error("Workspace memory list error:", error)
    return NextResponse.json({ error: "Failed to load workspace memory history" }, { status: 500 })
  }
}
