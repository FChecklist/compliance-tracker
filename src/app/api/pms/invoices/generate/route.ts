// Gap closure (2026-07-27, DEEP_ERP_FUNCTIONALITY_COMPLETION_VIA_ODOO_ERPNEXT_REFERENCE):
// "PMS timesheet -> client invoice" trigger route. Session-only requireAuth
// (not requireAuthOrApiKey, unlike the read-mostly /api/pms/schedule/*
// surface) since this emits a real erp_sales_invoices row -- a money-moving
// action, matching how the rest of erp-invoicing-service.ts's write routes
// are gated.
import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { generateInvoiceFromUnbilledProjectTime, ServiceError } from "@/lib/services/pms-invoice-service"

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  const roleCheck = requireRole(dbUser, "admin")
  if (roleCheck) return roleCheck

  try {
    const body = await request.json()
    if (!body.projectId || !body.customerId || !body.throughDate || !body.postingDate) {
      return NextResponse.json({ error: "projectId, customerId, throughDate, postingDate are required" }, { status: 400 })
    }
    const invoice = await generateInvoiceFromUnbilledProjectTime({ orgId, userId: dbUser.id, dbUser }, {
      projectId: body.projectId,
      customerId: body.customerId,
      throughDate: body.throughDate,
      postingDate: body.postingDate,
      dueDate: body.dueDate,
      currencyId: body.currencyId,
      exchangeRate: body.exchangeRate,
      companyId: body.companyId,
      taxRatePercent: body.taxRatePercent,
    })
    return NextResponse.json(invoice, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("PMS invoice generation error:", error)
    return NextResponse.json({ error: "Failed to generate invoice" }, { status: 500 })
  }
}
