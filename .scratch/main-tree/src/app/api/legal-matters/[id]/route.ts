import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { getMatterDetail, closeMatter, ServiceError } from "@/lib/services/legal-matter-service"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const matter = await getMatterDetail({ orgId }, id)
    return NextResponse.json(matter)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Legal matter detail error:", error)
    return NextResponse.json({ error: "Failed to fetch legal matter" }, { status: 500 })
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })
  const roleCheck = requireRole(dbUser, "manager")
  if (roleCheck) return roleCheck

  try {
    const { id } = await params
    const body = await request.json()
    if (!body.closedDate) return NextResponse.json({ error: "closedDate is required" }, { status: 400 })
    const matter = await closeMatter({ orgId }, id, body.closedDate)
    return NextResponse.json(matter)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Legal matter close error:", error)
    return NextResponse.json({ error: "Failed to close legal matter" }, { status: 500 })
  }
}
