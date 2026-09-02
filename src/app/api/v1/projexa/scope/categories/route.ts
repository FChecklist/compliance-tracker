// R67 D-24: the picklist behind the BOQ create/revise grids' per-line
// Category select. "Org-configurable, seeded with Joinery, Gypsum, Paint,
// Civil, Misc" is implemented WITHOUT a new configuration table: the answer is
// the seed list merged with every category this org has already written on a
// line of this project (construction-boq-service.ts's listBoqCategories /
// mergeBoqCategories), so adding a trade is just using it once.
//
// Read-only and project-scoped. Same auth shape as the sibling
// v1/projexa/scope routes: Bearer-key or session, org required, ServiceError
// mapped to its own status, everything else a 500 with a fixed message.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { listBoqCategories, ServiceError } from "@/lib/services/construction-boq-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) return NextResponse.json({ error: "projectId query param is required" }, { status: 400 })

  try {
    const categories = await listBoqCategories({ orgId: ctx.orgId }, projectId)
    return NextResponse.json({ categories })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa scope categories error:", error)
    return NextResponse.json({ error: "Failed to fetch BOQ categories" }, { status: 500 })
  }
}
