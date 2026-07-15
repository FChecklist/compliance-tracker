// Priority 15 (PROJEXA GRC module): thin ALIASING route over
// fraud-case-service.ts (Wave 92) -- a real case register with a status
// machine (reported -> investigating -> confirmed/unsubstantiated ->
// resolved). Zero new business logic.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listFraudCases, createFraudCase, ServiceError, type FraudCaseInput } from "@/lib/services/fraud-case-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ cases: [] })

  try {
    const cases = await listFraudCases({ orgId: ctx.orgId })
    return NextResponse.json({ cases })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa fraud-cases list error:", error)
    return NextResponse.json({ error: "Failed to fetch fraud cases" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const body = await request.json()
    const input: FraudCaseInput = {
      title: body.title, fraudType: body.fraudType, detectionSource: body.detectionSource,
      description: body.description, financialExposure: body.financialExposure, reportedDate: body.reportedDate,
      investigatorId: body.investigatorId, linkedRiskId: body.linkedRiskId,
    }
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }
    const fraudCase = await createFraudCase(actorCtx, input)
    return NextResponse.json(fraudCase, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa fraud-case create error:", error)
    return NextResponse.json({ error: "Failed to create fraud case" }, { status: 500 })
  }
}
