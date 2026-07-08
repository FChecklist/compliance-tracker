import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { mcaFilings } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  const { id } = await ctx.params
  const filing = await withTenantContext({ orgId }, (db) => db.query.mcaFilings.findFirst({ where: and(eq(mcaFilings.id, id), eq(mcaFilings.orgId, orgId)) }))
  if (!filing) return NextResponse.json({ error: "Filing not found" }, { status: 404 })
  return NextResponse.json({ filing })
}
