// Priority 15 (PROJEXA GRC module): thin ALIASING route over
// fraud-case-service.ts's getFraudCase/updateFraudCaseStatus -- the
// reported -> investigating -> confirmed/unsubstantiated -> resolved
// status machine (enforced server-side by VALID_FRAUD_TRANSITIONS).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { getFraudCase, updateFraudCaseStatus, ServiceError } from "@/lib/services/fraud-case-service"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const fraudCase = await getFraudCase({ orgId: ctx.orgId }, id)
    return NextResponse.json(fraudCase)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa fraud-case detail error:", error)
    return NextResponse.json({ error: "Failed to fetch fraud case" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }
    const updated = await updateFraudCaseStatus(actorCtx, id, body.status, body.resolutionSummary)
    return NextResponse.json(updated)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa fraud-case status update error:", error)
    return NextResponse.json({ error: "Failed to update fraud case status" }, { status: 500 })
  }
}
