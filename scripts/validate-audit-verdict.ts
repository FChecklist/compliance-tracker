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
// Fetches the PR's own comments directly (GH_TOKEN/REPO/PR_NUMBER env vars,
// same three the workflow already had), finds the most recent one matching
// an AUDIT: PASS/FAIL line, and extracts the 8 labeled fields (one per
// line, "Label: value" -- same convention task-tightening.ts's
// assembleTightTaskPrompt() already uses, so a reviewer or an AI reading
// either side of this contract sees one consistent shape). Validates them
// with the actual shared function (not a reimplementation -- single source
// of truth), and exits 0 (pass) / 1 (fail or malformed) with a precise,
// actionable reason on stderr either way.
//
// Deliberately does the comment fetch+select itself in one real regex
// engine, rather than splitting it across a bash step piping into `gh api
// --jq` -- gojq (gh's bundled jq) requires jq string-literal escaping for
// \s that differs from what a shell single-quoted heredoc naturally
// produces, and that mismatch silently emptied the extracted comment body
// on first deploy (caught by dogfooding this exact PR's own audit
// comment -- see git history). One language, one regex, one place it can
// be wrong -- matching the ambiguity-elimination goal this whole change
// exists for in the first place.
//
// This is the "how to report back precisely" half of the agent-
// communication standard; the "how to give instructions precisely" half
// already existed and is unchanged (task-tightening.ts's
// TightTask/assembleTightTaskPrompt).
//
// GAP-UNIFIED-SOT-REMAINDER slice (d): the 8 fields above were validated
// and then discarded -- nothing persisted a passing verdict anywhere
// queryable. persistAuditFinding() below closes that, additively: it runs
// only AFTER validateAuditProtocolFields() has already returned valid
// (this file's existing validation logic/exit codes are otherwise
// untouched), and its own failure is deliberately non-fatal -- a
// DATABASE_URL that isn't configured, or a live DB whose
// audit_protocol_findings migration (drizzle/0175) hasn't been applied yet,
// must never turn an
// otherwise-valid PASS/FAIL verdict into a blocked merge over an unrelated
// persistence hiccup. Same fail-open-on-the-side-effect posture as
// src/app/api/webhooks/vercel-deployment/route.ts's audit-trigger write.
//
// prNumber/prUrl are built from this script's own existing PR_NUMBER/REPO
// env vars (no new ones needed). branchName/submittedBy come from
// GITHUB_HEAD_REF/GITHUB_ACTOR -- both set automatically by GitHub Actions
// for a pull_request-triggered workflow run, so no workflow file change was
// needed to make them available.
import { validateAuditProtocolFields, type AuditProtocolFields } from "../src/lib/audit-protocol"
// Named auditProtocolFindings, NOT auditFindings -- that name is already
// taken by an unrelated, pre-existing, org-scoped internal-audit-engagement
// CAPA findings table in schema.ts. See drizzle/0175_audit_protocol_findings.sql's
// header for the full collision writeup.
import { db, auditProtocolFindings } from "../src/lib/db"

type GithubComment = { body: string }

async function fetchComments(repo: string, prNumber: string, token: string): Promise<GithubComment[]> {
  const res = await fetch(`https://api.github.com/repos/${repo}/issues/${prNumber}/comments?per_page=100`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  })
  if (!res.ok) {
    throw new Error(`GitHub API request failed: ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as GithubComment[]
}

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

// Best-effort, non-fatal persistence of a validated audit verdict into
// compliance.audit_protocol_findings (drizzle/0175). Never throws -- every
// failure mode (no DATABASE_URL configured, migration not yet applied live,
// network error) is caught and logged as a GitHub Actions warning
// annotation, not an error, so it never affects this script's exit code.
async function persistAuditFinding(fields: AuditProtocolFields, repo: string, prNumber: string): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.warn(
      "::warning::DATABASE_URL not configured -- skipping audit_protocol_findings persistence (the verdict validation result above is unaffected)."
    )
    return
  }
  try {
    await db.insert(auditProtocolFindings).values({
      prNumber: Number.isFinite(Number(prNumber)) ? Number(prNumber) : null,
      prUrl: `https://github.com/${repo}/pull/${prNumber}`,
      branchName: process.env.GITHUB_HEAD_REF || null,
      objectiveUnderstood: fields.objectiveUnderstood,
      standardsReviewed: fields.standardsReviewed,
      scopeConfirmed: fields.scopeConfirmed,
      evidenceRecorded: fields.evidenceRecorded,
      severityClassified: fields.severityClassified,
      verdict: fields.verdict,
      correctiveActionOwner: fields.correctiveActionOwner,
      reAuditScheduled: fields.reAuditScheduled,
      submittedBy: process.env.GITHUB_ACTOR || null,
    })
    console.log(`Persisted audit finding for PR #${prNumber} to compliance.audit_protocol_findings.`)
  } catch (err) {
    console.warn(
      `::warning::Failed to persist audit finding to compliance.audit_protocol_findings (non-fatal -- the verdict validation result above still stands): ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

async function main() {
  const repo = process.env.REPO
  const prNumber = process.env.PR_NUMBER
  const token = process.env.GH_TOKEN
  if (!repo || !prNumber || !token) {
    console.error("::error::REPO, PR_NUMBER, and GH_TOKEN environment variables are all required.")
    process.exit(1)
  }

  const comments = await fetchComments(repo, prNumber, token)
  const matching = comments.filter((c) => VERDICT_LINE_RE.test(c.body))
  const last = matching[matching.length - 1]

  if (!last) {
    console.error(
      "::error::No structured audit verdict found. Per AGENTS.md Operating Rule 7c, post a comment starting with " +
        "'AUDIT: PASS' or 'AUDIT: FAIL' followed by the 8 required fields (Objective Understood, Standards Reviewed, " +
        "Scope Confirmed, Evidence Recorded, Severity Classified, Verdict, Corrective Action Owner, Re-Audit Scheduled) " +
        "-- see audit-protocol.ts's AuditProtocolFields for the exact contract and scripts/validate-audit-verdict.ts " +
        "for the format each field must appear in ('Label: value', one per line)."
    )
    process.exit(1)
  }

  const fields = parseAuditComment(last.body)!

  const result = validateAuditProtocolFields(fields)
  if (!result.valid) {
    console.error(`::error::Audit verdict comment is incomplete: ${result.reason} ${result.guidance}`)
    process.exit(1)
  }

  // Fields are structurally valid -- persist the finding now, before the
  // fail/exit-1 branch below, so a FAIL verdict is recorded too, not just
  // passing ones (a rejected audit is exactly the kind of finding that
  // needs to stay queryable).
  await persistAuditFinding(fields as AuditProtocolFields, repo, prNumber)

  const verdict = fields.verdict!.trim().toLowerCase()
  if (verdict === "fail") {
    console.error("::error::Audit verdict found: FAIL -- this PR was reviewed and rejected. Address the findings and request a new audit.")
    process.exit(1)
  }

  console.log("Structured audit verdict found and valid: PASS")
  process.exit(0)
}

main()
