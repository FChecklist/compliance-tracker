/** GET /api/crm/export?entity=crm_lead — CSV export of this org's CRM records for the given entity. */
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { exportCrmRecords, isCrmImportEntity, ServiceError } from "@/lib/services/crm-import-export-service"

export async function GET(req: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  const entity = req.nextUrl.searchParams.get("entity")
  if (!entity || !isCrmImportEntity(entity)) {
    return NextResponse.json({ error: "entity is required and must be one of: crm_lead, crm_opportunity, crm_account, crm_contact" }, { status: 400 })
  }

  try {
    const { fileName, csv } = await exportCrmRecords({ orgId }, entity)
    return new NextResponse(csv, {
      status: 200,
      headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="${fileName}"` },
    })
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }
}
