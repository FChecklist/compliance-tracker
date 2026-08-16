import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listProjects, createProject, ServiceError } from "@/lib/services/product-service"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ projects: [] })

  try {
    const { id } = await params
    const result = await listProjects({ orgId }, id)
    return NextResponse.json({
      projects: result.map((p) => ({ id: p.id, productId: p.productId, name: p.name, description: p.description, clientId: p.clientId, isActive: p.isActive, createdAt: p.createdAt.toISOString() })),
    })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Projects list error:", error)
    return NextResponse.json({ error: "Failed to fetch projects" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const body = await request.json()
    const result = await createProject({ orgId, userId: dbUser.id, dbUser }, id, body)
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Project create error:", error)
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 })
  }
}
