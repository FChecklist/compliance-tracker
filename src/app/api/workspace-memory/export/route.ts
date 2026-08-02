// Priority 21, Layer 2 Workspace Memory -- see
// ai-os/priority21_workspace_memory_design.md §3.3. User-initiated only, no
// API-key path (this is a personal action, not a server-to-server
// integration) -- matches requireAuth()-only precedent in this repo's other
// personal-data export routes (e.g. /api/veri-meetings/[id]/export).
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { exportWorkspaceMemory, ServiceError } from "@/lib/services/workspace-memory-service"

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const result = await exportWorkspaceMemory({ orgId, dbUser }, request)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Workspace memory export error:", error)
    return NextResponse.json({ error: "Failed to export workspace memory" }, { status: 500 })
  }
}
