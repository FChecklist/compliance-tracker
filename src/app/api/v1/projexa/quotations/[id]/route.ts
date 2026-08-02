// Priority 15 (Sales & CRM depth wave): status-update alias over
// erp-selling-service.ts's updateQuotationStatus, which now enforces a real
// draft -> pending_approval -> approved -> sent -> ordered|lost|expired
// transition table (see that function's own comment) instead of a
// free-for-all setter. Quote->sales-order conversion lives at the sibling
// [id]/convert/route.ts; revisioning at [id]/revisions/route.ts.
//
// Priority 15, Wave 2 (deferred item closed here): requireRoleOrScope's
// "manager" minimumRole only actually applies to a real dbUser session --
// for an API-key caller it falls through to a plain write-scope check
// regardless of minimumRole (see that function's own branching in
// auth-guard.ts). PROJEXA's server-side proxy calls this route with a
// single shared, org-wide write-scoped API key (see PROJEXA's
// veridian-client.ts callVeridian()), used by every user of an org -- so
// the broad requireRoleOrScope(ctx, "member", "write") below let ANY
// PROJEXA user push a quotation through EVERY transition, including
// pending_approval -> approved, with no real distinction between a sales
// rep and an actual manager. The 'approved' transition specifically now
// requires a real per-user session (ctx.dbUser) at manager rank or above,
// matching the "requires a real user session, not an API key" convention
// already used throughout this same wave for actions a shared API key must
// never rubber-stamp on its own (e.g. hr/departments/route.ts's POST,
// payroll runs/payslip finalization, leave-request decisions, change-order
// e-signature submission). Honest limitation carried over from that same
// precedent: PROJEXA's shared-API-key proxy has no per-user identity bridge
// today (a bigger auth-architecture change, out of this wave's scope), so
// approving a quotation from the PROJEXA UI will get this same 400 until
// that bridge exists -- identical to how PROJEXA's leave-approval button
// already behaves for the same reason. Other transitions keep the existing
// broader write-scope check.
//
// VERIDIAN Review Framework remediation: both the base gate and the
// approval-specific gate are now routed through the shared
// permission-service.ts utility (ERP_ACTION_ROLES["erp.quotations.update_status"]
// = "member", ERP_ACTION_ROLES["erp.quotations.approve"] = "manager") --
// no behavior change from the previous inline requireRoleOrScope/
// requireRole calls, single source of truth only. The real-dbUser-required
// check on the 'approved' branch stays inline (it isn't a role-rank
// concept requirePermissionForUser expresses -- see permission-service.ts's
// own documented limitation of requireRoleOrScope for API-key callers).
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { requirePermission, requirePermissionForUser } from "@/lib/services/permission-service"
import { updateQuotationStatus, ServiceError } from "@/lib/services/erp-selling-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requirePermission(ctx, "erp.quotations.update_status")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id

  try {
    const { id } = await params
    const body = await request.json()
    if (!body.status) return NextResponse.json({ error: "status is required" }, { status: 400 })

    if (body.status === "approved") {
      if (!ctx.dbUser) {
        return NextResponse.json({ error: "Approving a quotation requires a real user session, not an API key" }, { status: 400 })
      }
      const managerErr = requirePermissionForUser(ctx.dbUser, "erp.quotations.approve")
      if (managerErr) return managerErr
    }

    const quotation = await updateQuotationStatus({ orgId: ctx.orgId, userId: actorId }, id, body.status)
    return NextResponse.json({ id: quotation.id, quotationNumber: quotation.quotationNumber, status: quotation.status })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa quotation update error:", error)
    return NextResponse.json({ error: "Failed to update quotation" }, { status: 500 })
  }
}
