import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { auditDuplicateCapabilities } from "@/lib/services/capability-registry-service"

// Wave 43 (Capability Registry, PLATFORM_STRATEGY.md §24). On-demand audit,
// not a background job -- each row costs one real embedding-similarity
// search, so this is deliberately something an admin triggers rather than
// something that runs automatically and burns API calls unattended.
// Surfaces candidates for a human to decide on; never deletes/merges
// anything itself.
export async function GET() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "admin")
  if (roleErr) return roleErr
  if (!orgId) return NextResponse.json({ duplicates: [] })

  try {
    const duplicates = await auditDuplicateCapabilities(orgId)
    return NextResponse.json({ duplicates })
  } catch (error) {
    console.error("Capability registry duplicate audit error:", error)
    return NextResponse.json({ error: "Duplicate audit failed" }, { status: 500 })
  }
}
