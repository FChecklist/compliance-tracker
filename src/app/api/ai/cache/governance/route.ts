// Audit198 gap closure, 2026-07-21 (RULE-077: "Every cache layer shall be
// monitored, audited, measured, invalidated when required, and optimized
// continuously by software without requiring AI intervention"). Mirrors
// the existing GET /api/assets/cache/stats pattern (veridian_admin-gated,
// same reasoning: this exposes operational data, not something every
// authenticated user needs) but covers EVERY cache layer registered in
// cache-governance.ts's CACHE_REGISTRY, not just the asset registry --
// the concrete, software-only (zero AI call in this route) evidence that
// monitoring/measurement is real across the whole caching category, not
// a single cache.
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getCacheGovernanceRegistry, getCacheEventStats } from "@/lib/cache-governance"

export async function GET() {
  const { response, dbUser } = await requireAuth()
  if (response) return response
  if (!dbUser || dbUser.role !== "veridian_admin") {
    return NextResponse.json({ error: "veridian_admin-only" }, { status: 403 })
  }

  return NextResponse.json({
    registry: getCacheGovernanceRegistry(),
    eventCounters: getCacheEventStats(),
  })
}
