import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { createChainVersion, getChainVersionHistory } from "@/lib/services/dynamic-chain-directory-service"

// tree4-unified U-D6.B2.S1's "version control" -- see route.ts's header for
// why this route exists (createChainVersion()/getChainVersionHistory()
// previously had zero real callers).
//
// GET: full version lineage, oldest first (getChainVersionHistory already
// walks previousVersionId back to the first version).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ history: [] })

  const { id } = await params
  try {
    const history = await getChainVersionHistory(orgId, id)
    return NextResponse.json({ history })
  } catch (error) {
    console.error("Dynamic chain version history error:", error)
    return NextResponse.json({ error: "Failed to fetch chain version history" }, { status: 500 })
  }
}

// POST: creates a new version of an existing chain (retires the old row,
// links previousVersionId) -- mirrors createChainVersion()'s own partial-
// update shape, only the fields present in the body are overridden.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  const { id } = await params
  try {
    const body = await request.json().catch(() => ({}))
    const result = await createChainVersion(orgId, dbUser.id, id, {
      description: body.description,
      moduleRef: body.moduleRef,
      linkedModuleRefs: body.linkedModuleRefs,
      businessRules: body.businessRules,
      permissions: body.permissions,
      workflowRef: body.workflowRef,
      aiBehaviorRef: body.aiBehaviorRef,
      reportsKpisSlas: body.reportsKpisSlas,
    })
    if (!result.created) return NextResponse.json({ error: "Chain not found" }, { status: 404 })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    console.error("Dynamic chain version creation error:", error)
    return NextResponse.json({ error: "Failed to create chain version" }, { status: 500 })
  }
}
