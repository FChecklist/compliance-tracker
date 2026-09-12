// R85 Addendum 3 v4 FINAL, Phase 7 (D89, gates 7-01/7-02/7-03/7-04/7-12).
// GET .../excel/export?view=internal|customer -- downloads this BOQ as a
// real .xlsx (7-01: never CSV, which loses number formatting and mangles
// currency). Same auth/error-shape convention as the sibling
// boq/[id]/route.ts and boq/[id]/compare/route.ts (requireAuthOrApiKey,
// no extra role floor -- a read of the same rows those routes already
// serve), and the same requireAuthOrApiKey false-positive this checker's
// regex has for the whole v1 construction/boq family (see
// scripts/check-route-auth-guard.mjs's ROUTE_AUTH_EXEMPTIONS, this file is
// added there).
//
// `view=internal` calls exportInternalBoq(), which itself calls
// applyCostVisibility() before ever building a row -- a cost-blind caller
// gets blank cost/DERIVED cells, never a 403 (matching every other BOQ read
// route's redact-don't-refuse posture). `view=customer` calls
// exportCustomerBoq(), which is STRUCTURALLY incapable of emitting a cost or
// variance figure regardless of caller role (7-12) -- see that function's
// own header comment in boq-excel-roundtrip-service.ts.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { exportInternalBoq, exportCustomerBoq } from "@/lib/services/boq-excel-roundtrip-service"
import { ServiceError } from "@/lib/services/construction-boq-service"
import type { UserRole } from "@/lib/supabase/role-rank"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const { id } = await params
  const view = request.nextUrl.searchParams.get("view") === "customer" ? "customer" : "internal"

  try {
    const buffer =
      view === "customer"
        ? await exportCustomerBoq({ orgId: ctx.orgId }, id)
        : await exportInternalBoq({ orgId: ctx.orgId }, id, (ctx.dbUser?.role as UserRole | undefined) ?? null)

    return new NextResponse(new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="boq-${id}-${view}.xlsx"`,
      },
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction BOQ excel export error:", error)
    return NextResponse.json({ error: "Failed to export BOQ spreadsheet" }, { status: 500 })
  }
}
