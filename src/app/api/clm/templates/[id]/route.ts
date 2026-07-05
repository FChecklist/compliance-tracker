import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getContractTemplate, ServiceError } from "@/lib/services/erp-contract-service"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const template = await getContractTemplate({ orgId }, id)
    return NextResponse.json(template)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Contract template fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch template" }, { status: 500 })
  }
}
