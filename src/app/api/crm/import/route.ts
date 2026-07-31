/**
 * POST /api/crm/import — multipart upload -> validate -> insert into
 * crmLeads/crmOpportunities/crmAccounts/crmContacts, tracked via the
 * existing ingestionBatches table. Same shape as /api/ingest's own upload
 * route (formData -> Buffer -> service call -> batch summary).
 * GET  /api/crm/import — list this org's CRM import batches (optionally
 * filtered by ?entity=).
 */
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { importCrmRecords, listCrmImportBatches, isCrmImportEntity, ServiceError } from "@/lib/services/crm-import-export-service"

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

export async function POST(req: NextRequest) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "Organisation not set up" }, { status: 400 })

  try {
    const formData = await req.formData()
    const file = formData.get("file") as File | null
    const entity = formData.get("entity") as string | null

    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })
    if (!entity || !isCrmImportEntity(entity)) {
      return NextResponse.json({ error: "entity is required and must be one of: crm_lead, crm_opportunity, crm_account, crm_contact" }, { status: 400 })
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `File too large. Maximum size is 10 MB. Your file: ${(file.size / 1024 / 1024).toFixed(1)} MB` }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const result = await importCrmRecords({ orgId, userId: dbUser.id, dbUser }, entity, { fileName: file.name, buffer, mimeType: file.type })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error("CRM import error:", err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ batches: [] })

  const entityParam = req.nextUrl.searchParams.get("entity")
  if (entityParam && !isCrmImportEntity(entityParam)) {
    return NextResponse.json({ error: "Invalid entity filter" }, { status: 400 })
  }

  const batches = await listCrmImportBatches({ orgId }, entityParam ?? undefined)
  return NextResponse.json({
    batches: batches.map((b) => ({
      id: b.id, fileName: b.fileName, targetEntity: b.targetEntity, status: b.status,
      totalRows: b.totalRows, confirmedCount: b.confirmedCount, rejectedCount: b.rejectedCount,
      uploadedBy: b.uploadedBy.name, createdAt: b.createdAt.toISOString(),
    })),
  })
}
