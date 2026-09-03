// R67 WS-C (C-13) -- IS THIS FAILURE THE USER'S TO FIX, OR OURS?
//
// THE ROWS THIS EXISTS TO KILL, both captured live in the R66 walkthrough and
// both shown to a site engineer:
//
//   "Review Leads > View — write CONNECT_TIMEOUT 3.109.171.244:6543"
//   "Record record_work_progress — item code 01 not found"
//
// The first is a pooler IP and a port for a pool timeout nobody on site can do
// anything about; the second is a real question for the person, wearing a
// function id. They are DIFFERENT KINDS OF THING and the product treated them
// identically: same list, same badge, same silence about what to do next.
//
// This file draws that line, once, in one place:
//
//   USER-FIXABLE -> status 'failed', a closed-vocabulary code naming the slot,
//                   and the row stays in "needs you" with a verb button.
//   SYSTEM       -> status 'failed_system', code INFRA_UNAVAILABLE, a retry
//                   token, the raw text kept for US in error_details and never
//                   sent to a browser, and the row OUT of the needs-you list.
//
// WHY 'failed_system' IS NOT A NEW pipeline_task_status VALUE. schema.ts's own
// comment closes that enum at five ("M24's closed 5-status set, verbatim -- no
// sixth value") and records that extending it needs owner sign-off this lane
// does not have. So 'failed_system' is a classification of the OUTCOME --
// carried on the ExecutionOutcome, returned to the caller, and persisted as
// `blocked` + error_code = 'INFRA_UNAVAILABLE'. Every behaviour C-13 asks for
// (out of needs-you, retryable, raw text kept separately) keys off the CODE,
// which is a column, rather than off a sixth status the schema forbids.
//
// PURE. No DB, no I/O -- asserted in failure-classification.test.ts.

import { SLOT_ERROR_CODES, type SlotErrorCode } from "./function-slots";

/**
 * Every code this pipeline may put on a failed task. The slot codes are
 * function-slots.ts's (D-03's vocabulary, which PROJEXA's task-errors.ts turns
 * into sentences), plus the two this file adds.
 */
export const PIPELINE_ERROR_CODES = [...SLOT_ERROR_CODES, "INFRA_UNAVAILABLE", "UNKNOWN"] as const;
export type PipelineErrorCode = SlotErrorCode | "INFRA_UNAVAILABLE" | "UNKNOWN";

/**
 * The codes NOBODY ON SITE CAN ACT ON. Excluded from the needs-you query and
 * from its count, so "3 needs you" means three decisions a person can actually
 * make -- a number that can be worked down to zero.
 *
 * BACKEND_UNAVAILABLE is here as well as INFRA_UNAVAILABLE because it is the
 * same fact under D-03's older name and rows already carry it.
 */
export const SYSTEM_ERROR_CODES: ReadonlySet<string> = new Set(["INFRA_UNAVAILABLE", "BACKEND_UNAVAILABLE"]);

export function isSystemErrorCode(code: string | null | undefined): boolean {
  return !!code && SYSTEM_ERROR_CODES.has(code);
}

// ---------------------------------------------------------------------------
// MASKING -- the server's own last line of defence
// ---------------------------------------------------------------------------

/** An IPv4 address with an optional port: "3.109.171.244:6543" (the real row). */
const IP_PORT = /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?\b/g;
/** A host with a port: "db.abcdefgh.supabase.co:5432", "localhost:5432". */
const HOST_PORT = /\b(?:[a-z0-9-]+\.)*[a-z0-9-]+:\d{2,5}\b/gi;
/** Transport codes that mean exactly one thing to a person: nothing. */
const TRANSPORT_CODE =
  /\b(?:ECONN[A-Z]+|ETIMEDOUT|ENOTFOUND|EPIPE|EAI_AGAIN|CONNECT_TIMEOUT|POOL_TIMEOUT|SASL|SSL)\b/g;

/**
 * Replace anything identifying infrastructure with words.
 *
 * PROJEXA masks again on its own side (task-errors.ts's maskTechnical) and
 * that is deliberate, not duplication: this endpoint has other consumers --
 * the MCP surface, the assistant route, any future client -- and "the browser
 * will clean it up" is not a property the server may rely on.
 */
export function maskInfrastructure(text: string): string {
  if (!text) return text;
  return text
    .replace(IP_PORT, "the service")
    .replace(TRANSPORT_CODE, "unavailable")
    .replace(HOST_PORT, "the service")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// THE CLASSIFICATION
// ---------------------------------------------------------------------------

/**
 * The patterns that make a failure SYSTEM. Every one of them is a real string
 * this stack produces -- a postgres driver timeout, a pool exhaustion, an
 * upstream 5xx -- not a guess at what an error might say.
 */
const SYSTEM_PATTERNS: readonly RegExp[] = [
  /\b(?:ECONN[A-Z]+|ETIMEDOUT|ENOTFOUND|EPIPE|EAI_AGAIN)\b/,
  /\bCONNECT_TIMEOUT\b/,
  /\bPOOL_TIMEOUT\b/i,
  /\bconnection (?:terminated|timed out|refused|closed)\b/i,
  /\btimeout exceeded when trying to connect\b/i,
  /\bstatement timeout\b/i,
  /\bcanceling statement due to statement timeout\b/i,
  /\bfetch failed\b/i,
  /\bsocket hang up\b/i,
  /\b(?:502|503|504)\b/,
  /\bupstream (?:error|timeout|unavailable)\b/i,
  /\bservice unavailable\b/i,
];

/**
 * The patterns that make a failure the USER'S, with the slot it is about. The
 * executors' own wording, cited so this is a translation of real strings
 * rather than an invention.
 */
const USER_PATTERNS: readonly [RegExp, SlotErrorCode, string[]][] = [
  // executor.ts executeRecordWorkProgress: `itemCode is required`
  [/\bitem\s*code is required\b/i, "BOQ_LINE_REQUIRED", ["itemCode"]],
  [/\bboq[_ ]?line[_ ]?item[_ ]?id\b[^.]*\brequired\b/i, "BOQ_LINE_REQUIRED", ["itemCode"]],
  // executor.ts: `item code "01" not found in this project's BOQ`
  [/\bnot found in this project'?s boq\b/i, "BOQ_LINE_NOT_FOUND", ["itemCode"]],
  // validate.ts: `boq_line_item_id "x" does not exist in this BOQ`
  [/\bdoes not exist in this boq\b/i, "BOQ_LINE_NOT_FOUND", ["boqLineItemId"]],
  // executor.ts: `no BOQ found for project "x"`
  [/\bno boq found for project\b/i, "BOQ_LINE_NOT_FOUND", ["itemCode"]],
  // executor.ts: `no project resolved for this task`
  [/\bno project resolved\b/i, "PROJECT_REQUIRED", ["projectId"]],
  [/\bproject\b[^.]*\bis not reachable\b/i, "PROJECT_REQUIRED", ["projectId"]],
  // executor.ts executeRecordTimesheet: the task fuzzy match
  [/\bno task on this project matches\b/i, "TASK_REQUIRED", ["task"]],
  [/\bmatches \d+ tasks on this project\b/i, "TASK_REQUIRED", ["task"]],
  [/\bwhich task\b/i, "TASK_REQUIRED", ["task"]],
  // executor.ts / validate.ts: the value checks
  [/\b(?:percent|quantity|hours) is required\b/i, "VALUE_REQUIRED", []],
  [/\bmust be a number between 0 and 100\b/i, "VALUE_REQUIRED", ["percent"]],
  [/\bmust be a non-empty string\b/i, "VALUE_REQUIRED", []],
  // run-submission.ts / validate.ts: the function itself
  [/\bno executor is registered\b/i, "FUNCTION_NOT_AVAILABLE", []],
  [/\bis not in this module's candidate set\b/i, "FUNCTION_NOT_AVAILABLE", []],
  [/\bis not permitted to execute\b/i, "FUNCTION_NOT_AVAILABLE", []],
];

export type ClassifiedFailure = {
  /**
   * 'failed' -- a person can fix it, and the row stays in "needs you".
   * 'failed_system' -- nobody on site can, and the row leaves that list.
   */
  status: "failed" | "failed_system";
  code: PipelineErrorCode;
  /** The slots the user has to supply, when the failure names any. */
  missing: string[];
  /**
   * The sentence a CLIENT may render. Masked, and for a system failure
   * replaced outright -- there is nothing in a driver's own words a user can
   * use, and the parts that are useful to us go to error_details.
   */
  message: string;
  /**
   * The raw text, for error_details and the server log. NEVER returned to a
   * browser by any route in this repo -- the whole point of splitting it out
   * of `error` is that one column is safe to render and one is not.
   */
  details: string;
  /**
   * Present only on a system failure: the token a Retry re-submits with, so a
   * retry can be correlated in the logs with the failure that caused it.
   */
  retryToken?: string;
};

/** The one sentence every system failure gets. D-03's wording, verbatim. */
export const SYSTEM_FAILURE_MESSAGE =
  "The construction data service didn't answer — nothing was saved";

/**
 * Classify one failure.
 *
 * ORDER MATTERS AND SYSTEM WINS. A pool timeout that happens to mention a BOQ
 * line is still a pool timeout, and telling a foreman to "pick a BOQ line"
 * when the database did not answer would send them round a loop they cannot
 * get out of.
 */
export function classifyFailure(error: unknown, now: number = Date.now()): ClassifiedFailure {
  const raw = errorText(error);

  if (SYSTEM_PATTERNS.some((p) => p.test(raw))) {
    return {
      status: "failed_system",
      code: "INFRA_UNAVAILABLE",
      missing: [],
      message: SYSTEM_FAILURE_MESSAGE,
      details: raw,
      retryToken: `retry_${now.toString(36)}`,
    };
  }

  for (const [pattern, code, missing] of USER_PATTERNS) {
    if (pattern.test(raw)) {
      return { status: "failed", code, missing: [...missing], message: maskInfrastructure(raw), details: raw };
    }
  }

  // UNKNOWN IS NOT SYSTEM. A failure we cannot classify is still shown to the
  // user with its own (masked) words, because the executors' deliberate,
  // human-authored refusals -- "this BOQ has no line 3.04" -- all land here,
  // and hiding those behind "something went wrong" would lose the one sentence
  // that says what to do.
  return { status: "failed", code: "UNKNOWN", missing: [], message: maskInfrastructure(raw), details: raw };
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const m = (error as { message: unknown }).message;
    if (typeof m === "string") return m;
  }
  return String(error ?? "");
}
