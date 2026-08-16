// Priority 21, Layer 2 Workspace Memory -- Option 2 (Google Drive auto-sync,
// ai-os/priority21_workspace_memory_design.md §4). Produces a capsule via
// the EXACT SAME exportWorkspaceMemory() Option 1 already uses (no second
// export code path), then uploads that same capsule into the user's
// connected Google Drive. If Drive upload fails, the capsule is still safely
// stored in Supabase (the local export already succeeded) -- the error
// response makes that distinction explicit rather than implying total
// failure.
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { exportWorkspaceMemory, ServiceError } from "@/lib/services/workspace-memory-service"
import { requireActiveDriveConnection, uploadCapsuleToDrive } from "@/lib/services/workspace-memory-drive-sync"

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    // Fail fast, before spending time producing a capsule, if Drive isn't
    // connected yet -- clear, actionable message pointing at VERI Connect.
    const connection = await requireActiveDriveConnection({ orgId, userId: dbUser.id })

    const exported = await exportWorkspaceMemory({ orgId, dbUser }, request, { syncMethod: "google_drive" })

    const fileName = `workspace-memory-${new Date().toISOString().replace(/[:.]/g, "-")}.mv2`
    try {
      const drive = await uploadCapsuleToDrive(
        { orgId, userId: dbUser.id },
        connection.composioConnectedAccountId,
        { sourceUrl: exported.signedUrl, fileName }
      )
      return NextResponse.json({ ...exported, drive }, { status: 201 })
    } catch (driveErr) {
      // The capsule is already safely stored (exported.eventId is real) --
      // only the Drive leg failed. Say so explicitly, don't imply data loss.
      const message = driveErr instanceof ServiceError ? driveErr.message : "Unknown error"
      return NextResponse.json(
        {
          error: `Capsule was exported and stored, but syncing to Google Drive failed: ${message}`,
          eventId: exported.eventId,
        },
        { status: driveErr instanceof ServiceError ? driveErr.status : 502 }
      )
    }
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Workspace memory Drive export error:", error)
    return NextResponse.json({ error: "Failed to export workspace memory to Google Drive" }, { status: 500 })
  }
}
