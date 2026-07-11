import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { buildCapabilityTree } from "@/lib/services/capability-tree-service"

// D5.B7: optional ?module= query param, additive -- omitting it (every
// caller before this wave, and any caller that doesn't care about
// route-scoping) preserves the exact prior full-tree behavior.
export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ nodes: [] })

  try {
    const moduleScope = request.nextUrl.searchParams.get("module") ?? undefined
    const nodes = await buildCapabilityTree({ orgId, moduleScope })
    return NextResponse.json({ nodes })
  } catch (error) {
    console.error("Capability tree error:", error)
    return NextResponse.json({ error: "Failed to build capability tree" }, { status: 500 })
  }
}
