import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listAccountsPaged, createAccount, ServiceError } from "@/lib/services/crm-accounts-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ items: [], total: 0, page: 1, pageSize: 25 })

  try {
    const { searchParams } = new URL(request.url)
    const result = await listAccountsPaged(
      { orgId },
      {
        search: searchParams.get("search") ?? undefined,
        lifecycleStage: searchParams.get("lifecycleStage") ?? undefined,
        ownerId: searchParams.get("ownerId") ?? undefined,
        parentAccountId: searchParams.get("parentAccountId") ?? undefined,
        companyId: searchParams.get("companyId") ?? undefined,
        page: searchParams.get("page") ? Number(searchParams.get("page")) : undefined,
        pageSize: searchParams.get("pageSize") ? Number(searchParams.get("pageSize")) : undefined,
      }
    )
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM accounts list error:", error)
    return NextResponse.json({ error: "Failed to fetch accounts" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const account = await createAccount({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(account, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM account create error:", error)
    return NextResponse.json({ error: "Failed to create account" }, { status: 500 })
  }
}
