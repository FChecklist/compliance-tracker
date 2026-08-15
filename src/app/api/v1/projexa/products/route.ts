import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { listActiveProducts } from "@/lib/services/construction-dashboard-service"

// Feeds the Product picker in PROJEXA's Create Project dialog -- a Project
// row requires a productId FK (schema.ts), so PROJEXA needs to see the
// org's real product list before it can create one.
export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const products = await listActiveProducts({ orgId: ctx.orgId })
    return NextResponse.json({ products })
  } catch (error) {
    console.error("v1 projexa products list error:", error)
    return NextResponse.json({ error: "Failed to list products" }, { status: 500 })
  }
}
