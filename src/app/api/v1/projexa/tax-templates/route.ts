// Sumeet requirement #3 ("BILLING MILESTONES"): invoicing a billing
// milestone (invoiceApprovedClaim -> generateInterimBill -> createSalesInvoice)
// requires a real taxTemplateId, and nothing exposed listTaxTemplates() to
// PROJEXA before this -- confirmed zero references to taxTemplateId/
// TaxTemplate anywhere in PROJEXA's own source. GET-only: templates are
// configured in VERIDIAN's own Accounting module, never created from PROJEXA.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireOrg } from "@/lib/supabase/auth-guard"
import { listTaxTemplates } from "@/lib/services/erp-invoicing-service"
import { ServiceError } from "@/lib/services/compliance-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  try {
    const taxTemplates = await listTaxTemplates({ orgId: ctx.orgId })
    return NextResponse.json({ taxTemplates })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa tax-templates list error:", error)
    return NextResponse.json({ error: "Failed to fetch tax templates" }, { status: 500 })
  }
}
