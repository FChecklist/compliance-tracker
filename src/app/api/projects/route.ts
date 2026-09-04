import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listAllProjectsForOrg, createProjectDirect, ServiceError } from "@/lib/services/product-service"

export async function GET() {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ projects: [] })

  try {
    // R48 gap-closure (2026-08-30, F002) + Task #47 Private/Public gate --
    // see listAllProjectsForOrg's own comment for the full reasoning on both.
    const result = await listAllProjectsForOrg({ orgId }, dbUser)
    return NextResponse.json({
      projects: result.map((p) => ({
        id: p.id, name: p.name, description: p.description, clientId: p.clientId,
        issuePrefix: p.issuePrefix, issueSequence: p.issueSequence, leadUserId: p.leadUserId,
        startDate: p.startDate, targetDate: p.targetDate, healthStatus: p.healthStatus,
        isActive: p.isActive, status: p.status, accessLevel: p.accessLevel,
        rollupPercentage: p.rollupPercentage, customTabs: p.customTabs,
        createdAt: p.createdAt.toISOString(),
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

  const roleCheck = requireRole(dbUser, "admin")
  if (roleCheck) return roleCheck

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
