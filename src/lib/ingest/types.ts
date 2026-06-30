export const VALID_COMPLIANCE_TYPES = [
  'GST', 'TDS', 'MCA', 'PF', 'ESIC',
  'INCOME_TAX', 'ROC', 'LABOUR', 'ENVIRONMENTAL', 'OTHER',
] as const

export const VALID_STATUSES = [
  'pending', 'in_progress', 'completed', 'overdue', 'not_applicable', 'draft',
] as const

export const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const

export type ComplianceType = (typeof VALID_COMPLIANCE_TYPES)[number]
export type ComplianceStatus = (typeof VALID_STATUSES)[number]
export type CompliancePriority = (typeof VALID_PRIORITIES)[number]

// Raw parsed row from file — any key/value
export type ParsedRow = Record<string, string | number | null | undefined>

export interface ParseResult {
  fileType: 'xlsx' | 'csv' | 'pdf'
  rows: ParsedRow[]
  headers: string[]
  rawText?: string   // PDF only
  totalRows: number
  sheetName?: string
}

// One item as the AI extracted it — may have nulls
export interface ExtractedItem {
  sourceRow: number
  title: string | null
  complianceType: string | null
  dueDate: string | null           // ISO YYYY-MM-DD or null
  status: string | null
  priority: string | null
  departmentName: string | null
  assignedToName: string | null
  description: string | null
  extraData: Record<string, unknown>
  confidence: number               // 0–1
  warnings: string[]
  missingFields: string[]
}

export interface SkippedRow {
  sourceRow: number
  reason: string
  rawData: ParsedRow
}

export interface ExtractionResult {
  items: ExtractedItem[]
  skipped: SkippedRow[]
  aiModel: string
  totalInputRows: number
}

// After validation — adds duplicate and department resolution info
export interface ValidatedItem extends ExtractedItem {
  departmentId: string | null
  assignedToId: string | null
  isDuplicate: boolean
  duplicateOfId: string | null
  // Validation adds errors for truly broken items
  errors: string[]
}
