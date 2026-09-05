import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listEmailIntelligenceItems, analyzeInboundEmail, ServiceError } from "@/lib/services/email-intelligence-service"

// D21.B4.S1: no live "email arrives" trigger exists in this codebase yet --
// this route is the real callable wiring point a future inbox-sync feature
// (or a manual "paste this email" action) submits an email's content to.
export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ items: [] })

  try {
    const items = await listEmailIntelligenceItems({ orgId })
    return NextResponse.json({ items })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Email intelligence list error:", error)
    return NextResponse.json({ error: "Failed to fetch email intelligence items" }, { status: 500 })
  }
}

// R75 Part 2 Phase 5 (G3-email-conv): had NO gate beyond requireAuth() --
// any authenticated org member could submit arbitrary raw email content to
// be run through the org's configured LLM and persisted. This route's own
// analyzeInboundEmail() header comment already names its real sibling
// pattern: "the SAME pattern already proven for... documents (documents/
// extract)" -- and POST /api/documents/extract IS actually gated
// (requireRole(dbUser, "team_member")), unlike the OTHER named sibling
// (veri-meetings' generate-intelligence route, which has this exact same
// no-rank-gate gap and is not a real precedent). Matched to the one real,
// already-gated analog: submit-content-for-AI-analysis at "team_member".
export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "team_member")
  if (roleCheck) return roleCheck

  try {
    const body = await request.json()
    const result = await analyzeInboundEmail({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Email intelligence analyze error:", error)
    return NextResponse.json({ error: "Failed to analyze email" }, { status: 500 })
  }
}
