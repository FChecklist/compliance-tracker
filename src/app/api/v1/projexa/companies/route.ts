// Priority 17 Wave 1 (PROJEXA multi-company/office UI exposure): thin
// ALIASING route over erp-company-service.ts's listCompanies/createCompany --
// erp_companies (Wave 67) already supports a real parent-child company/office
// tree with consolidated reporting (getCompanyDescendantIds, wired through
// erp-financial-report-service.ts's resolveCompanyScope), but PROJEXA never
// let a user pick or create a company/office at all, so this real backend
// capability was completely invisible to a real customer. Zero new business
// logic here -- pure aliasing, matching every other /v1/projexa/* route.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listCompanies, createCompany, ServiceError, type CompanyInput } from "@/lib/services/erp-company-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ companies: [] })

  try {
    const companies = await listCompanies({ orgId: ctx.orgId })
    return NextResponse.json({ companies })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa companies list error:", error)
    return NextResponse.json({ error: "Failed to fetch companies" }, { status: 500 })
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
    const input: CompanyInput = {
      companyName: body.companyName, abbr: body.abbr, parentCompanyId: body.parentCompanyId,
      isGroup: body.isGroup, defaultCurrencyId: body.defaultCurrencyId, country: body.country,
      dateOfIncorporation: body.dateOfIncorporation,
    }
    const actorCtx = ctx.dbUser
      ? { orgId: ctx.orgId, userId: ctx.dbUser.id, dbUser: ctx.dbUser }
      : { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }
    const company = await createCompany(actorCtx, input)
    return NextResponse.json(company, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa company create error:", error)
    return NextResponse.json({ error: "Failed to create company" }, { status: 500 })
  }
}
