// R67 D-03 -- the CODES half of the Task Master error dictionary.
//
// DECISION D-03, verbatim: "One dictionary in the projexa repo
// (src/lib/task-errors.ts) maps executor/validation codes to closed-vocabulary
// sentences and a 'Fix' chain. Codes: BOQ_LINE_REQUIRED ('Pick a BOQ line'),
// BOQ_LINE_NOT_FOUND ('There is no line {code} on {project} {version} -- pick a
// line'), PROJECT_REQUIRED ('Pick a project'), VALUE_REQUIRED ('Type quantity
// or %'), BACKEND_UNAVAILABLE ('The construction data service didn't answer --
// nothing was saved [Retry]'). The server returns {code, missing: [field]} (the
// 'needs_input' payload); the client never shows a camelCase parameter name, a
// function id, or a host:port."
//
// THIS FILE IS THE SERVER'S HALF: the closed code set, the structured failure
// executors return, and the classifier that recovers a code from a row that was
// written before this shipped.
//
// WHY BOTH A STRUCTURED PATH AND A CLASSIFIER. Going forward, executor.ts
// attaches a real code to the failure and run-submission.ts persists it in
// pipeline_tasks.result.failure, so nothing is inferred. But pipeline_tasks
// rows already in the database carry only the human `error` text, and the API
// must not go blank on them -- classifyTaskErrorText() maps that closed,
// human-authored set of sentences (every one of them written in executor.ts in
// this same repo, not free text from a model) back onto the same codes. The
// structured value always wins where it exists.
//
// The client is what turns a code into a sentence. Nothing here writes prose
// for the user, which is exactly what keeps the vocabulary closed.

export const TASK_ERROR_CODES = [
  "PROJECT_REQUIRED",
  "BOQ_LINE_REQUIRED",
  "BOQ_LINE_NOT_FOUND",
  "VALUE_REQUIRED",
  "BACKEND_UNAVAILABLE",
] as const;

export type TaskErrorCode = (typeof TASK_ERROR_CODES)[number];

/**
 * The 'needs_input' payload. `missing` names the parameters the task still
 * needs, by their real parameter key -- the CLIENT owns the human label for
 * each, because a camelCase key must never reach a screen. `context` carries
 * only the values a sentence template needs (a BOQ line code, a BOQ version),
 * never an internal id, host or path.
 */
export type TaskFailure = {
  code: TaskErrorCode;
  missing?: string[];
  context?: { lineCode?: string; boqVersion?: number };
};

export type StructuredFailure = { failure: TaskFailure };

export function isTaskErrorCode(value: unknown): value is TaskErrorCode {
  return typeof value === "string" && (TASK_ERROR_CODES as readonly string[]).includes(value);
}

/** The shape run-submission.ts persists into pipeline_tasks.result on a block. */
export function failureRecord(failure: TaskFailure | undefined): StructuredFailure | undefined {
  return failure ? { failure } : undefined;
}

/**
 * Reads a persisted pipeline_tasks.result back into a TaskFailure, tolerating
 * every other shape that column legitimately holds (a successful task's real
 * result, or null).
 */
export function readFailureRecord(result: unknown): TaskFailure | null {
  if (!result || typeof result !== "object") return null;
  const candidate = (result as { failure?: unknown }).failure;
  if (!candidate || typeof candidate !== "object") return null;
  const code = (candidate as { code?: unknown }).code;
  if (!isTaskErrorCode(code)) return null;
  const rawMissing = (candidate as { missing?: unknown }).missing;
  const missing = Array.isArray(rawMissing) ? rawMissing.filter((m): m is string => typeof m === "string") : undefined;
  const rawContext = (candidate as { context?: unknown }).context;
  const context =
    rawContext && typeof rawContext === "object"
      ? {
          lineCode:
            typeof (rawContext as { lineCode?: unknown }).lineCode === "string"
              ? ((rawContext as { lineCode: string }).lineCode)
              : undefined,
          boqVersion:
            typeof (rawContext as { boqVersion?: unknown }).boqVersion === "number"
              ? ((rawContext as { boqVersion: number }).boqVersion)
              : undefined,
        }
      : undefined;
  return { code, ...(missing && missing.length > 0 ? { missing } : {}), ...(context ? { context } : {}) };
}

// The closed set of sentences executor.ts itself writes. Every pattern below
// corresponds to one `return { success: false, error: ... }` in this repo --
// this is not an attempt to parse arbitrary text, and anything unrecognised
// deliberately yields null rather than a guessed code.
const TEXT_PATTERNS: { pattern: RegExp; build: (m: RegExpMatchArray) => TaskFailure }[] = [
  {
    pattern: /^no project resolved for this task$/i,
    build: () => ({ code: "PROJECT_REQUIRED", missing: ["projectId"] }),
  },
  {
    pattern: /^itemCode is required$/i,
    build: () => ({ code: "BOQ_LINE_REQUIRED", missing: ["itemCode"] }),
  },
  {
    pattern: /^percent is required$/i,
    build: () => ({ code: "VALUE_REQUIRED", missing: ["percent"] }),
  },
  {
    pattern: /^item code "(.+)" not found in this project's BOQ$/i,
    build: (m) => ({ code: "BOQ_LINE_NOT_FOUND", context: { lineCode: m[1] } }),
  },
  {
    // executeTask()'s own catch-all for an unexpected throw (a DB timeout, a
    // network error). It is already sanitised prose -- this only gives it a
    // code so the client can offer Retry rather than re-print it.
    pattern: /^This couldn't be completed right now due to an internal error/i,
    build: () => ({ code: "BACKEND_UNAVAILABLE" }),
  },
];

/**
 * Recovers a code from a pipeline_tasks row written before the structured
 * failure existed. Returns null for anything outside the closed set, which the
 * client renders as the backend's own (already human) words.
 */
export function classifyTaskErrorText(error: string | null | undefined): TaskFailure | null {
  const text = (error ?? "").trim();
  if (!text) return null;
  for (const { pattern, build } of TEXT_PATTERNS) {
    const match = text.match(pattern);
    if (match) return build(match);
  }
  return null;
}

/**
 * The one function the API route calls: the persisted structured failure when
 * there is one, else the classified text, else null.
 */
export function resolveTaskFailure(result: unknown, error: string | null | undefined): TaskFailure | null {
  return readFailureRecord(result) ?? classifyTaskErrorText(error);
}
