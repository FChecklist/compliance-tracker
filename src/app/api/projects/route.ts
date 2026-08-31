import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listAllProjectsForOrg, createProjectDirect, ServiceError } from "@/lib/services/product-service"

export async function GET() {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ projects: [] })

  try {
    // R48 gap-closure (2026-08-30, F002) -- see listAllProjectsForOrg's own
    // comment for the full reasoning. Narrowed only for the exact "manager"/
    // "senior_professional" rank this business_rule names; branch_manager+
    // keep org-wide oversight visibility, and member/viewer are left
    // unfiltered too since this schema has no project-membership concept
    // for them beyond leadUserId (a real, documented limitation, not silently
    // papered over -- see R48_PROGRESS.md's F002 entry).
    const scopeToLead = dbUser && (dbUser.role === "manager" || dbUser.role === "senior_professional") ? dbUser.id : undefined
    const result = await listAllProjectsForOrg({ orgId }, scopeToLead)
    return NextResponse.json({
      projects: result.map((p) => ({
        id: p.id, name: p.name, description: p.description, clientId: p.clientId,
        issuePrefix: p.issuePrefix, issueSequence: p.issueSequence, leadUserId: p.leadUserId,
        startDate: p.startDate, targetDate: p.targetDate, healthStatus: p.healthStatus,
        isActive: p.isActive, createdAt: p.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Projects list error:", error)
    return NextResponse.json({ error: "Failed to fetch projects" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const result = await createProjectDirect({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Project create error:", error)
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 })
  }
}
