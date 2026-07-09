import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import {
  getChangeOrder, submitChangeOrderForApproval, markChangeOrderApproved, markChangeOrderRejected, ServiceError,
} from "@/lib/services/construction-change-order-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const changeOrder = await getChangeOrder({ orgId: ctx.orgId }, id)
    return NextResponse.json(changeOrder)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa change-order get error:", error)
    return NextResponse.json({ error: "Failed to fetch change order" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()

    if (body.action === "submit") {
      // Real e-signature dispatch needs a real user identity to attribute
      // the request to -- an API key alone (no dbUser) can't submit one.
      if (!ctx.dbUser) return NextResponse.json({ error: "Submitting for approval requires a real user session, not an API key" }, { status: 400 })
      const changeOrder = await submitChangeOrderForApproval({ orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }, id, body.signers ?? [])
      return NextResponse.json(changeOrder)
    }
    if (body.action === "approve") {
      const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id
      const changeOrder = await markChangeOrderApproved({ orgId: ctx.orgId, userId: actorId }, id)
      return NextResponse.json(changeOrder)
    }
    if (body.action === "reject") {
      const changeOrder = await markChangeOrderRejected({ orgId: ctx.orgId }, id)
      return NextResponse.json(changeOrder)
    }
    return NextResponse.json({ error: "action must be 'submit', 'approve', or 'reject'" }, { status: 400 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa change-order update error:", error)
    return NextResponse.json({ error: "Failed to update change order" }, { status: 500 })
  }
}
