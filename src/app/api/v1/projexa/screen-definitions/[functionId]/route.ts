// R43 seq2: the Bearer-key-reachable twin that lets PROJEXA (and any other
// brand) resolve a screen_definitions row at request time, same
// requireAuthOrApiKey pattern every other /api/v1/projexa/* route uses (see
// vendors/route.ts). Calls the EXISTING resolveScreenDefinition() from
// src/lib/screens/resolve-definition.ts (R42 seq20/M28/M31 S1) -- this
// route's only job is exposing that resolver across the repo boundary, not
// re-implementing it. No caching here beyond fetch's own `cache: "no-store"`
// on the caller side -- the whole point of the registry model is that a
// DB-only edit shows up on next page load with no redeploy.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { resolveScreenDefinition } from "@/lib/screens/resolve-definition"

export async function GET(request: NextRequest, { params }: { params: Promise<{ functionId: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const { functionId } = await params
  try {
    const definition = await resolveScreenDefinition(ctx.orgId, functionId)
    if (!definition) return NextResponse.json({ error: `No screen_definitions row for ${functionId}` }, { status: 404 })
    return NextResponse.json(definition)
  } catch (error) {
    console.error(`v1 projexa screen-definitions ${functionId} error:`, error)
    return NextResponse.json({ error: "Failed to resolve screen definition" }, { status: 500 })
  }
}
