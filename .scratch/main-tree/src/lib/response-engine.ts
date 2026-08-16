// Wave 154 (TaskDocx_Evaluation.md, "Response Engine"). Boss: "the response
// to user via chat by AI or software has to be short and precise and not
// long answers... predefined responses which are polite and give a short
// and exact answer, such as Yes, No, OK, Pending, Completed, Need Clarity,
// Require Input, Wrong Data, Incomplete Instructions... maximum 4 words +
// any specific requirement or observation... long answers are only needed
// for research or analysis purposes only."
//
// Confirmed via repo-wide grep before building: no response-vocabulary
// concept existed anywhere in this codebase. This is genuinely new, not a
// duplicate of anything.
//
// The real value (per the doc's own reasoning, and matching this
// codebase's deterministic-first philosophy): software decides WHICH
// predefined label applies from real state (a task's status, a gate's
// failure reason) with zero LLM call -- if an LLM is invoked at all for a
// reply, it only needs to relay/confirm a label software already chose,
// so even a lower-tier model can do the job with high confidence. This
// directly reduces token consumption, the doc's own stated goal.
// Wave 154 audit fix (AUDIT_wave154_claude_items.md, z.ai CONCERN):
// "failed" was originally mapped to "Wrong Data" and "cancelled" to
// "Incomplete Instructions" -- both flagged as semantic stretches (a task
// can fail from a timeout/outage with nothing wrong about its input data;
// cancellation is frequently the user's own deliberate choice, not a
// consequence of incomplete instructions). Added a real "failed" label
// so failed tasks get an exact, honest mapping instead of a borrowed one.
// The doc's own list is introduced with "such as", explicitly inviting
// extension. "Cancelled" tasks now map to "ok" (an acknowledgment, not an
// accusation) -- see suggestResponseForTaskStatus below.
export type ResponseLabel =
  | "yes" | "no" | "ok" | "pending" | "completed" | "failed"
  | "need_clarity" | "require_input" | "wrong_data" | "incomplete_instructions"

const RESPONSE_TEXT: Record<ResponseLabel, string> = {
  yes: "Yes",
  no: "No",
  ok: "OK",
  pending: "Pending",
  completed: "Completed",
  failed: "Failed",
  need_clarity: "Need Clarity",
  require_input: "Require Input",
  wrong_data: "Wrong Data",
  incomplete_instructions: "Incomplete Instructions",
}

export type ShortReply = { label: ResponseLabel; text: string; detail?: string }

/**
 * Builds a short reply from a predefined label plus an optional specific
 * detail (the doc's "any specific requirement or observation"). The label
 * itself is always 1-2 words; `detail` carries whatever concrete fact makes
 * the reply useful (a task title, a field name) without turning it into a
 * paragraph.
 */
export function formatShortReply(label: ResponseLabel, detail?: string): ShortReply {
  return { label, text: RESPONSE_TEXT[label], detail: detail?.trim() || undefined }
}

/** Renders a ShortReply to the literal string shown to the user. */
export function renderShortReply(reply: ShortReply): string {
  return reply.detail ? `${reply.text} — ${reply.detail}` : reply.text
}

/**
 * Deterministic suggestion from a task's real status -- zero LLM call.
 * This is the concrete, real consumer proving the vocabulary isn't just
 * infrastructure sitting unused: Wave 150's llm-routing-gate.ts uses this
 * for its check_status handler.
 */
export function suggestResponseForTaskStatus(status: string, taskTitle?: string): ShortReply {
  switch (status) {
    case "completed":
      return formatShortReply("completed", taskTitle)
    case "pending":
      return formatShortReply("pending", taskTitle)
    case "in_progress":
      return formatShortReply("pending", taskTitle ? `${taskTitle} (in progress)` : "in progress")
    case "failed":
      return formatShortReply("failed", taskTitle)
    case "cancelled":
      // Cancellation is frequently the user's own deliberate choice, not a
      // problem to flag -- "OK" acknowledges it without implying blame.
      return formatShortReply("ok", taskTitle ? `${taskTitle} cancelled` : "cancelled")
    default:
      return formatShortReply("pending", taskTitle ? `${taskTitle}: ${status}` : status)
  }
}

// ─── Status Updates & Report Summaries (Priority 5, 10-priority5-software-
// orchestrator-tracker.yaml dispatch 4, item E5) ───────────────────────────
//
// suggestResponseForTaskStatus() above only ever describes ONE task's
// status -- confirmed before writing anything: no template existed anywhere
// for the doc's other two named response shapes, periodic STATUS UPDATES
// ("X of Y tasks completed this week") or REPORT SUMMARIES ("GST filing
// status: completed, due 15 Jul 2026"). This widens the SAME mechanism
// (predefined template + real data, zero LLM generation) to those two
// shapes rather than changing its nature -- every function below is a pure
// string formatter over primitive data (counts, a status string, a date)
// the caller already fetched from the DB, exactly like suggestResponseFor
// TaskStatus's own contract. No function here calls an LLM or invents a
// data source; formatTaskCompletionSummary is the one with a real live
// caller today (llm-routing-gate.ts's `generate_report` handler,
// previously registered in intent-engine.ts but never wired to a handler --
// confirmed via that file's own HANDLERS map before this change).
// formatComplianceFilingSummary/formatComplianceStatusDigest are tested,
// ready infrastructure without a live caller yet (no existing code path
// currently fetches "the org's most recent GST compliance_items row" to
// feed one) -- same honest "real, tested, ready, not yet wired" framing
// this session has used elsewhere (e.g. audit-protocol.ts).

const COMPLIANCE_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  completed: "Completed",
  overdue: "Overdue",
  not_applicable: "Not Applicable",
  draft: "Draft",
}

const MONTH_ABBREVIATIONS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

/**
 * Deterministic "DD MMM YYYY" formatter (e.g. "15 Jul 2026"), used instead
 * of Date.prototype.toLocaleDateString so template output doesn't depend on
 * the host's ICU locale data -- the same value every time, in tests and in
 * production. Reads UTC fields so a stored timestamp's calendar date isn't
 * shifted by the server's local timezone.
 */
function formatDate(input: Date | string): string {
  const date = typeof input === "string" ? new Date(input) : input
  if (Number.isNaN(date.getTime())) return "an unknown date"
  return `${date.getUTCDate()} ${MONTH_ABBREVIATIONS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

export type TaskCompletionSummary = { completed: number; total: number; periodLabel: string }

/**
 * "X of Y tasks completed <period>" -- the doc's own example. Zero LLM
 * call: `completed`/`total` are real counts the caller already queried
 * (see llm-routing-gate.ts's `generate_report` handler for the live
 * caller). `total <= 0` gets its own honest "no tasks" phrasing rather than
 * a misleading "0 of 0 tasks completed".
 */
export function formatTaskCompletionSummary(summary: TaskCompletionSummary): string {
  const { completed, total, periodLabel } = summary
  if (total <= 0) return `No tasks ${periodLabel}`
  return `${completed} of ${total} tasks completed ${periodLabel}`
}

export type ComplianceFilingSummary = {
  complianceType: string
  status: string
  dueDate: Date | string | null
}

/**
 * "<TYPE> filing status: <Status>, due <date>" -- the doc's other named
 * example. `status` is expected to be one of complianceStatusEnum's real
 * values (schema.ts) but falls back to the raw string for forward
 * compatibility rather than throwing on an unrecognized value.
 */
export function formatComplianceFilingSummary(summary: ComplianceFilingSummary): string {
  const statusLabel = COMPLIANCE_STATUS_LABELS[summary.status] ?? summary.status
  const dueText = summary.dueDate ? formatDate(summary.dueDate) : "no due date set"
  return `${summary.complianceType} filing status: ${statusLabel}, due ${dueText}`
}

export type ComplianceStatusCounts = { status: string }[]

/**
 * Widens the single-item filing summary above to a genuine multi-item
 * REPORT SUMMARY -- "X of Y GST filings completed this month" -- built
 * purely from an array of real compliance_items rows' status field (the
 * caller does the DB query and filtering, e.g. by complianceType/period;
 * this function only aggregates and formats). `completed` counts exactly
 * the `completed` status value, matching complianceStatusEnum.
 */
export function formatComplianceStatusDigest(complianceType: string, items: ComplianceStatusCounts, periodLabel: string): string {
  const total = items.length
  if (total === 0) return `No ${complianceType} filings ${periodLabel}`
  const completed = items.filter((i) => i.status === "completed").length
  return `${completed} of ${total} ${complianceType} filings completed ${periodLabel}`
}
