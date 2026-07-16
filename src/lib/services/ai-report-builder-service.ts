// "Need a Report / Need an Analysis" upload-to-AI flow (Owner request,
// 2026-07-13). A user uploads an image/Excel/Word file describing what they
// want analyzed; this proposes a structured report from that file's REAL
// content -- never invented numbers, matching this codebase's established
// discipline (construction-ai-service.ts's own header: "this project has a
// documented prior bug of an AI surface hallucinating generic placeholder
// numbers... these prompts exist specifically to not repeat that").
//
// Extraction reuses what already exists rather than reimplementing it:
// - Images: document-extraction-service.ts's isVisionExtractable() gate,
//   then the same callLLMVision() building block that service and
//   construction-ai-service.ts already use for vision calls.
// - Excel/CSV: the `xlsx` package -- already a dependency, already used for
//   Excel export in reports/page.tsx. No extraction path for spreadsheets
//   exists anywhere else in this codebase to reuse.
// - Word (.docx): PRIORITY-22 (2026-07-16) replaced `mammoth` with the
//   vendored iOfficeAI/OfficeCLI binary (src/lib/officecli-client.ts) --
//   the `docx` package added in the same original PR for Word *export*
//   still has no robust read/parse API (it's a document-generation
//   library), so a dedicated read path is still needed; OfficeCLI's own
//   `query <file> "p" --json` gives strictly richer structure than
//   mammoth.extractRawText()'s flat string for the same call site. See
//   ai-os/priority22_officecli_feasibility.md for the full evaluation.
//
// The proposed report is NOT saved here -- proposeReportFromUpload() only
// returns a proposal for the user to review; saving happens via the
// pre-existing createSavedReport() (custom-report-service.ts), org-scoped
// exactly like every other saved report, once the user confirms.
import * as XLSX from "xlsx"
import { extractDocxRawText } from "@/lib/officecli-client"
import { resolveModelConfig } from "@/lib/orchestra-model-resolver"
import { callLLMVision, callLLMJson, stripJsonFence } from "@/lib/llm-client"
import { recordOrchestraExecution } from "@/lib/orchestra-execution-logger"
import { isVisionExtractable } from "./document-extraction-service"
import { ServiceError } from "./compliance-service"
export { ServiceError }

export type AiGeneratedReportRow = Record<string, string | number>
export type AiChartRow = { groupValue: string; count: number }
export type AiGeneratedReportData = {
  title: string
  summary: string
  columns: string[]
  rows: AiGeneratedReportRow[]
  chartType: "table" | "bar" | "pie" | "line"
  chartRows: AiChartRow[]
}

const MAX_EXTRACTED_CHARS = 12000

const SPREADSHEET_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls
  "text/csv",
])
const WORD_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
])

function isSpreadsheet(mimeType: string, fileName: string): boolean {
  return SPREADSHEET_MIME_TYPES.has(mimeType) || /\.(xlsx|xls|csv)$/i.test(fileName)
}
function isWordDoc(mimeType: string, fileName: string): boolean {
  return WORD_MIME_TYPES.has(mimeType) || /\.docx$/i.test(fileName)
}

type ExtractedUpload =
  | { kind: "image"; imageBase64: string; mimeType: string }
  | { kind: "text"; text: string }

export async function extractUploadContent(input: { buffer: Buffer; mimeType: string; fileName: string }): Promise<ExtractedUpload> {
  const { buffer, mimeType, fileName } = input

  if (isVisionExtractable(mimeType)) {
    return { kind: "image", imageBase64: buffer.toString("base64"), mimeType }
  }

  if (isSpreadsheet(mimeType, fileName)) {
    const workbook = XLSX.read(buffer, { type: "buffer" })
    const parts = workbook.SheetNames.map((sheetName) => {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName])
      return `--- Sheet: ${sheetName} ---\n${csv}`
    })
    const text = parts.join("\n\n").trim()
    if (!text) throw new ServiceError("The uploaded spreadsheet has no readable content", 400)
    return { kind: "text", text }
  }

  if (isWordDoc(mimeType, fileName)) {
    const { value: text } = await extractDocxRawText(buffer)
    if (!text.trim()) throw new ServiceError("The uploaded Word document has no readable text content", 400)
    return { kind: "text", text: text.trim() }
  }

  throw new ServiceError(
    `Unsupported file type "${mimeType || fileName}". Upload an image (JPEG/PNG/WebP), Excel (.xlsx/.xls/.csv), or Word (.docx) file.`,
    400
  )
}

const REPORT_PROPOSAL_SYSTEM_PROMPT = `You are a reporting assistant inside VERIDIAN AI OS, a compliance/GRC platform. A user has uploaded a file describing what they want analyzed or reported on. Your job is to propose a structured report built ONLY from the real content given to you.

STRICT RULES:
- Use ONLY numbers, labels, dates, and facts that are actually present in the provided content. Never invent, estimate, or guess a number that is not in the source.
- If the source content has no numeric/tabular data at all, produce a qualitative table instead (e.g. one row per topic/finding with a "Detail" column) -- do not fabricate metrics to fill a chart.
- Keep columns and rows faithful to what is in the source; do not add rows for things not mentioned in it.

Respond with ONLY a JSON object of this exact shape, no markdown, no extra text:
{
  "title": "Short report title",
  "summary": "1-3 sentence summary of what this report covers, grounded in the source content",
  "columns": ["Column A", "Column B"],
  "rows": [ { "Column A": "value", "Column B": "value" } ],
  "chartType": "table" | "bar" | "pie" | "line",
  "chartRows": [ { "groupValue": "label", "count": 0 } ]
}

chartRows is optional supporting data for a simple chart view (label + numeric value pairs derived from the real rows, e.g. a count or amount per category) -- leave it as an empty array if the data does not reduce to that shape. Set chartType to "table" whenever a chart would not be a faithful representation of the source data.`

function normalizeProposal(data: Partial<AiGeneratedReportData> | null | undefined): AiGeneratedReportData {
  const columns = Array.isArray(data?.columns) ? data!.columns.map((c) => String(c)) : []
  const rows = Array.isArray(data?.rows) ? (data!.rows as AiGeneratedReportRow[]) : []
  if (columns.length === 0 || rows.length === 0) {
    throw new ServiceError("The AI could not derive a structured report from this file's content -- try a file with clearer tabular or listed information.", 422)
  }
  const validChartTypes = ["table", "bar", "pie", "line"] as const
  const chartType = validChartTypes.includes(data?.chartType as (typeof validChartTypes)[number])
    ? (data!.chartType as AiGeneratedReportData["chartType"])
    : "table"
  const chartRows = Array.isArray(data?.chartRows)
    ? (data!.chartRows as unknown[]).filter(
        (r): r is AiChartRow => !!r && typeof r === "object" && typeof (r as AiChartRow).groupValue === "string" && typeof (r as AiChartRow).count === "number"
      )
    : []
  return {
    title: typeof data?.title === "string" && data.title.trim() ? data.title.trim() : "AI-Generated Report",
    summary: typeof data?.summary === "string" ? data.summary : "",
    columns,
    rows,
    chartType,
    chartRows,
  }
}

function parseProposal(content: string): AiGeneratedReportData {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonFence(content))
  } catch {
    throw new ServiceError("The AI did not return valid JSON for this report proposal -- please try again.", 502)
  }
  return normalizeProposal(parsed as Partial<AiGeneratedReportData>)
}

export type ProposeReportResult = { proposal: AiGeneratedReportData; extractedPreview: string }

// Grounding note (verification for reviewers): the ONLY inputs to either
// LLM call below are `extracted.imageBase64`/`extracted.text` -- i.e. the
// literal bytes/text pulled out of the user's own uploaded file by
// extractUploadContent() above. Nothing else is interpolated into the user
// message, and the system prompt explicitly forbids inventing figures not
// present in that content. There is no path from here to a saved report
// that skips this function -- the create-report page (reports/create) only
// ever POSTs to /api/reports/saved with the exact AiGeneratedReportData
// this function returned (optionally after the user hand-edits it in the
// UI, the same trust model as every other user-editable form in this app).
export async function proposeReportFromUpload(
  ctx: { orgId: string; userId: string },
  input: { buffer: Buffer; mimeType: string; fileName: string }
): Promise<ProposeReportResult> {
  const startedAt = Date.now()
  const extracted = await extractUploadContent(input)

  try {
    if (extracted.kind === "image") {
      const modelConfig = await resolveModelConfig(ctx.orgId, "customer_account_oa", "vision_document_extraction")
      if (!modelConfig) {
        throw new ServiceError("No vision-capable AI model is configured for this organisation. Configure one in Settings -> AI Configuration.", 503)
      }
      const { content, usage } = await callLLMVision(
        modelConfig.provider, modelConfig.model, modelConfig.apiKey,
        REPORT_PROPOSAL_SYSTEM_PROMPT, extracted.imageBase64, extracted.mimeType,
        `File name: ${input.fileName}. Analyze this image and propose a report as the required JSON.`,
        { jsonMode: true, temperature: 0.1, maxTokens: 2048 }
      )
      const proposal = parseProposal(content)
      recordOrchestraExecution({
        orgId: ctx.orgId, userId: ctx.userId, layerKey: "customer_account_oa", eventType: "reports.ai_builder_propose",
        input: { fileName: input.fileName, mimeType: input.mimeType, kind: "image" }, output: { title: proposal.title, rowCount: proposal.rows.length },
        status: "completed", durationMs: Date.now() - startedAt,
        provider: modelConfig.provider, model: modelConfig.model, usage,
      })
      return { proposal, extractedPreview: "[Image analyzed directly by the vision model -- no separate text extraction step]" }
    }

    const modelConfig = await resolveModelConfig(ctx.orgId, "customer_account_oa")
    if (!modelConfig) {
      throw new ServiceError("No AI model is configured for this organisation. Configure one in Settings -> AI Configuration.", 503)
    }
    const truncated = extracted.text.slice(0, MAX_EXTRACTED_CHARS)
    const { data, usage } = await callLLMJson<Partial<AiGeneratedReportData>>(
      modelConfig.provider, modelConfig.model, modelConfig.apiKey,
      REPORT_PROPOSAL_SYSTEM_PROMPT,
      `File name: ${input.fileName}\n\nExtracted content (the ONLY source of truth for this report):\n${truncated}`,
      { temperature: 0.1, maxTokens: 2048 },
      modelConfig.fallback
    )
    const proposal = normalizeProposal(data)
    recordOrchestraExecution({
      orgId: ctx.orgId, userId: ctx.userId, layerKey: "customer_account_oa", eventType: "reports.ai_builder_propose",
      input: { fileName: input.fileName, mimeType: input.mimeType, kind: "text" }, output: { title: proposal.title, rowCount: proposal.rows.length },
      status: "completed", durationMs: Date.now() - startedAt,
      provider: modelConfig.provider, model: modelConfig.model, usage,
    })
    return { proposal, extractedPreview: truncated.slice(0, 800) }
  } catch (err) {
    recordOrchestraExecution({
      orgId: ctx.orgId, userId: ctx.userId, layerKey: "customer_account_oa", eventType: "reports.ai_builder_propose",
      input: { fileName: input.fileName, mimeType: input.mimeType }, status: "failed", durationMs: Date.now() - startedAt,
      output: { error: err instanceof Error ? err.message : String(err) },
    })
    throw err
  }
}
