import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, resolveActingUser, readActingUserId, readActingUserEmail } from "@/lib/supabase/auth-guard"
import {
  getChangeOrder, submitChangeOrderForApproval, ServiceError,
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

  const roleCheck = requireRoleOrScope(ctx, "senior_professional")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()

    if (body.action === "submit") {
      // R-97 fix (2026-09-19, Owner-authorized): real e-signature dispatch
      // needs a real user identity to attribute the request to -- an API
      // key ALONE (no dbUser, no acting-user headers) still can't submit
      // one, but a PROJEXA-proxied call now resolves a REAL person the same
      // way cost-visibility-service.ts's resolveRoleForCostVisibility()
      // already does (X-Acting-User / X-Acting-User-Email -> a real
      // compliance.users row), rather than blanket-refusing every
      // API-key-authenticated caller. This was previously unconditional --
      // `ctx.dbUser` is ALWAYS null for PROJEXA's shared-API-key calls
      // (requireAuthOrApiKey's own fast API-key path, auth-guard.ts ~line
      // 424), so "Send for Approval" could never succeed from PROJEXA's
      // real UI for any user, on any change order.
      const acting = await resolveActingUser(ctx, readActingUserEmail(request), readActingUserId(request))
      if (acting.error) return acting.error
      const changeOrder = await submitChangeOrderForApproval({ orgId: ctx.orgId, userId: acting.user!.id, dbUser: acting.user! }, id, body.signers ?? [])
      return NextResponse.json(changeOrder)
    }
    // action === "approve"/"reject" was deliberately removed here (this
    // route used to call markChangeOrderApproved()/markChangeOrderRejected()
    // directly, letting ANY caller flip a change order to approved/rejected
    // with zero signature ever happening -- the exact integrity bypass the
    // Owner rejected for PROJEXA's own UI, just reachable from this API
    // instead). The only real approval mechanism now is e-signature
    // completion: esignature-service.ts's submitSignature()/
    // declineSignature() auto-transition the linked change order's status
    // once every signer has actually signed (or on a decline). Use GET
    // /change-orders/[id]/signature-status to see real progress.
    return NextResponse.json({ error: "action must be 'submit' -- a change order can only be approved/rejected via a real e-signature completion, see GET .../signature-status" }, { status: 400 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa change-order update error:", error)
    return NextResponse.json({ error: "Failed to update change order" }, { status: 500 })
  }
}
