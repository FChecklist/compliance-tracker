import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listEmployees, ServiceError } from "@/lib/services/hr-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ employees: [] })

  try {
    const employees = await listEmployees({ orgId })
    return NextResponse.json({ employees })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Employees list error:", error)
    return NextResponse.json({ error: "Failed to fetch employees" }, { status: 500 })
  }
}
