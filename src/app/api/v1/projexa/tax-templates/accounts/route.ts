// Defect D1 (2026-10-10): the "Create tax template" form on PROJEXA's billing
// page needs tax accounts (CGST/SGST/IGST) to pick from.
//   GET  -> the org's non-group accounts with accountType "tax".
//   POST -> idempotently seeds the three standard GST output-tax liability
//           accounts (CGST/SGST/IGST) when missing, so a brand-new org is not
//           stuck with an empty picker. Never touches existing accounts.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope, requireOrg, requireActingPerson } from "@/lib/supabase/auth-guard"
import { listAccounts, createAccount, ServiceError } from "@/lib/services/erp-accounting-service"

const GST_ACCOUNTS = ["CGST", "SGST", "IGST"] as const

type AccountRow = Awaited<ReturnType<typeof listAccounts>>[number]
const shape = (a: AccountRow) => ({ id: a.id, accountName: a.accountName, accountNumber: a.accountNumber })
const isTaxAccount = (a: AccountRow) => a.accountType === "tax" && !a.isGroup

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return requireOrg(ctx)!

  try {
    const accounts = await listAccounts({ orgId: ctx.orgId })
    return NextResponse.json({ taxAccounts: accounts.filter(isTaxAccount).map(shape) })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa tax accounts list error:", error)
    return NextResponse.json({ error: "Failed to fetch tax accounts" }, { status: 500 })
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
    const existing = await listAccounts({ orgId: ctx.orgId })
    const have = new Set(existing.filter(isTaxAccount).map((a) => a.accountName.trim().toUpperCase()))
    const created: ReturnType<typeof shape>[] = []
    for (const name of GST_ACCOUNTS) {
      if (have.has(name)) continue
      const account = await createAccount(
        { orgId: ctx.orgId, userId: acting.person.id, dbUser: acting.person },
        { accountName: name, rootType: "liability", accountType: "tax" }
      )
      created.push(shape(account))
    }
    const all = [...existing.filter(isTaxAccount).map(shape), ...created]
    return NextResponse.json({ taxAccounts: all, created: created.length }, { status: created.length ? 201 : 200 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa tax accounts seed error:", error)
    return NextResponse.json({ error: "Failed to set up tax accounts" }, { status: 500 })
  }
}
