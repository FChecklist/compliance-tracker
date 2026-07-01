/**
 * POST /api/ingest
 * Accepts multipart/form-data with a file field.
 * Parses → AI extracts → validates → stores in staging tables → returns batchId.
 * Node.js runtime — uses pdf-parse and xlsx which need Node.js Buffer.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/supabase/auth-guard'
import { ingestionBatches, ingestionItems } from '@/lib/db'
import { withTenantContext } from '@/lib/db/tenant-scoped'
import { eq } from 'drizzle-orm'
import { parseFile } from '@/lib/ingest/parser'
import { extractComplianceItems } from '@/lib/ingest/extractor'
import { validateItems, summariseValidation } from '@/lib/ingest/validator'
import { createId } from '@paralleldrive/cuid2'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

export async function POST(req: NextRequest) {
  const { response, orgId, dbUser } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: 'Organisation not set up' }, { status: 400 })

  let batchId: string | null = null

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `File too large. Maximum size is 10 MB. Your file: ${(file.size / 1024 / 1024).toFixed(1)} MB` }, { status: 400 })
    }

    // Create batch record immediately — status: processing
    batchId = createId()
    await withTenantContext({ orgId }, (db) =>
      db.insert(ingestionBatches).values({
        id: batchId!,
        fileName: file.name,
        fileType: file.name.split('.').pop()?.toLowerCase() ?? 'unknown',
        fileSizeBytes: file.size,
        orgId,
        uploadedById: dbUser.id,
        status: 'processing',
      })
    )

    // Parse file
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const parsed = await parseFile(buffer, file.name, file.type)

    // AI extraction
    const extracted = await extractComplianceItems(parsed)

    // Validate (resolve departments, users, check duplicates)
    const validated = await validateItems(extracted.items, orgId)
    const summary = summariseValidation(validated)

    await withTenantContext({ orgId }, async (db) => {
      // Store items in staging table
      if (validated.length > 0) {
        await db.insert(ingestionItems).values(
          validated.map(item => ({
            id: createId(),
            batchId: batchId!,
            sourceRow: item.sourceRow,
            title: item.title,
            complianceType: item.complianceType,
            dueDate: item.dueDate,
            status: item.status ?? 'pending',
            priority: item.priority ?? 'medium',
            departmentName: item.departmentName,
            departmentId: item.departmentId,
            assignedToName: item.assignedToName,
            assignedToId: item.assignedToId,
            description: item.description,
            extraData: JSON.stringify(item.extraData ?? {}),
            confidence: String(item.confidence),
            warnings: JSON.stringify([...item.warnings, ...item.errors]),
            missingFields: JSON.stringify(item.missingFields),
            isDuplicate: item.isDuplicate,
            duplicateOfId: item.duplicateOfId,
            reviewStatus: item.errors.length > 0 ? 'pending' : 'pending',
          }))
        )
      }

      // Update batch: processing → review_pending
      const skippedSummary = extracted.skipped.map(s => `Row ${s.sourceRow}: ${s.reason}`)
      await db.update(ingestionBatches).set({
        status: 'review_pending',
        totalRows: parsed.totalRows,
        extractedCount: validated.length,
        approvedCount: 0,
        rejectedCount: 0,
        aiModel: extracted.aiModel,
        extractionSummary: JSON.stringify({
          skippedRows: skippedSummary,
          validationSummary: summary,
        }),
      }).where(eq(ingestionBatches.id, batchId!))
    })

    return NextResponse.json({
      batchId,
      fileName: file.name,
      status: 'review_pending',
      stats: {
        totalRowsParsed: parsed.totalRows,
        itemsExtracted: validated.length,
        skippedRows: extracted.skipped.length,
        readyToImport: summary.readyToImport,
        needsReview: summary.needsReview,
        hasErrors: summary.hasErrors,
        duplicates: summary.duplicates,
      },
    }, { status: 201 })

  } catch (err) {
    // Mark batch as failed if it was created
    if (batchId) {
      await withTenantContext({ orgId }, (db) =>
        db.update(ingestionBatches).set({
          status: 'failed',
          errorMessage: (err as Error).message,
        }).where(eq(ingestionBatches.id, batchId!))
      ).catch(() => {})
    }
    console.error('Ingest error:', err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

// GET /api/ingest — list this org's batches
export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ batches: [] })

  const batches = await withTenantContext({ orgId }, (db) =>
    db.query.ingestionBatches.findMany({
      where: eq(ingestionBatches.orgId, orgId),
      orderBy: (b, { desc }) => [desc(b.createdAt)],
      limit: 50,
      with: { uploadedBy: { columns: { name: true } } },
    })
  )

  return NextResponse.json({
    batches: batches.map(b => ({
      id: b.id,
      fileName: b.fileName,
      fileType: b.fileType,
      status: b.status,
      totalRows: b.totalRows,
      extractedCount: b.extractedCount,
      confirmedCount: b.confirmedCount,
      uploadedBy: b.uploadedBy.name,
      createdAt: b.createdAt.toISOString(),
      confirmedAt: b.confirmedAt?.toISOString() ?? null,
    })),
  })
}
