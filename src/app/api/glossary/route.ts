import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listGlossaryTerms, createGlossaryTerm, ServiceError } from "@/lib/services/glossary-service"
import { serviceErrorBody } from "@/lib/services/compliance-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ terms: [] })

  try {
    const terms = await listGlossaryTerms({ orgId })
    return NextResponse.json({ terms })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json(serviceErrorBody(error), { status: error.status })
    console.error("Glossary list API error:", error)
    return NextResponse.json({ error: "Failed to fetch glossary terms" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  // R75 Part 2 Phase 5 (G5 misc gap-closure, 2026-09-05): this org-wide
  // reference-data picklist had NO role gate at all -- any authenticated
  // org member of any rank could add to it. Same "master-data
  // configuration = manager" bar and shape as this codebase's own sibling
  // org-wide picklist gates (crm.pipeline_stages.manage,
  // crm.lost_reasons.manage in permission-service.ts), applied here via a
  // direct requireRole() call (glossary is not an ERP/CRM action, so it
  // doesn't warrant its own ERP_ACTION_ROLES registry entry) rather than
  // introducing a new registry key for a single non-ERP resource.
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const body = await request.json()
    const term = await createGlossaryTerm({ orgId }, body)
    return NextResponse.json(term, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json(serviceErrorBody(error), { status: error.status })
    console.error("Glossary create API error:", error)
    return NextResponse.json({ error: "Failed to create glossary term" }, { status: 500 })
  }
}
