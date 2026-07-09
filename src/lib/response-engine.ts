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
export type ResponseLabel =
  | "yes" | "no" | "ok" | "pending" | "completed"
  | "need_clarity" | "require_input" | "wrong_data" | "incomplete_instructions"

const RESPONSE_TEXT: Record<ResponseLabel, string> = {
  yes: "Yes",
  no: "No",
  ok: "OK",
  pending: "Pending",
  completed: "Completed",
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
      return formatShortReply("wrong_data", taskTitle ? `${taskTitle} failed` : "task failed")
    case "cancelled":
      return formatShortReply("incomplete_instructions", taskTitle ? `${taskTitle} cancelled` : "cancelled")
    default:
      return formatShortReply("pending", taskTitle ? `${taskTitle}: ${status}` : status)
  }
}
