// AI Copilot / Worker Agent Integration Depth gap-closure (VERIDIAN Review
// Framework "Accounts & Contacts"): thin route over
// crm-accounts-service.ts#analyzeAccountHealth, same shape as
// src/app/api/crm/opportunities/[id]/analyze/route.ts's Wave 75 precedent.
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { analyzeAccountHealth, ServiceError } from "@/lib/services/crm-accounts-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(_request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const account = await analyzeAccountHealth({ orgId, userId: dbUser.id, dbUser }, id)
    return NextResponse.json(account)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM account analyze error:", error)
    return NextResponse.json({ error: "Failed to analyze account" }, { status: 500 })
  }
}
