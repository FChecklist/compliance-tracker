// VERIDIAN Review Framework gap-closure, "Data Import/Export Template
// Fidelity": no bulk import path existed for leads. Follows
// /api/compliance/import's own multipart-form-data + CSV-text shape.
import { NextRequest, NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { importLeadsCsv, ServiceError } from "@/lib/services/crm-service"

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  const roleCheck = requireRole(dbUser, "member")
  if (roleCheck) return roleCheck

  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 })

    const text = await file.text()
    const result = await importLeadsCsv({ orgId, userId: dbUser.id }, text)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("CRM leads import error:", error)
    return NextResponse.json({ error: "Import failed" }, { status: 500 })
  }
}
