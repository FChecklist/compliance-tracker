import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { legalOpinions } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  const { id } = await ctx.params
  const opinion = await withTenantContext({ orgId }, (db) => db.query.legalOpinions.findFirst({ where: and(eq(legalOpinions.id, id), eq(legalOpinions.orgId, orgId)) }))
  if (!opinion) return NextResponse.json({ error: "Opinion not found" }, { status: 404 })
  return NextResponse.json({ opinion })
}
