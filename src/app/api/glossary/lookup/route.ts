// AI Architecture / Explainability & Transparency gap-closure (2026-07-18):
// the real call site for GlossaryTermTooltip's hover/inline explainer --
// looks up one term (or alias) by exact text, distinct from the full-list
// GET /api/glossary above.
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { findGlossaryTerm } from "@/lib/services/glossary-service"

export async function GET(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ term: null })

  const term = request.nextUrl.searchParams.get("term") ?? ""
  try {
    const match = await findGlossaryTerm({ orgId }, term)
    return NextResponse.json({ term: match })
  } catch (error) {
    console.error("Glossary lookup API error:", error)
    return NextResponse.json({ term: null })
  }
}
