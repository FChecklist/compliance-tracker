// R67 lane B (B-01 / D-03) -- THE CLOSED VOCABULARY.
//
// Before this file, every pipeline failure was a free-text English sentence
// composed in THIS repo and rendered verbatim by PROJEXA's Task Master
// ("itemCode is required", "no project resolved for this task", and -- the
// R66 walkthrough's worst case -- a Postgres driver string carrying an
// internal address, "write CONNECT_TIMEOUT 3.109.171.244:6543"). Programme
// decision D-03 settles that split: THE SERVER RETURNS A CODE, THE CLIENT
// OWNS THE WORDING. compliance-tracker never again emits a user-facing
// sentence for a failure, and projexa's src/lib/task-errors.ts is the one
// place a human sentence exists.
//
// Everything here is PURE -- no DB, no I/O, no model -- so the whole
// vocabulary is exhaustively unit-testable, the same posture validate.ts
// and classify.ts already hold.

/**
 * THE CLOSED SET. D-03 names five (BOQ_LINE_REQUIRED, BOQ_LINE_NOT_FOUND,
 * PROJECT_REQUIRED, VALUE_REQUIRED, BACKEND_UNAVAILABLE); the rest exist
 * because validate()/executeTask() genuinely produce those failures today
 * and dropping them into a catch-all would lose information the user needs
 * to fix the request. Adding a code is a deliberate act: the projexa
 * dictionary must gain a sentence for it in the same programme, or the
 * client renders its "Something went wrong (code X)" fallback.
 */
export const PIPELINE_ERROR_CODES = [
  // --- what the request is missing (the user can fix these) --------------
  "PROJECT_REQUIRED",
  "BOQ_LINE_REQUIRED",
  "VALUE_REQUIRED",
  "DATE_REQUIRED",
  "WORKER_REQUIRED",
  "TITLE_REQUIRED",
  "TASK_REQUIRED",
  "ACTIVITY_REQUIRED",
  "HOURS_REQUIRED",
  "MATERIAL_REQUIRED",
  "QUANTITY_REQUIRED",
  "CATEGORY_REQUIRED",
  "LINK_REQUIRED",
  "BOQ_VERSION_REQUIRED",
  // --- what the request named but does not exist / is not usable ---------
  "BOQ_LINE_NOT_FOUND",
  "BOQ_LINE_IS_PARENT",
  "PROJECT_NOT_REACHABLE",
  "VALUE_OUT_OF_RANGE",
  // R67 FIX PASS -- what a SERVICE refused, in its own 4xx vocabulary. Every
  // executor below calls a real service (recordAttendance, createBoqRevision,
  // createMeeting, ...) and those services throw ServiceError with an honest
  // status for an expected business condition: 404 "Roster entry not found",
  // 409 "Attendance already recorded for this worker on this date". Before
  // these three codes existed, executeTask()'s catch sent every one of them
  // through normaliseThrownError(), which only recognises TRANSPORT shapes --
  // so a duplicate the user can never fix by retrying came out as
  // INTERNAL_ERROR and the client offered [Retry]. A 4xx is a statement about
  // the request, not about our infrastructure, and it is never retryable.
  "RECORD_NOT_FOUND",
  "ALREADY_RECORDED",
  "REQUEST_REJECTED",
  // --- what this account/workspace may not do ----------------------------
  "FUNCTION_NOT_AVAILABLE",
  "NOT_PERMITTED",
  "READ_AS_QUESTION",
  "DEPENDENCY_FAILED",
  // --- what went wrong on our side (never the user's fault) --------------
  "BACKEND_UNAVAILABLE",
  // R67 B-08: distinct from BACKEND_UNAVAILABLE on purpose. The service DID
  // answer -- it cancelled the query for taking too long (Postgres
  // statement_timeout, set to 25 s in tenant-scoped.ts). That is a different
  // fact for whoever is diagnosing it, and a different sentence for the user
  // ("took too long" rather than "didn't answer"), even though both end in
  // the same [Retry]. A CONNECTION timeout stays BACKEND_UNAVAILABLE.
  "UPSTREAM_TIMEOUT",
  "INTERNAL_ERROR",
] as const;

export type PipelineErrorCode = (typeof PIPELINE_ERROR_CODES)[number];

/**
 * B-01's `picker` hint: which chain the client should load to FIX this
 * failure in one click, rather than asking the user to retype the sentence.
 * "none" means there is nothing the user can pick -- BACKEND_UNAVAILABLE is
 * a Retry, not a picker.
 */
export type PickerHint = "boq-line" | "boq-version" | "project" | "value" | "date" | "worker" | "task" | "material" | "none";

const PICKER_BY_CODE: Readonly<Record<PipelineErrorCode, PickerHint>> = {
  PROJECT_REQUIRED: "project",
  BOQ_LINE_REQUIRED: "boq-line",
  VALUE_REQUIRED: "value",
  DATE_REQUIRED: "date",
  WORKER_REQUIRED: "worker",
  TITLE_REQUIRED: "value",
  TASK_REQUIRED: "task",
  ACTIVITY_REQUIRED: "task",
  HOURS_REQUIRED: "value",
  MATERIAL_REQUIRED: "material",
  QUANTITY_REQUIRED: "value",
  CATEGORY_REQUIRED: "value",
  LINK_REQUIRED: "none",
  BOQ_VERSION_REQUIRED: "boq-version",
  BOQ_LINE_NOT_FOUND: "boq-line",
  BOQ_LINE_IS_PARENT: "boq-line",
  PROJECT_NOT_REACHABLE: "project",
  VALUE_OUT_OF_RANGE: "value",
  // A service's 4xx names no single field the user can re-pick -- the record
  // it refused was already chosen from a real list -- so there is no picker
  // to load. The client still offers a destination rather than a [Retry].
  RECORD_NOT_FOUND: "none",
  ALREADY_RECORDED: "none",
  REQUEST_REJECTED: "none",
  FUNCTION_NOT_AVAILABLE: "none",
  NOT_PERMITTED: "none",
  READ_AS_QUESTION: "none",
  DEPENDENCY_FAILED: "none",
  BACKEND_UNAVAILABLE: "none",
  UPSTREAM_TIMEOUT: "none",
  INTERNAL_ERROR: "none",
};

/** Values safe to hand a client: real business identifiers, never internals. */
export type FailureContext = Record<string, string | number | null>;

/**
 * The ONE failure shape every pipeline stage returns. `missing` names the
 * parameter(s) the user still has to supply, in the parameter vocabulary the
 * client's Fix chain understands; `context` carries the real business values
 * a sentence needs to interpolate ({code}, {project}, {version}).
 */
export type PipelineFailure = {
  code: PipelineErrorCode;
  missing: string[];
  context?: FailureContext;
  picker: PickerHint;
};

export function pipelineFailure(code: PipelineErrorCode, missing: string[] = [], context?: FailureContext): PipelineFailure {
  return context && Object.keys(context).length > 0
    ? { code, missing, context, picker: PICKER_BY_CODE[code] }
    : { code, missing, picker: PICKER_BY_CODE[code] };
}

/**
 * Which code a missing/empty parameter deserves. Parameter names come from
 * the real function catalogue (function-registry.ts) and from the classifier's
 * own params, so this is a lookup with a safe default rather than a guess.
 */
const CODE_BY_PARAM: Readonly<Record<string, PipelineErrorCode>> = {
  projectId: "PROJECT_REQUIRED",
  project: "PROJECT_REQUIRED",
  itemCode: "BOQ_LINE_REQUIRED",
  boqLine: "BOQ_LINE_REQUIRED",
  boqLineItemId: "BOQ_LINE_REQUIRED",
  percent: "VALUE_REQUIRED",
  percentComplete: "VALUE_REQUIRED",
  quantity: "QUANTITY_REQUIRED",
  quantityDone: "QUANTITY_REQUIRED",
  date: "DATE_REQUIRED",
  entryDate: "DATE_REQUIRED",
  attendanceDate: "DATE_REQUIRED",
  scheduledAt: "DATE_REQUIRED",
  spentOn: "DATE_REQUIRED",
  rosterId: "WORKER_REQUIRED",
  workerName: "WORKER_REQUIRED",
  name: "WORKER_REQUIRED",
  title: "TITLE_REQUIRED",
  issueId: "TASK_REQUIRED",
  taskId: "TASK_REQUIRED",
  hours: "HOURS_REQUIRED",
  itemId: "MATERIAL_REQUIRED",
  materialId: "MATERIAL_REQUIRED",
  category: "CATEGORY_REQUIRED",
  externalUrl: "LINK_REQUIRED",
  boqId: "BOQ_VERSION_REQUIRED",
  dailyRate: "VALUE_REQUIRED",
};

export function codeForParam(param: string): PipelineErrorCode {
  return CODE_BY_PARAM[param] ?? "VALUE_REQUIRED";
}

/**
 * R67 B-11 -- THE D-03 FIELD VOCABULARY, keyed by parameter name.
 *
 * `missing` is the one field a client may read WITHOUT going through its
 * dictionary (chain-options' band-2 level renders it directly as "which field
 * am I asking for"), so it must never carry a camelCase parameter name. These
 * eight keys are exactly projexa's FIX_PARAMS in src/lib/task-errors.ts --
 * duplicated as strings rather than imported because the two repos deploy
 * separately, the same reason that file duplicates the code list.
 *
 * This is a RENDERING map, not a second rule set: what is required, in what
 * order, and whether it is satisfied is still decided by
 * function-registry.ts's requiredParams and validate().
 */
export const FIELD_VOCABULARY = ["project", "boqLine", "boqVersion", "value", "date", "worker", "material", "task"] as const;

export type FieldVocabularyKey = (typeof FIELD_VOCABULARY)[number];

const VOCABULARY_BY_PARAM: Readonly<Record<string, FieldVocabularyKey>> = {
  projectId: "project",
  project: "project",
  itemCode: "boqLine",
  boqLine: "boqLine",
  boqLineItemId: "boqLine",
  boqId: "boqVersion",
  boqVersion: "boqVersion",
  percent: "value",
  percentComplete: "value",
  quantity: "value",
  quantityDone: "value",
  hours: "value",
  dailyRate: "value",
  value: "value",
  date: "date",
  entryDate: "date",
  attendanceDate: "date",
  scheduledAt: "date",
  spentOn: "date",
  rosterId: "worker",
  workerName: "worker",
  worker: "worker",
  itemId: "material",
  materialId: "material",
  material: "material",
  issueId: "task",
  taskId: "task",
  activityId: "task",
  task: "task",
};

/**
 * The vocabulary key a parameter answers to. An unmapped parameter falls back
 * to its own name ONLY when that name is already a single lower-case word
 * ("title", "name", "category" -- readable, and no worse than the code's own
 * sentence); anything carrying a capital is a camelCase internal name and
 * degrades to "value" rather than reaching a screen.
 */
export function vocabularyKeyForParam(param: string): string {
  const mapped = VOCABULARY_BY_PARAM[param];
  if (mapped) return mapped;
  return /[^a-z]/.test(param) ? "value" : param;
}

/**
 * A TRANSPORT failure, not a user failure. Deliberately a regex over the
 * driver's own message rather than an error-class check: the real R66 case
 * arrived as a plain Error from `postgres`, and the three layers between it
 * and here (drizzle, the service, withTenantContext) each re-wrap without a
 * stable class. The `\b5\d\d\b` clause catches an upstream HTTP 5xx that a
 * fetch-based service surfaced as text.
 */
const ERRNO_PATTERN = /CONNECT_TIMEOUT|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EPIPE|EAI_AGAIN/i;
/**
 * host:port -- an IPv4 address or a hostname with a port, e.g.
 * "3.109.171.244:6543" or "db.example.supabase.co:5432".
 */
const HOST_PORT_PATTERN = /(?:\d{1,3}\.){3}\d{1,3}:\d{2,5}|[a-z0-9.-]+\.[a-z]{2,}:\d{2,5}/i;

const TRANSPORT_PATTERNS: readonly RegExp[] = [
  ERRNO_PATTERN,
  /\b5\d\d\b/,
  /statement timeout|connection terminated|connection closed|timeout exceeded/i,
  HOST_PORT_PATTERN,
];

export function isTransportErrorMessage(message: string): boolean {
  return TRANSPORT_PATTERNS.some((re) => re.test(message));
}

/**
 * R67 FIX PASS -- "is this stored string safe to put in a JSON payload a
 * browser receives?", which is a NARROWER question than "is this a transport
 * error?".
 *
 * compliance.pipeline_tasks holds rows written long before B-01, and their
 * `error` column holds free English -- including the R66 walkthrough's
 * "write CONNECT_TIMEOUT 3.109.171.244:6543". GET /api/v1/projexa/tasks must
 * never ship that internal address to a browser, even in a field nothing
 * renders. It must also not over-reach: isTransportErrorMessage()'s
 * `\b5\d\d\b` clause is right for classifying a THROWN driver error and
 * wrong here, because an ordinary stored sentence like "line 512 not found"
 * would trip it and be mis-told to the user as "the service didn't answer".
 *
 * So this asks only about the two shapes that genuinely disclose internals:
 * a driver errno and a host:port.
 */
export function revealsInternals(message: string): boolean {
  return ERRNO_PATTERN.test(message) || HOST_PORT_PATTERN.test(message);
}

/**
 * B-01's normaliser: an UNEXPECTED thrown error becomes a code, and the raw
 * text survives ONLY in `debug`, which is written to the server log and is
 * never persisted and never selected by GET /api/v1/projexa/tasks.
 */
export function normaliseThrownError(error: unknown): { failure: PipelineFailure; debug: string } {
  const debug = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const code: PipelineErrorCode = isStatementTimeoutMessage(debug)
    ? "UPSTREAM_TIMEOUT"
    : isTransportErrorMessage(debug)
      ? "BACKEND_UNAVAILABLE"
      : "INTERNAL_ERROR";
  return { failure: pipelineFailure(code), debug };
}

/**
 * R67 FIX PASS -- A SERVICE'S OWN 4xx, IN THE CLOSED VOCABULARY.
 *
 * Keyed on the STATUS the service chose, never on its message text: parsing
 * an English sentence back into a code is precisely the drift D-03 exists to
 * remove, and the status is the field every one of the ~137 `throw new
 * ServiceError(msg, n)` call sites already fills in deliberately.
 *
 * Only ever called for status < 500. A 5xx from a service is a system
 * failure and belongs to normaliseThrownError() with the rest of the
 * transport shapes.
 */
export function codeForServiceError(status: number): PipelineErrorCode {
  if (status === 401 || status === 403) return "NOT_PERMITTED";
  if (status === 404) return "RECORD_NOT_FOUND";
  if (status === 409) return "ALREADY_RECORDED";
  return "REQUEST_REJECTED";
}

/**
 * R67 B-08 -- the ONE transport shape that is not "the service didn't
 * answer": Postgres cancelling a query that exceeded statement_timeout
 * (tenant-scoped.ts sets 25 s). The connection was fine and the server
 * replied; the query was simply too slow. Checked BEFORE
 * isTransportErrorMessage() because that predicate matches this text too --
 * deliberately, so a build that has not adopted UPSTREAM_TIMEOUT still
 * degrades to BACKEND_UNAVAILABLE rather than to INTERNAL_ERROR.
 *
 * A CONNECT_TIMEOUT is NOT this: nothing answered at all, so it stays
 * BACKEND_UNAVAILABLE -- which is exactly what B-01's acceptance pins.
 */
export function isStatementTimeoutMessage(message: string): boolean {
  return /canceling statement due to|statement timeout|query_canceled|57014/i.test(message);
}

/**
 * What goes into compliance.pipeline_tasks.error. A stable JSON object, NOT
 * prose and NOT the driver's text -- `debug` is deliberately not a field of
 * PipelineFailure, so there is no way to serialise it here by accident.
 *
 * (B-08 adds real error_code/error_params columns behind a migration; until
 * that lands this column is the only place the code can live, and encoding
 * it as JSON is what lets GET return it structured instead of the client
 * parsing prose.)
 */
export function serialiseFailure(failure: PipelineFailure): string {
  return JSON.stringify({ code: failure.code, missing: failure.missing, context: failure.context ?? null });
}

/**
 * The reverse, for GET. Returns null for a legacy row (every row written
 * before this change holds an English sentence, not JSON) -- the client's
 * own legacyToCode() fallback covers those, so there is exactly ONE legacy
 * mapping in the programme rather than two that drift.
 */
export function parseFailure(stored: string | null | undefined): PipelineFailure | null {
  if (!stored || !stored.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(stored) as { code?: unknown; missing?: unknown; context?: unknown };
    if (typeof parsed.code !== "string" || !(PIPELINE_ERROR_CODES as readonly string[]).includes(parsed.code)) return null;
    const code = parsed.code as PipelineErrorCode;
    const missing = Array.isArray(parsed.missing) ? parsed.missing.filter((m): m is string => typeof m === "string") : [];
    const context = parsed.context && typeof parsed.context === "object" ? (parsed.context as FailureContext) : undefined;
    return pipelineFailure(code, missing, context);
  } catch {
    return null;
  }
}

/**
 * R67 B-06 -- TRANSPORT FAILURES ARE NOT BLOCKED TASKS.
 *
 * "Blocked" in M24's vocabulary means a person has to decide or correct
 * something. A connection timeout is neither: nothing about the user's
 * request was wrong, nothing was saved, and the only sensible next move is to
 * send it again. Minting it as `blocked` put it in the loud, red half of Task
 * Master and told a site engineer they had made a mistake -- exactly the row
 * the R66 walkthrough captured under "write CONNECT_TIMEOUT ...".
 *
 * These codes are therefore recorded as `waiting` (M24's closed 5-status set
 * has no 'retry' value and deliberately does not grow one -- see
 * pipelineTaskStatusEnum's own comment in schema.ts), which the tasks route
 * already groups under "needs you" without the blocked styling, and the
 * client's dictionary pairs with its [Retry] word-button.
 */
export const RETRYABLE_ERROR_CODES: ReadonlySet<PipelineErrorCode> = new Set<PipelineErrorCode>([
  "BACKEND_UNAVAILABLE",
  "UPSTREAM_TIMEOUT",
]);

export function isRetryableFailure(code: PipelineErrorCode): boolean {
  return RETRYABLE_ERROR_CODES.has(code);
}

/**
 * R67 B-08 -- the reverse of what updateTask() writes into the typed columns
 * compliance.pipeline_tasks.error_code / error_params (drizzle/0528).
 * Returns null for a row whose code column is empty or carries a value this
 * build does not know, so GET falls back to parsing the serialised `error`
 * object and, failing that, hands the client a legacy row to map itself.
 */
export function failureFromRow(code: string | null | undefined, params: unknown): PipelineFailure | null {
  if (typeof code !== "string" || !(PIPELINE_ERROR_CODES as readonly string[]).includes(code)) return null;
  const context = params && typeof params === "object" && !Array.isArray(params) ? (params as FailureContext) : undefined;
  return pipelineFailure(code as PipelineErrorCode, [], context);
}

/**
 * gap_log.reason and the console line only. A CODE LINE, not a sentence:
 * "BOQ_LINE_NOT_FOUND missing=itemCode" reads the same to an engineer as the
 * old prose did, and can never leak into the UI as a half-English string
 * because nothing user-facing reads gap_log.
 */
export function failureLogLine(failure: PipelineFailure): string {
  const missing = failure.missing.length > 0 ? ` missing=${failure.missing.join(",")}` : "";
  const context = failure.context ? ` context=${JSON.stringify(failure.context)}` : "";
  return `${failure.code}${missing}${context}`;
}
