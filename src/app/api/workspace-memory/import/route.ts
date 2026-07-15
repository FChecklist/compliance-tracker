// Priority 21, Layer 2 Workspace Memory -- see
// ai-os/priority21_workspace_memory_design.md §3.4. Explicit user action
// only (a file picker + button click), never silent/automatic -- per
// SEC-04, this never overwrites existing data (saved reports are added,
// never updated; conversations are surfaced read-only, never reinjected
// into the live conversations/messages tables).
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { importWorkspaceMemory, ServiceError } from "@/lib/services/workspace-memory-service"

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const formData = await request.formData()
    const file = formData.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "A .mv2 capsule file is required" }, { status: 400 })
    }
    const bytes = Buffer.from(await file.arrayBuffer())
    const result = await importWorkspaceMemory({ orgId, dbUser }, bytes, request)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Workspace memory import error:", error)
    return NextResponse.json({ error: "Failed to import workspace memory" }, { status: 500 })
  }
}
