// R48/R64 gap-closure (2026-08-30): the v1 (API-key/PROJEXA-facing) surface
// had GET/DELETE for a single BOQ (Wave 127) but no submit-for-approval
// action -- only the session-cookie-only /api/construction/boq/[id]/submit
// existed. Discovered while converting PROJEXA's own Scope screen to a real
// Object Page (the owner's own explicit request: real screens need real
// status-transition actions, not a dead end). Same service call, same
// pattern as this route's sibling v1/construction/boq/[id]/route.ts.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { submitBoq, ServiceError } from "@/lib/services/construction-boq-service"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const roleCheck = requireRoleOrScope(ctx, "senior_professional")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const boq = await submitBoq({ orgId: ctx.orgId }, id)
    return NextResponse.json(boq)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction BOQ submit error:", error)
    return NextResponse.json({ error: "Failed to submit BOQ" }, { status: 500 })
  }
}
