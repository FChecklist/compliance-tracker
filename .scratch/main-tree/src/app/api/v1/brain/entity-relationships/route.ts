// Wave 153 (Phase4_Implementation_Plan.md, "Brain architecture groundwork").
// Same pattern as capabilities/route.ts -- thin wrapper over
// entity-graph-service.ts (Phase 3's graph store), the second real
// consumer of the /api/v1/brain namespace.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { getNeighbors } from "@/lib/services/entity-graph-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const entityType = request.nextUrl.searchParams.get("entityType")
  const entityId = request.nextUrl.searchParams.get("entityId")
  if (!entityType || !entityId) return NextResponse.json({ error: "entityType and entityId are required" }, { status: 400 })

  try {
    const relationships = await getNeighbors(
      { orgId: ctx.orgId, userId: ctx.dbUser?.id ?? ctx.apiKey!.id },
      { entityType, entityId }
    )
    return NextResponse.json({ relationships })
  } catch (error) {
    console.error("v1 brain entity-relationships error:", error)
    return NextResponse.json({ error: "Failed to fetch entity relationships" }, { status: 500 })
  }
}
