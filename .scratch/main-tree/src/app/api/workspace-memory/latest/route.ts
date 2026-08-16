// Priority 21, Layer 2 Workspace Memory -- Option 3 (first-party
// "pull latest capsule", ai-os/priority21_workspace_memory_design.md §4).
// Returns a fresh signed URL to the caller's OWN most recent export, sourced
// entirely from data this feature already produces (workspace_memory_capsule_events
// rows + the existing compliance-documents storage object) -- no new sync
// mechanism, just a query + a signed URL, matching the design doc's own
// framing of Option 3 as "the least new moving parts of the three." The
// client feeds the resulting file straight into the pre-existing
// POST /api/workspace-memory/import route (SEC-04: same import path as
// every other transport).
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { getLatestExportedCapsule, createCapsuleSignedUrl, ServiceError } from "@/lib/services/workspace-memory-service"

export async function GET(_request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const latest = await withTenantContext({ orgId, userId: dbUser.id }, (db) =>
      getLatestExportedCapsule({ orgId, userId: dbUser.id }, db)
    )
    if (!latest) {
      return NextResponse.json(
        { error: "No previous export found -- export your workspace memory at least once before syncing." },
        { status: 404 }
      )
    }

    const { signedUrl, expiresInSeconds } = await createCapsuleSignedUrl(latest.storageObjectPath)

    return NextResponse.json({
      eventId: latest.id,
      signedUrl,
      expiresInSeconds,
      fileSizeBytes: latest.fileSizeBytes,
      itemCounts: latest.itemCounts,
      createdAt: latest.createdAt,
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Workspace memory latest-capsule error:", error)
    return NextResponse.json({ error: "Failed to look up your latest workspace memory capsule" }, { status: 500 })
  }
}
