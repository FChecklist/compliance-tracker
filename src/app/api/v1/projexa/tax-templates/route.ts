// Sumeet requirement #3 ("BILLING MILESTONES"): invoicing a billing
// milestone (invoiceApprovedClaim -> generateInterimBill -> createSalesInvoice)
// requires a real taxTemplateId, and nothing exposed listTaxTemplates() to
// PROJEXA before this -- confirmed zero references to taxTemplateId/
// TaxTemplate anywhere in PROJEXA's own source. GET-only: templates are
// configured in VERIDIAN's own Accounting module, never created from PROJEXA.
// UPDATE 2026-10-10 (defect D1): that was wrong in practice -- a fresh org has
// no template, so invoicing was impossible. POST now creates one (the form on
// PROJEXA's billing page); tax accounts come from ./accounts/route.ts.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg, requireActingPerson } from "@/lib/supabase/auth-guard"
import { listTaxTemplates, createTaxTemplate } from "@/lib/services/erp-invoicing-service"
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

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "manager", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return requireOrg(ctx)!

  try {
    const { acting, error: actingError } = await requireActingPerson(request, ctx)
    if (actingError) return actingError
    const body = await request.json()
    const items = Array.isArray(body?.items) ? body.items : []
    const template = await createTaxTemplate(
      { orgId: ctx.orgId, userId: acting.person.id, dbUser: acting.person },
      {
        name: typeof body?.name === "string" ? body.name : "",
        isSalesTax: body?.isSalesTax === true,
        isPurchaseTax: body?.isPurchaseTax === true,
        items: items.map((i: { taxAccountId?: unknown; rate?: unknown; description?: unknown }) => ({
          taxAccountId: typeof i?.taxAccountId === "string" ? i.taxAccountId : "",
          rate: typeof i?.rate === "number" ? i.rate : Number.NaN,
          description: typeof i?.description === "string" ? i.description : undefined,
        })),
      }
    )
    return NextResponse.json(template, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa tax-template create error:", error)
    return NextResponse.json({ error: "Failed to create tax template" }, { status: 500 })
  }
}
