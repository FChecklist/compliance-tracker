// Priority 4 (09-priority4-umr-universal-tracker.yaml): the concrete
// evidence that the compiled metadata cache is real, not just a claim --
// veridian_admin-gated (same pattern as /api/ai/team/dispatch), since this
// exposes per-org cache occupancy, which is operational data, not
// something every authenticated user needs.
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getCacheStats, CACHE_TTL_MS } from "@/lib/services/asset-registry-cache"

export async function GET() {
  const { response, dbUser } = await requireAuth()
  if (response) return response
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "veridian_admin-only" }, { status: 403 })
  }

  return NextResponse.json({ ttlMs: CACHE_TTL_MS, ...getCacheStats() })
}
