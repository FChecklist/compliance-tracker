import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listCorrespondents, createCorrespondent, ServiceError } from "@/lib/services/document-classification-service"

// Priority 13 (Document Correspondent/Type Auto-Classification): a real,
// org-managed correspondent register that document_matching_rules can
// target and documents.correspondentId can point at.
export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ correspondents: [] })

  try {
    const correspondents = await listCorrespondents({ orgId })
    return NextResponse.json({ correspondents })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Correspondents list error:", error)
    return NextResponse.json({ error: "Failed to fetch correspondents" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  // R75 Part 2 Phase 5 (G5 misc gap-closure, 2026-09-05): this had NO role
  // gate at all -- any authenticated org member could add to the org's
  // correspondent register. Matches this exact resource's own sibling
  // DELETE (./[id]/route.ts), which already requires "branch_manager" --
  // creating an entry in this register should not sit at a lower bar than
  // removing one.
  const roleCheck = requireRole(dbUser, "branch_manager")
  if (roleCheck) return roleCheck

  try {
    const body = await request.json()
    const result = await createCorrespondent({ orgId }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Correspondent create error:", error)
    return NextResponse.json({ error: "Failed to create correspondent" }, { status: 500 })
  }
}
