import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listPaths, createPath, ServiceError } from "@/lib/services/training-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ paths: [] })

  try {
    const paths = await listPaths({ orgId })
    return NextResponse.json({ paths })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Training paths list error:", error)
    return NextResponse.json({ error: "Failed to fetch training paths" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "manager")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const body = await request.json()
    const path = await createPath({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(path, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Training path create error:", error)
    return NextResponse.json({ error: "Failed to create training path" }, { status: 500 })
  }
}
