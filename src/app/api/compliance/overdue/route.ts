import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireOrg, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { syncOverdue } from "@/lib/services/compliance-service"

export async function POST(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  // Matches compliance/route.ts and compliance/[id]/route.ts's PATCH floor
  // -- this is a bulk status-update mutation across every overdue item in
  // the org, the same weight as updating a single item, and previously had
  // no role/scope restriction beyond org membership.
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr
  if (!ctx.orgId) return requireOrg(ctx)!

  try {
    const result = await syncOverdue({ orgId: ctx.orgId })
    return NextResponse.json(result)
  } catch (error) {
    console.error("Overdue sync error:", error)
    return NextResponse.json({ error: "Failed to sync overdue status" }, { status: 500 })
  }
}
