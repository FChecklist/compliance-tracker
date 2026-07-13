#!/usr/bin/env bun
// Wires audit-protocol.ts's AuditProtocolFields into the one real call site
// it was missing (see that module's own header: "this module has NO live
// caller yet -- no dedicated 'submit audit finding' endpoint exists in this
// codebase today"). mandatory-audit-check.yml's PR-comment audit verdict is
// exactly that missing call site: today it only checks for a bare
// "AUDIT: PASS"/"AUDIT: FAIL" line prefix, which is loose free text an
// agent can satisfy with zero real content. This script requires the same
// 8 structured fields validateAuditProtocolFields() already enforces
// everywhere else, applied here for the first time.
//
// Reads a PR comment body from stdin, extracts the 8 labeled fields (one
// per line, "Label: value" -- same convention task-tightening.ts's
// assembleTightTaskPrompt() already uses, so a reviewer or an AI reading
// either side of this contract sees one consistent shape), validates them
// with the actual shared function (not a reimplementation -- single
// source of truth), and exits 0 (pass) / 1 (fail or malformed) with a
// precise, actionable reason on stderr either way. This is the "how to
// report back precisely" half of the agent-communication standard; the
// "how to give instructions precisely" half already existed and is
// unchanged (task-tightening.ts's TightTask/assembleTightTaskPrompt).
import { validateAuditProtocolFields, type AuditProtocolFields } from "../src/lib/audit-protocol"

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

// The pre-existing "AUDIT: PASS"/"AUDIT: FAIL" first line maps directly to
// the `verdict` field -- kept as the trigger line so a bare skim of a PR's
// comments still shows the verdict immediately, same as before this change.
const VERDICT_LINE_RE = /^AUDIT:\s*(PASS|FAIL)\s*$/im

function extractField(body: string, label: string): string | undefined {
  // Value runs from "Label:" to end of that line only -- deliberately not
  // multi-line, matching every other structured-field consumer in this
  // codebase (assembleTightTaskPrompt's own render, handover-protocol.ts's
  // fields) so a reviewer can always find a field on one scannable line.
  const re = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*(.+)$`, "im")
  const match = body.match(re)
  return match?.[1]?.trim()
}

function parseAuditComment(body: string): Partial<AuditProtocolFields> | null {
  if (!VERDICT_LINE_RE.test(body)) return null
  const fields: Partial<AuditProtocolFields> = {}
  for (const [key, label] of Object.entries(FIELD_LABELS) as [keyof AuditProtocolFields, string][]) {
    const value = extractField(body, label)
    if (value !== undefined) fields[key] = value
  }
  return fields
}

async function main() {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  const body = Buffer.concat(chunks).toString("utf8")

  const fields = parseAuditComment(body)
  if (!fields) {
    console.error(
      "::error::No structured audit verdict found. Per AGENTS.md Operating Rule 7c, post a comment starting with " +
        "'AUDIT: PASS' or 'AUDIT: FAIL' followed by the 8 required fields (Objective Understood, Standards Reviewed, " +
        "Scope Confirmed, Evidence Recorded, Severity Classified, Verdict, Corrective Action Owner, Re-Audit Scheduled) " +
        "-- see audit-protocol.ts's AuditProtocolFields for the exact contract and scripts/validate-audit-verdict.ts " +
        "for the format each field must appear in ('Label: value', one per line)."
    )
    process.exit(1)
  }

  const result = validateAuditProtocolFields(fields)
  if (!result.valid) {
    console.error(`::error::Audit verdict comment is incomplete: ${result.reason} ${result.guidance}`)
    process.exit(1)
  }

  const verdict = fields.verdict!.trim().toLowerCase()
  if (verdict === "fail") {
    console.error("::error::Audit verdict found: FAIL -- this PR was reviewed and rejected. Address the findings and request a new audit.")
    process.exit(1)
  }

  console.log("Structured audit verdict found and valid: PASS")
  process.exit(0)
}

main()
