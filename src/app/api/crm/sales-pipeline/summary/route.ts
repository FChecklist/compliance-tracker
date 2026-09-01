import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { generateSalesPipelineSummary, ServiceError } from "@/lib/services/crm-service"
import { resolveViewerScope } from "../route"

// VERIDIAN Review Framework gap-closure (2026-08-07, "Sales Dashboard"
// wave): "AI Copilot / Worker Agent Integration Depth" -- on-demand AI
// weekly narrative summary, same role scoping as ../route.ts's GET. POST
// (not GET) since this triggers a real LLM call, matching the existing
// score-lead/analyze-opportunity route convention elsewhere in this codebase.
export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const requestedOwnerId = new URL(request.url).searchParams.get("ownerId")
    const restrictToOwnerId = resolveViewerScope(dbUser, requestedOwnerId)
    const summary = await generateSalesPipelineSummary({ orgId, userId: dbUser.id }, { restrictToOwnerId })
    return NextResponse.json(summary)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM sales pipeline summary error:", error)
    return NextResponse.json({ error: "Failed to generate sales pipeline summary" }, { status: 500 })
  }
}
