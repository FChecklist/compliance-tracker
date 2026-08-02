import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getChangeOrder, ServiceError } from "@/lib/services/construction-change-order-service"
import { listSignatureRequests } from "@/lib/services/esignature-service"

type RouteContext = { params: Promise<{ id: string }> }

// PROJEXA_GAP_ANALYSIS.md gap #5: a change order sitting at "pending_approval"
// had no UI-visible way to see the real e-signature progress behind it. This
// is a thin, read-only alias (same convention as every other v1/projexa/*
// route) over the already-existing listSignatureRequests() -- no new
// business logic, just exposing signer-by-signer status for the one
// signature request tied to this change order so PROJEXA can render an
// honest "N of M signed" summary instead of a fake one-click approve button.
export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    // Confirms the change order exists (and is in this org) before doing
    // the signature-request lookup, same 404 semantics as GET
    // /api/v1/projexa/change-orders/[id] above.
    await getChangeOrder({ orgId: ctx.orgId }, id)

    const requests = await listSignatureRequests({ orgId: ctx.orgId }, { linkedEntityType: "change_order", linkedEntityId: id })
    // Most recent request is the one that matters -- a change order can only
    // ever have one active signature request at a time (submitChangeOrderForApproval
    // only fires from "draft"), but listSignatureRequests returns all history
    // ordered newest-first, so [0] is correct even if a prior request was voided.
    const latest = requests[0] ?? null

    if (!latest) {
      return NextResponse.json({ signatureRequest: null })
    }

    return NextResponse.json({
      signatureRequest: {
        id: latest.id,
        status: latest.status,
        title: latest.title,
        completedAt: latest.completedAt,
        signers: latest.signers.map((s) => ({
          name: s.name, email: s.email, status: s.status, signOrder: s.signOrder,
          signedAt: s.signedAt, declinedAt: s.declinedAt, declineReason: s.declineReason,
        })),
      },
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa change-order signature-status error:", error)
    return NextResponse.json({ error: "Failed to fetch signature status" }, { status: 500 })
  }
}
