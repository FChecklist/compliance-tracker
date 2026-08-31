// Real-screen conversion (2026-08-30): single-application GET for the
// Application Object Page.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireOrg } from "@/lib/supabase/auth-guard"
import { getApplication, ServiceError } from "@/lib/services/recruitment-service"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return requireOrg(ctx)!

  try {
    const { id } = await params
    const application = await getApplication({ orgId: ctx.orgId }, id)
    return NextResponse.json(application)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa application get error:", error)
    return NextResponse.json({ error: "Failed to fetch application" }, { status: 500 })
  }
}
