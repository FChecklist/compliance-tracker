// Priority 15 (PROJEXA GRC module): thin ALIASING route over
// risk-register-service.ts's Risk Register (likelihood x impact severity
// scoring, rule-driven severity bands via module-rules-resolver.ts). Zero
// new business logic -- same service the session-only /api/risks route
// now calls too (see risk-register-service.ts's own header for the
// extraction this wave did).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listRisks, createRisk, ServiceError } from "@/lib/services/risk-register-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ risks: [], totalCount: 0, hiddenByScope: 0 })

  try {
    const result = await listRisks({ orgId: ctx.orgId, dbUser: ctx.dbUser })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa risks list error:", error)
    return NextResponse.json({ error: "Failed to fetch risk register" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }
    const risk = await createRisk(actorCtx, { title: body.title, category: body.category, likelihood: body.likelihood, impact: body.impact })
    return NextResponse.json(risk, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa risk create error:", error)
    return NextResponse.json({ error: "Failed to create risk" }, { status: 500 })
  }
}
