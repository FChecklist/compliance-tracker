import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listFindings } from "@/lib/services/gst-reconciliation-service"

export async function GET(_req: NextRequest, ctx: { params: Promise<{ batchId: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ findings: [] })

  const { batchId } = await ctx.params
  const findings = await listFindings({ orgId }, batchId)
  return NextResponse.json({ findings })
}
