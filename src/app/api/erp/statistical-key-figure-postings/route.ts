// CO-006 (Statistical Key Figure Report) posting route -- the KB21N
// (actual)/KP46 (plan) equivalent, merged into one endpoint via the
// `version` field on the request body. Direct template:
// src/app/api/erp/cost-centers/route.ts's POST handler.
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { postStatisticalKeyFigureValue, ServiceError } from "@/lib/services/erp-costing-service"
import { requirePermissionForUser } from "@/lib/services/permission-service"

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleErr = requirePermissionForUser(dbUser, "erp.statistical_key_figure_postings.create")
  if (roleErr) return roleErr

  try {
    const body = await request.json()
    const posting = await postStatisticalKeyFigureValue({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(posting, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Statistical key figure posting create error:", error)
    return NextResponse.json({ error: "Failed to create statistical key figure posting" }, { status: 500 })
  }
}
