import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { addBankAccount, listBankAccounts, ServiceError } from "@/lib/services/erp-vendor-master-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ bankAccounts: [] })

  try {
    const { id } = await params
    const bankAccounts = await listBankAccounts({ orgId }, id)
    return NextResponse.json({ bankAccounts })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Supplier bank accounts list error:", error)
    return NextResponse.json({ error: "Failed to fetch bank accounts" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "member")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const account = await addBankAccount({ orgId, userId: dbUser.id }, id, {
      accountHolderName: body.accountHolderName, bankName: body.bankName, accountNumber: body.accountNumber,
      ifscCode: body.ifscCode, accountType: body.accountType, isPrimary: body.isPrimary,
    })
    return NextResponse.json(account, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Supplier bank account create error:", error)
    return NextResponse.json({ error: "Failed to add bank account" }, { status: 500 })
  }
}
