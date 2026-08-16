// Priority 21, Layer 2 Workspace Memory -- Option 2 (Google Drive auto-sync,
// ai-os/priority21_workspace_memory_design.md §4). Downloads the latest
// capsule from the user's connected Drive sync folder, then hands the bytes
// to the EXACT SAME importWorkspaceMemory() Option 1's manual-upload route
// already uses -- per SEC-04, there is only ever one import code path in
// this feature (additive-only saved reports, read-only conversation counts),
// regardless of which of the 3 transport options produced the bytes.
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { importWorkspaceMemory, ServiceError } from "@/lib/services/workspace-memory-service"
import { requireActiveDriveConnection, downloadLatestCapsuleFromDrive } from "@/lib/services/workspace-memory-drive-sync"

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const connection = await requireActiveDriveConnection({ orgId, userId: dbUser.id })
    const bytes = await downloadLatestCapsuleFromDrive({ orgId, userId: dbUser.id }, connection.composioConnectedAccountId)
    const result = await importWorkspaceMemory({ orgId, dbUser }, bytes, request, { syncMethod: "google_drive" })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Workspace memory Drive import error:", error)
    return NextResponse.json({ error: "Failed to import workspace memory from Google Drive" }, { status: 500 })
  }
}
