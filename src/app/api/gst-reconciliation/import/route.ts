import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { importFile, listBatches, ServiceError } from "@/lib/services/gst-reconciliation-service"
import type { GstSourceType } from "@/lib/gst/adapters"

const MAX_FILE_SIZE = 10 * 1024 * 1024
const VALID_SOURCE_TYPES: GstSourceType[] = ["excel_generic", "csv_generic", "tally_xml", "busy", "zoho_books"]
const VALID_DIRECTIONS = ["sales", "purchase", "gstr2b"] as const

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const sourceType = formData.get("sourceType") as string | null
    const direction = formData.get("direction") as string | null
    const period = formData.get("period") as string | null
    const clientId = formData.get("clientId") as string | null

    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "File too large (max 10 MB)" }, { status: 400 })
    if (!sourceType || !VALID_SOURCE_TYPES.includes(sourceType as GstSourceType)) return NextResponse.json({ error: `sourceType must be one of ${VALID_SOURCE_TYPES.join(", ")}` }, { status: 400 })
    if (!direction || !VALID_DIRECTIONS.includes(direction as (typeof VALID_DIRECTIONS)[number])) return NextResponse.json({ error: `direction must be one of ${VALID_DIRECTIONS.join(", ")}` }, { status: 400 })
    if (!period || !/^\d{4}-\d{2}$/.test(period)) return NextResponse.json({ error: "period must be in YYYY-MM format" }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const result = await importFile(
      { orgId, userId: dbUser.id, dbUser },
      { sourceType: sourceType as GstSourceType, direction: direction as (typeof VALID_DIRECTIONS)[number], period, clientId, fileName: file.name, buffer, mimeType: file.type }
    )
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("GST import error:", error)
    return NextResponse.json({ error: "Failed to import file" }, { status: 500 })
  }
}

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ batches: [] })

  const batches = await listBatches({ orgId })
  return NextResponse.json({ batches })
}
