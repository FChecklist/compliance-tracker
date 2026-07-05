import type { ParseResult, ExtractionResult, ExtractedItem, SkippedRow } from './types'
import { VALID_COMPLIANCE_TYPES, VALID_STATUSES, VALID_PRIORITIES } from './types'
import { resolvePlatformModelConfig } from '@/lib/orchestra-model-resolver'
import { callLLM } from '@/lib/llm-client'

// Max rows to send to AI in one call. Split into batches for larger files.
const BATCH_SIZE = 80

const SYSTEM_PROMPT = `You are a compliance data extraction expert for Indian businesses.
Your job is to read raw data from uploaded files (Excel/CSV/PDF) and extract structured compliance management records.

OUTPUT SCHEMA — return ONLY valid JSON, no markdown, no explanation:
{
  "items": [
    {
      "source_row": <integer, 1-indexed row number>,
      "title": <string — descriptive name e.g. "GSTR-3B July 2026" or "TDS Q2 FY 2026-27 Return">,
      "compliance_type": <one of: GST | TDS | MCA | PF | ESIC | INCOME_TAX | ROC | LABOUR | ENVIRONMENTAL | OTHER>,
      "due_date": <ISO date YYYY-MM-DD or null>,
      "status": <one of: pending | in_progress | completed | overdue | not_applicable | draft>,
      "priority": <one of: low | medium | high | critical>,
      "department_name": <string department name or null>,
      "assigned_to_name": <string person name or null>,
      "description": <string with any relevant extra context or null>,
      "extra_data": <object with any columns that don't fit the above schema>,
      "confidence": <float 0-1 — how confident you are in this extraction>,
      "warnings": <array of strings — data quality issues, ambiguities>,
      "missing_fields": <array of field names that are required but could not be determined>
    }
  ],
  "skipped_rows": [
    {
      "source_row": <integer>,
      "reason": <string why this row was skipped>
    }
  ]
}

EXTRACTION RULES:
1. COMPLIANCE TYPE mapping:
   - GSTR-1, GSTR-3B, GSTR-9, GSTR-2A, GST Annual Return, ITC reconciliation → GST
   - TDS return, Form 24Q, Form 26Q, Form 27Q, TDS challan, Form 16, Form 15CA → TDS
   - ROC filing, Annual Return, MGT-7, AOC-4, DIR-3 KYC, MCA forms → MCA or ROC
   - PF return, EPF, Employee Provident Fund, Form 12A → PF
   - ESIC return, ESI, Employee State Insurance → ESIC
   - Advance Tax, ITR, Income Tax Return, Form 3CD, Tax Audit → INCOME_TAX
   - Labour law, Shops Act, Contract Labour, Minimum Wages → LABOUR
   - Environmental clearance, Pollution control, NGT → ENVIRONMENTAL
   - Anything else → OTHER (preserve original type in description)

2. DATE PARSING — convert ALL formats to ISO YYYY-MM-DD:
   - DD/MM/YYYY, DD-MM-YYYY, D/M/YYYY → YYYY-MM-DD
   - "20 July 2026", "July 20, 2026", "Jul-26" → YYYY-MM-DD
   - "Q1 2026" = 2026-06-30, "Q2 2026" = 2026-09-30, "Q3 2026" = 2026-12-31, "Q4 2026" = 2027-03-31
   - Month-Year like "July 2026" = last day of that month
   - If date is ambiguous, include a warning
   - If no date at all, set to null and add "due_date" to missing_fields

3. STATUS inference (when column not present):
   - If a "Filed Date" or "Completion Date" column has a value → completed
   - If due_date is in the past and not completed → overdue
   - If due_date is in future → pending
   - Default: pending

4. PRIORITY inference (when column not present):
   - status = overdue → critical
   - due_date within 7 days from today → high
   - due_date within 30 days → medium
   - due_date > 30 days away → low
   - Today's date: ${new Date().toISOString().slice(0, 10)}

5. TITLE construction (when no clear title column):
   - Combine: compliance_type + period/month/year → "GSTR-3B July 2026"
   - If only description exists, use first 80 chars as title
   - Never leave title null — make a best-effort title

6. SKIP a row only if:
   - Row is completely empty or is a header/total row
   - Row contains no interpretable compliance data at all
   - Never skip a row just because some fields are missing

7. CONFIDENCE scoring:
   - 0.9–1.0: all required fields present and unambiguous
   - 0.7–0.9: minor issues (optional fields missing, minor ambiguity)
   - 0.5–0.7: significant ambiguity (compliance type inferred, date format unclear)
   - < 0.5: major issues (title constructed from minimal data, many missing fields)

8. Extra data: any columns that don't map to the schema go into extra_data as-is.
   This preserves all original data even if we don't use it.

COMMON INDIAN COMPLIANCE FILE COLUMN NAMES TO RECOGNISE:
- Title/task: "Compliance", "Task", "Description", "Item", "Particulars", "Compliance Name", "Activity"
- Type: "Type", "Tax Type", "Category", "Compliance Type", "Nature", "Act"
- Due date: "Due Date", "Last Date", "Deadline", "Filing Date", "Due By", "Last Date of Filing"
- Status: "Status", "Filing Status", "Compliance Status", "Stage"
- Priority: "Priority", "Urgency", "Criticality"
- Department: "Department", "Dept", "Division", "Business Unit", "Team", "Cost Centre"
- Assigned to: "Assigned To", "Responsible", "Owner", "Person", "CA", "Executive", "Incharge"
- Period: "Period", "Month", "Quarter", "FY", "Financial Year", "For the Month"
- Amount: put in extra_data (not in our schema yet)
- Penalty: put in extra_data
- Remarks: use as description`

// Wave 102 (end-to-end testing pass): this previously called Groq directly
// via a hardcoded process.env.GROQ_API_KEY -- confirmed dead in production
// since Wave 73 (GROQ_API_KEY has never been set in Vercel; it exists in
// GitHub Secrets only). Bulk compliance-item import has been completely
// broken end-to-end since this feature was built. Fixed by routing through
// the same platform-model resolver every other AI call site uses.
// resolvePlatformModelConfig (not resolveModelConfig) because this is a
// platform-level utility operation on an already-uploaded file, not a
// per-org BYOK-aware feature -- same category as Wave 18's Shared AI
// Resource Pool "platform's own internal orchestration work". callLLM
// already retries transient 429/5xx failures internally (Wave 72), so the
// bespoke Groq-specific 429 retry loop here is no longer needed.
async function callExtractionModel(userContent: string): Promise<{ content: string; model: string }> {
  const modelConfig = await resolvePlatformModelConfig('customer_account_oa')
  if (!modelConfig) throw new Error('No AI model configured for compliance item extraction')

  const result = await callLLM(
    modelConfig.provider,
    modelConfig.model,
    modelConfig.apiKey,
    SYSTEM_PROMPT,
    userContent,
    { maxTokens: 8192, temperature: 0.1, jsonMode: true },
    modelConfig.fallback
  )
  return { content: result.content, model: modelConfig.model }
}

function buildUserMessage(parsed: ParseResult, batchIndex: number, totalBatches: number): string {
  if (parsed.fileType === 'pdf') {
    return `Extract all compliance items from this PDF text. This is batch ${batchIndex + 1} of ${totalBatches}.

PDF TEXT:
${parsed.rawText?.slice(0, 12000) ?? 'No text extracted'}`
  }

  return `Extract all compliance items from these ${parsed.rows.length} rows of data. This is batch ${batchIndex + 1} of ${totalBatches}.

COLUMNS: ${parsed.headers.join(' | ')}

DATA (JSON rows, source_row starts at ${batchIndex * BATCH_SIZE + 1}):
${JSON.stringify(
  parsed.rows.map((row, i) => ({ __row: batchIndex * BATCH_SIZE + i + 1, ...row })),
  null,
  1
).slice(0, 14000)}`
}

interface RawExtracted {
  items?: Array<Record<string, unknown>>
  skipped_rows?: Array<{ source_row: number; reason: string }>
}

function parseAiResponse(raw: string, batchStartRow: number): { items: ExtractedItem[]; skipped: SkippedRow[] } {
  let parsed: RawExtracted = {}
  try {
    parsed = JSON.parse(raw) as RawExtracted
  } catch {
    // Try to extract JSON from response if wrapped in other text
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) {
      try { parsed = JSON.parse(match[0]) as RawExtracted } catch { /* give up */ }
    }
  }

  const items: ExtractedItem[] = (parsed.items ?? []).map((item) => {
    // Sanitise compliance_type
    const rawType = String(item.compliance_type ?? '').toUpperCase().trim()
    const complianceType = (VALID_COMPLIANCE_TYPES as readonly string[]).includes(rawType)
      ? rawType
      : 'OTHER'

    // Sanitise status
    const rawStatus = String(item.status ?? '').toLowerCase().trim()
    const status = (VALID_STATUSES as readonly string[]).includes(rawStatus) ? rawStatus : 'pending'

    // Sanitise priority
    const rawPriority = String(item.priority ?? '').toLowerCase().trim()
    const priority = (VALID_PRIORITIES as readonly string[]).includes(rawPriority) ? rawPriority : 'medium'

    // Sanitise date
    const dueDate = sanitiseDate(String(item.due_date ?? ''))

    const confidence = Math.max(0, Math.min(1, Number(item.confidence ?? 0.5)))
    const warnings = Array.isArray(item.warnings) ? item.warnings.map(String) : []
    const missingFields = Array.isArray(item.missing_fields) ? item.missing_fields.map(String) : []

    return {
      sourceRow: Number(item.source_row ?? batchStartRow),
      title: item.title ? String(item.title).slice(0, 255).trim() : null,
      complianceType,
      dueDate,
      status,
      priority,
      departmentName: item.department_name ? String(item.department_name).trim() : null,
      assignedToName: item.assigned_to_name ? String(item.assigned_to_name).trim() : null,
      description: item.description ? String(item.description).slice(0, 2000).trim() : null,
      extraData: (item.extra_data && typeof item.extra_data === 'object') ? item.extra_data as Record<string, unknown> : {},
      confidence,
      warnings,
      missingFields,
    }
  })

  const skipped: SkippedRow[] = (parsed.skipped_rows ?? []).map(s => ({
    sourceRow: Number(s.source_row),
    reason: String(s.reason),
    rawData: {},
  }))

  return { items, skipped }
}

function sanitiseDate(raw: string): string | null {
  if (!raw || raw === 'null' || raw === 'undefined' || raw === 'N/A') return null

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(raw)
    return isNaN(d.getTime()) ? null : raw
  }

  // Try JS Date parsing as fallback
  const d = new Date(raw)
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10)
  }

  return null
}

// Split rows into batches for large files
function chunkRows(parsed: ParseResult): ParseResult[] {
  if (parsed.fileType === 'pdf' || parsed.rows.length <= BATCH_SIZE) return [parsed]

  const chunks: ParseResult[] = []
  for (let i = 0; i < parsed.rows.length; i += BATCH_SIZE) {
    chunks.push({
      ...parsed,
      rows: parsed.rows.slice(i, i + BATCH_SIZE),
    })
  }
  return chunks
}

export async function extractComplianceItems(parsed: ParseResult): Promise<ExtractionResult> {
  const batches = chunkRows(parsed)
  const allItems: ExtractedItem[] = []
  const allSkipped: SkippedRow[] = []
  let resolvedModel = 'unknown'

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]
    const userMessage = buildUserMessage(batch, i, batches.length)

    const { content, model } = await callExtractionModel(userMessage)
    resolvedModel = model
    const { items, skipped } = parseAiResponse(content, i * BATCH_SIZE + 1)

    allItems.push(...items)
    allSkipped.push(...skipped)

    // Space out batches to stay under whichever provider's rate limit is
    // actually in effect -- callLLM's own retry handles a transient 429,
    // this just reduces how often that path gets exercised on large files.
    if (i < batches.length - 1) {
      await new Promise(r => setTimeout(r, 2200))
    }
  }

  return {
    items: allItems,
    skipped: allSkipped,
    aiModel: resolvedModel,
    totalInputRows: parsed.totalRows,
  }
}
