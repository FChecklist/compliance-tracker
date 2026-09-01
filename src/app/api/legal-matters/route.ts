import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { listMatters, createMatter, ServiceError } from "@/lib/services/legal-matter-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ matters: [] })

  // R66 code-quality fix: GET had no try/catch while POST in this same
  // file does. Matching POST's own error-handling style below.
  try {
    const matters = await listMatters({ orgId })
    return NextResponse.json({ matters })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Legal matters list error:", error)
    return NextResponse.json({ error: "Failed to fetch legal matters" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const body = await request.json()
    const matter = await createMatter({ orgId, userId: dbUser.id, dbUser }, body)
    return NextResponse.json(matter, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Legal matter create error:", error)
    return NextResponse.json({ error: "Failed to create legal matter" }, { status: 500 })
  }
}
