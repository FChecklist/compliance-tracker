import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { db, sharedPoolAllocations } from "@/lib/db"
import { eq, desc } from "drizzle-orm"

// Wave 18 (VAIOS Shared AI Resource Pool): the transparency promise --
// "your key was used for platform housekeeping on this date" -- for an org
// that opted a BYO config into shared_pool_eligible. shared_pool_allocations
// has no app_runtime RLS policy at all (same posture as loop_executions,
// Wave 5 -- this is Layer-1-only visibility by default); this route reads
// it via the raw (RLS-bypassing) db client but explicitly filters to the
// caller's own orgId server-side, a deliberately narrow read rather than
// full RLS-based access.
export async function GET() {
  const { orgId, dbUser, response } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const roleError = requireRole(dbUser, "admin")
  if (roleError) return roleError

  try {
    const rows = await db.query.sharedPoolAllocations.findMany({
      where: eq(sharedPoolAllocations.lenderOrgId, orgId),
      orderBy: desc(sharedPoolAllocations.allocatedAt),
      limit: 50,
    })

    return NextResponse.json({
      allocations: rows.map((r) => ({
        id: r.id,
        purpose: r.purpose,
        orchestraLayerKey: r.orchestraLayerKey,
        allocatedAt: r.allocatedAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error("Failed to load pool usage:", error)
    return NextResponse.json({ error: "Failed to load pool usage" }, { status: 500 })
  }
}
