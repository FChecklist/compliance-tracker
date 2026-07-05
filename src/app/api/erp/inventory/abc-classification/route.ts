import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listAbcClassifications, computeAbcClassification, ServiceError } from "@/lib/services/erp-inventory-planning-service"

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ classifications: [] })

  try {
    const classifications = await listAbcClassifications({ orgId })
    return NextResponse.json({ classifications })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("ABC classification list error:", error)
    return NextResponse.json({ error: "Failed to fetch ABC classifications" }, { status: 500 })
  }
}

export async function POST() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const classified = await computeAbcClassification({ orgId })
    return NextResponse.json({ classified })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("ABC classification compute error:", error)
    return NextResponse.json({ error: "Failed to compute ABC classification" }, { status: 500 })
  }
}
