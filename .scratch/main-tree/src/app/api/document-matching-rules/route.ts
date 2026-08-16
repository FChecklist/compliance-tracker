import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listMatchingRules, createMatchingRule, ServiceError } from "@/lib/services/document-classification-service"

// Priority 13 (Document Correspondent/Type Auto-Classification): org-scoped
// matching rules (any_word/all_words/exact/regex against filename/extracted
// text) that auto-tag a document's category/correspondent/tags on ingest.
// See document-classification-service.ts for the matching logic and
// src/app/api/documents/route.ts + document-extraction-service.ts for where
// these rules actually get applied.
export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ rules: [] })

  try {
    const rules = await listMatchingRules({ orgId })
    return NextResponse.json({ rules })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Matching rules list error:", error)
    return NextResponse.json({ error: "Failed to fetch matching rules" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await createMatchingRule({ orgId }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Matching rule create error:", error)
    return NextResponse.json({ error: "Failed to create matching rule" }, { status: 500 })
  }
}
