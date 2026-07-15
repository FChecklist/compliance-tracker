import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listStage0OrgsForUser, listStage0Inbox, ServiceError } from "@/lib/services/stage0-service"

// Priority 18b (Owner directive 2026-07-15, Option B): the one place in
// this app that is deliberately NOT single-org-scoped -- requireAuth()'s
// own `orgId` is null for a pure stage-0 user (no real home org), so this
// route works off `dbUser` alone, lists every org the caller has an active
// stage0Sources relationship with, and calls listStage0Inbox once per org,
// merging results -- exactly the shape the design doc's section 2.6 Option
// B intended. A real full member (orgId not null) calling this simply gets
// an empty `orgs` array if they hold no separate stage-0 relationships
// elsewhere -- harmless, not an error.
export async function GET() {
  const { response, dbUser } = await requireAuth()
  if (response) return response
  if (!dbUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const orgs = await listStage0OrgsForUser(dbUser.id)
    const results = await Promise.all(
      orgs.map(async (o) => ({
        orgId: o.orgId,
        orgName: o.orgName,
        items: await listStage0Inbox(dbUser.id, o.orgId),
      }))
    )
    return NextResponse.json({ orgs: results })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Stage-0 inbox error:", error)
    return NextResponse.json({ error: "Failed to load stage-0 inbox" }, { status: 500 })
  }
}
