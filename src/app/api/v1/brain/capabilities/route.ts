// Wave 153 (Phase4_Implementation_Plan.md, "Brain architecture groundwork"
// -- Phase A of the strangler-fig proposal in Study_by_Claude.md's
// architecture addendum: wrap existing services behind an internal API
// namespace, no repository extraction yet). Mirrors
// /api/v1/projexa/capability-tree/route.ts's exact pattern -- thin wrapper
// over an existing service, no new data model, no code moved.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { findSimilarCapabilities } from "@/lib/services/capability-registry-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const query = request.nextUrl.searchParams.get("query")
  if (!query?.trim()) return NextResponse.json({ error: "query is required" }, { status: 400 })
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit")) || 10, 25)

  try {
    const matches = await findSimilarCapabilities(query, ctx.orgId, limit)
    return NextResponse.json({ matches })
  } catch (error) {
    console.error("v1 brain capabilities error:", error)
    return NextResponse.json({ error: "Failed to search capabilities" }, { status: 500 })
  }
}
