import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { projects } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq } from "drizzle-orm"
import { canReadProject } from "@/lib/services/product-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const project = await withTenantContext({ orgId }, (tenantDb) =>
      tenantDb.query.projects.findFirst({ where: and(eq(projects.id, id), eq(projects.orgId, orgId)) })
    )
    // Task #47: a Private project 404s for anyone but an admin or its own
    // leadUserId -- same "not found" response as a genuinely missing id, so
    // an unauthorized user learns nothing about whether it exists.
    if (!project || !canReadProject(project, dbUser)) return NextResponse.json({ error: "Project not found" }, { status: 404 })

    return NextResponse.json({
      id: project.id, name: project.name, description: project.description,
      issuePrefix: project.issuePrefix, leadUserId: project.leadUserId,
      startDate: project.startDate, targetDate: project.targetDate, healthStatus: project.healthStatus,
      status: project.status, accessLevel: project.accessLevel,
      rollupPercentage: project.rollupPercentage, customTabs: project.customTabs,
    })
  } catch (error) {
    console.error("Project get error:", error)
    return NextResponse.json({ error: "Failed to fetch project" }, { status: 500 })
  }
}
