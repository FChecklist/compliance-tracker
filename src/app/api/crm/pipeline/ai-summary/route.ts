import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getPipelineAiSummary, ServiceError } from "@/lib/services/crm-service"

export async function POST() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const summary = await getPipelineAiSummary({ orgId, userId: dbUser.id })
    return NextResponse.json(summary)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Pipeline AI summary error:", error)
    return NextResponse.json({ error: "Failed to generate pipeline AI summary" }, { status: 500 })
  }
}
