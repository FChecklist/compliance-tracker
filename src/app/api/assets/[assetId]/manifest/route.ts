// Priority 3 UMR dispatch (agent 3): the Asset Manifest -- the
// self-describing "identity card" the Owner's spec asks every asset to
// carry: "What am I? Why do I exist? Who can use me? What do I depend on?
// What depends on me?" Every field below is real data already sitting on
// platform_assets (Priority 3's UMR schema, subagent/umr-core) or the
// relationship graph (getRelatedAssets(), this same dispatch's part 1) --
// nothing here is a stub or an invented field.
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getAssetByAssetId } from "@/lib/services/asset-registry-service"
import { getRelatedAssets } from "@/lib/services/asset-relationship-service"
import { ServiceError } from "@/lib/services/compliance-service"

export async function GET(_request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { assetId } = await params
    const asset = await getAssetByAssetId(assetId)
    if (!asset) return NextResponse.json({ error: `Asset ${assetId} not found` }, { status: 404 })

    // "What am I connected to?" -- real graph traversal, not a stub. Each
    // row carries relationshipType + direction, which is what lets a
    // single call answer both "what do I depend on" (direction=outgoing,
    // relationshipType=depends_on) and "what depends on me"
    // (direction=incoming, relationshipType=depends_on) without a second
    // top-level field having to be invented for the reverse direction.
    const related = await getRelatedAssets({ orgId, userId: dbUser.id }, assetId)

    const manifest = {
      asset_id: asset.assetId,
      asset_type: asset.assetType,
      module: asset.module,
      purpose: asset.purpose,
      owner: asset.ownerId ?? "System",
      permissions: asset.permissions ?? [],
      tags: asset.tags ?? [],
      // The denormalized fast-path array (see asset-relationship-service.ts's
      // linkAssetDependency() for why it's maintained alongside the graph
      // edge) -- a single-row read, not a join, for the common case of
      // "what does this asset depend on".
      dependencies: asset.dependencies ?? [],
      // The full graph view -- both directions, every relationship type,
      // real data from getRelatedAssets(), not a stub.
      related_assets: related.map((r) => ({
        asset_id: r.assetId,
        name: r.name,
        asset_type: r.assetType,
        relationship_type: r.relationshipType,
        // 'outgoing' = this asset -> r (e.g. this asset depends_on r)
        // 'incoming' = r -> this asset (e.g. r depends_on this asset --
        // this is what answers "what depends on me?")
        direction: r.direction,
      })),
      status: asset.status,
      version: asset.version,
    }

    return NextResponse.json(manifest)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Asset manifest fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch asset manifest" }, { status: 500 })
  }
}
