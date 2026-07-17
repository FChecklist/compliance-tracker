import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { getMyTraining, ServiceError } from "@/lib/services/training-service"

export async function GET() {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ enrollments: [], pathAssignments: [] })

  try {
    const data = await getMyTraining({ orgId, userId: dbUser.id })
    return NextResponse.json(data)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("My training error:", error)
    return NextResponse.json({ error: "Failed to fetch your training" }, { status: 500 })
  }
}
