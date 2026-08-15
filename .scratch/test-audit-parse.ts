import { validateAuditProtocolFields, type AuditProtocolFields } from "../src/lib/audit-protocol"
import { readFileSync } from "fs"

const body = readFileSync(".scratch/audit-comment-1221.txt", "utf-8")

const FIELD_LABELS: Record<keyof AuditProtocolFields, string> = {
  objectiveUnderstood: "Objective Understood",
  standardsReviewed: "Standards Reviewed",
  scopeConfirmed: "Scope Confirmed",
  evidenceRecorded: "Evidence Recorded",
  severityClassified: "Severity Classified",
  verdict: "Verdict",
  correctiveActionOwner: "Corrective Action Owner",
  reAuditScheduled: "Re-Audit Scheduled",
}

function extractField(body: string, label: string): string | undefined {
  const re = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*(.+)$`, "im")
  const match = body.match(re)
  return match?.[1]?.trim()
}

const fields: Partial<AuditProtocolFields> = {}
for (const [key, label] of Object.entries(FIELD_LABELS) as [keyof AuditProtocolFields, string][]) {
  const value = extractField(body, label)
  if (value !== undefined) fields[key] = value
}

const result = validateAuditProtocolFields(fields)
console.log(JSON.stringify(result, null, 2))
