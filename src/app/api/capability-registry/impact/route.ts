import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { getModuleImpact } from "@/lib/services/graph-impact-service"
import { ServiceError, serviceErrorBody } from "@/lib/services/compliance-service"

// R67 Part B item 1.8 (Impact Analysis screen). Read-only -- calls the
// already-built, already-gated platform.graph_impact() SQL function
// (PART_B_STATUS.md 1.1-1.6/1.8) for one module_registry entry and returns
// its dependent tables. Same admin-gated posture as this directory's other
// two routes (coverage, duplicates) since it exposes internal schema
// structure, not tenant data.
export async function GET(req: NextRequest) {
  const { response, dbUser } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "admin")
  if (roleErr) return roleErr

  const moduleKey = req.nextUrl.searchParams.get("moduleKey")
  if (!moduleKey) return NextResponse.json({ error: "moduleKey is required" }, { status: 400 })

  const depthParam = req.nextUrl.searchParams.get("depth")
  const depth = depthParam === null ? undefined : Number(depthParam)

  try {
    const result = await getModuleImpact(moduleKey, depth)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json(serviceErrorBody(error), { status: error.status })
    console.error("Impact analysis error:", error)
    return NextResponse.json({ error: "Impact analysis failed" }, { status: 500 })
  }
}
