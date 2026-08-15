import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { createProject, ServiceError } from "@/lib/services/construction-dashboard-service"

// Closes the one real gap in PROJEXA's otherwise-complete per-module CRUD
// surface: every other entity (RFIs, submittals, punch list, ...) already
// has a create path -- Projects, the entity everything else nests under,
// did not. See construction-dashboard-service.ts's createProject() for the
// full context (2026-07-18 production-readiness pass).
export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

  try {
    const body = await request.json()
    const project = await createProject({ orgId: ctx.orgId, userId: actorId, isRealUser: Boolean(ctx.dbUser) }, body)
    return NextResponse.json(project, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa projects create error:", error)
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 })
  }
}
