import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { backfillCapabilityIndex } from "@/lib/services/capability-backfill-service"

// Wave 43 (Capability Registry, PLATFORM_STRATEGY.md §24). One-time,
// admin-gated, idempotent -- indexes everything that existed before this
// wave's automatic on-create indexing was added.
export async function POST() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "admin")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const result = await backfillCapabilityIndex({ orgId, userId: dbUser.id })
    return NextResponse.json(result)
  } catch (error) {
    console.error("Capability registry backfill error:", error)
    return NextResponse.json({ error: "Backfill failed" }, { status: 500 })
  }
}
