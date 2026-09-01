// Real-screen conversion (2026-08-30): single-job-opening GET for the Job
// Opening Object Page.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireOrg } from "@/lib/supabase/auth-guard"
import { getJobOpening, ServiceError } from "@/lib/services/recruitment-service"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  try {
    const { id } = await params
    const opening = await getJobOpening({ orgId: ctx.orgId }, id)
    return NextResponse.json(opening)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa job opening get error:", error)
    return NextResponse.json({ error: "Failed to fetch job opening" }, { status: 500 })
  }
}
