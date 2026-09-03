// R67 lane D22 (item D-64, rec R-230): ONE searchable BOQ line lookup.
//
// The Daily Entry form, the chat's record step and the work-progress list all
// need to name a BOQ line the same way -- code, description, unit, and how much
// of it is left. Before this each of them had its own idea: the form loaded a
// whole BOQ and rendered a flat native <select>, the list printed the raw id,
// and the chat had nothing at all. This is the shared endpoint.
//
// Read-only, so authentication alone gates it (same posture as this surface's
// other reads). The org scope comes from the caller's own key/session; the
// projectId in the querystring can only narrow within that org, never widen it.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireOrg } from "@/lib/supabase/auth-guard"
import { listBoqLineOptions, ServiceError } from "@/lib/services/construction-boq-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  try {
    const params = request.nextUrl.searchParams
    const projectId = params.get("projectId")
    if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 })
    const limitParam = Number.parseInt(params.get("limit") ?? "", 10)
    const result = await listBoqLineOptions(
      { orgId: ctx.orgId },
      {
        projectId,
        q: params.get("q") ?? undefined,
        boqId: params.get("boqId") ?? undefined,
        limit: Number.isFinite(limitParam) ? limitParam : undefined,
      }
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa scope lines error:", error)
    return NextResponse.json({ error: "Failed to load BOQ lines" }, { status: 500 })
  }
}
