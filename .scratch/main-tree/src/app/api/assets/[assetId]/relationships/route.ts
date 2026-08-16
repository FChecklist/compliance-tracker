// Priority 3 UMR dispatch (agent 3): the real, live proof that
// entity-graph-service.ts isn't dead code anymore. GET returns the full
// related-asset graph for one asset (asset-relationship-service.ts's
// getRelatedAssets, itself a thin join over entity-graph-service's
// getNeighbors); POST is the first production write path
// entity-graph-service's createRelationship() has ever had.
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getRelatedAssets, linkAssetRelationship } from "@/lib/services/asset-relationship-service"
import { ServiceError } from "@/lib/services/compliance-service"

export async function GET(_request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { assetId } = await params
    const related = await getRelatedAssets({ orgId, userId: dbUser.id }, assetId)
    return NextResponse.json({ related })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Asset relationships fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch asset relationships" }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { assetId } = await params
    const body = await request.json().catch(() => ({}))
    const relatedAssetId = body?.relatedAssetId
    const relationshipType = body?.relationshipType ?? "depends_on"

    if (!relatedAssetId || typeof relatedAssetId !== "string") {
      return NextResponse.json({ error: "relatedAssetId is required" }, { status: 400 })
    }
    if (typeof relationshipType !== "string" || !relationshipType.trim()) {
      return NextResponse.json({ error: "relationshipType must be a non-empty string" }, { status: 400 })
    }

    const edge = await linkAssetRelationship({ orgId, userId: dbUser.id }, assetId, relatedAssetId, relationshipType)
    return NextResponse.json(edge, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Asset relationship create error:", error)
    return NextResponse.json({ error: "Failed to create asset relationship" }, { status: 500 })
  }
}
