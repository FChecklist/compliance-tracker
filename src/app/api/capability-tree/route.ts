import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { buildCapabilityTree } from "@/lib/services/capability-tree-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ nodes: [] })

  try {
    const nodes = await buildCapabilityTree({ orgId })
    return NextResponse.json({ nodes })
  } catch (error) {
    console.error("Capability tree error:", error)
    return NextResponse.json({ error: "Failed to build capability tree" }, { status: 500 })
  }
}
