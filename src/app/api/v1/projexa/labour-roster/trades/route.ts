// R67 D-34 (R-085): the trades the roster form offers.
//
// Trade was a free-text input, so the same job arrived as "Mason", "mason",
// "MASON" and "Masonry" and every trade-wise total downstream split four ways.
// This returns the seed vocabulary merged with whatever this org has actually
// used, so turning the input into a Select never hides a trade someone already
// typed.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { listRosterTrades, ServiceError } from "@/lib/services/construction-labour-service"

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  const roleErr = requireRoleOrScope(ctx, "member", "read")
  if (roleErr) return roleErr
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const trades = await listRosterTrades({ orgId: ctx.orgId })
    return NextResponse.json({ trades })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa labour-roster trades error:", error)
    return NextResponse.json({ error: "Failed to load the trade list" }, { status: 500 })
  }
}
