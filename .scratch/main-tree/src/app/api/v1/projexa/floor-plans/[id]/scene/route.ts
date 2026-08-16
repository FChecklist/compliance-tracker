import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { getFloorPlanScene, ServiceError } from "@/lib/services/interior-floorplan-service"

type RouteContext = { params: Promise<{ id: string }> }

// Purpose-built payload for the 3D walkthrough client: rooms as polygons
// with resolved materials, placements as footprint boxes. All geometry
// derivation happens server-side (see getFloorPlanScene) so the
// react-three-fiber client only renders, never recomputes.
export async function GET(request: NextRequest, { params }: RouteContext) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const { id } = await params
    const scene = await getFloorPlanScene({ orgId: ctx.orgId }, id)
    return NextResponse.json(scene)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 projexa floor-plan scene error:", error)
    return NextResponse.json({ error: "Failed to build scene" }, { status: 500 })
  }
}
