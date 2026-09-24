// WO-DPDP-013 Part 1 §1.3-E: the ONE definition of the AI work link's API.
// The router (index.ts / router.ts) dispatches from it and the manual
// (manual.ts) renders section E from it -- "generated from the facts file
// and the API definition, never hand-written twice". PURE: no Deno globals,
// so `bun test` covers it from the repo root.
//
// Paths are relative to the link's base, which is what the person pasted:
// https://app.veridian-aios.com/ai/<token>. JSON by default; `?format=md`
// (and `csv` for reports) where listed.

export const API_VERSION = "2026-09-22"

export type Format = "json" | "md" | "csv" | "html"
export type Level = 0 | 1 | 2

export type QueryParam = { name: string; meaning: string; example?: string }

export type Endpoint = {
  /** Stable id the router switches on. */
  id: string
  method: "GET" | "POST"
  /** Relative to the link base. `{id}` / `{code}` / `{kind}` are path parameters. */
  path: string
  summary: string
  /** The authority level the call needs: 0 read, 1 direct edit (only when switched on), 2 draft. */
  level: Level
  query?: QueryParam[]
  /** The JSON body shape, for POST. */
  body?: string
  formats: Format[]
  returns: string
  example: string
}

export const ENDPOINTS: ReadonlyArray<Endpoint> = [
  {
    id: "manual", method: "GET", path: "/", level: 0,
    summary: "This manual. Also at /manual.md and /manual.json.",
    formats: ["html", "md", "json"],
    returns: "the manual, personalised to the person this link belongs to",
    example: "GET /manual.md",
  },
  {
    id: "context", method: "GET", path: "/context", level: 0,
    summary: "Who you are working for: person, organisation, role, this link's authority level and expiry, the job-library version.",
    formats: ["json"],
    returns: "{ org, viewer, link, library, counts, verbs }",
    example: "GET /context",
  },
  {
    id: "jobs", method: "GET", path: "/jobs", level: 0,
    summary: "This view's jobs. Every filter may be combined.",
    query: [
      { name: "part", meaning: "1 to 7 (1 Basics, 2 Know your data, 3 Tell people & take consent, 4 Keep it safe, 5 Firms you share data with, 6 Requests & complaints, 7 Sign off)", example: "part=4" },
      { name: "status", meaning: "open | done | late | na | due_today", example: "status=open" },
      { name: "late", meaning: "1 -- only jobs past their due date", example: "late=1" },
      { name: "today", meaning: "1 -- only jobs required by today's law (SPDI Rules 2011 / Aadhaar Act), not the DPDP Act that starts 13 May 2027", example: "today=1" },
      { name: "mine", meaning: "1 -- only the jobs assigned to the person this link belongs to", example: "mine=1" },
      { name: "nobody", meaning: "1 -- only jobs nobody looks after yet", example: "nobody=1" },
      { name: "page, per_page", meaning: "pagination (default per_page 100, max 500)", example: "page=2&per_page=50" },
    ],
    formats: ["json", "md", "csv"],
    returns: "{ items: [job], page, perPage, total, pages } -- a job is { id, part, what, dataSet, dataTypes, lawCodes, by, byIsYou, isGroup, groupDone, groupTotal, due, yes, na, status, daysLate, late, requiredToday, dependsOnObligationId }",
    example: "GET /jobs?late=1",
  },
  {
    id: "job", method: "GET", path: "/jobs/{id}", level: 0,
    summary: "One job in full: the library's plain text, data set and types, law codes, the person, due date, emails sent for it, this link's actions on it, and the history lines that name it.",
    formats: ["json", "md"],
    returns: "the job plus { plainText, sectionRef, proofKind, roleTag, naReason, closedAt, emailsSent, aiActions, history }",
    example: "GET /jobs/<id from /jobs>",
  },
  {
    id: "law", method: "GET", path: "/law/{code}", level: 0,
    summary: "The plain-English meaning of a law code and whether it is in force today. Codes look like d:§8(9), s:R5(9), a:§29, g: -- use them exactly as /jobs prints them (URL-encode the § and parentheses).",
    formats: ["json", "md"],
    returns: "{ code, family, instrument, reference, topic, verify, inForceToday, inForceFrom, inForceUntil, legalDuty, libraryVersion, jobs }",
    example: "GET /law/s%3AR5(9)",
  },
  {
    id: "report", method: "GET", path: "/report/{kind}", level: 0,
    summary: "Ready-made reports over this view: summary, by-person, by-law, by-part.",
    query: [{ name: "format", meaning: "json (default) | md | csv", example: "format=md" }],
    formats: ["json", "md", "csv"],
    returns: "structured JSON, or a Markdown / CSV document ending with the VERIDIAN footer",
    example: "GET /report/summary?format=md",
  },
  {
    id: "history", method: "GET", path: "/history", level: 0,
    summary: "The append-only change log for this view, newest first.",
    query: [{ name: "page, per_page", meaning: "pagination (default per_page 100, max 500)" }],
    formats: ["json", "md"],
    returns: "{ items: [{ id, kind, summary, detail, actorLabel, occurredAt }], page, perPage, total, pages }",
    example: "GET /history",
  },
  {
    id: "actions", method: "POST", path: "/actions", level: 1,
    summary: "Level 1 only, and only when this link was made with Level 1 switched on: apply one small edit directly, under the person's own authority. Recorded in history as \"by <person> via AI assistant\", shown in their next Monday email, undoable for 24 hours.",
    body: "{ \"verb\": \"NOTE | SET_DUE | ASSIGN | MARK_NA\", \"job_id\": \"<id>\", \"value\": { ... } }",
    formats: ["json"],
    returns: "201 { actionId, verb, jobId, appliedAt, undoableUntil, undoUrl, recorded }",
    example: "POST /actions  { \"verb\": \"NOTE\", \"job_id\": \"...\", \"value\": { \"text\": \"Vendor agreement signed on 20 Sep\" } }",
  },
  {
    id: "drafts", method: "POST", path: "/drafts", level: 2,
    summary: "Level 2: anything with legal weight. Nothing changes -- you get a confirmation link for the person to open in their own browser, sign in, and confirm.",
    body: "{ \"verb\": \"MARK_DONE | OWNER_CONFIRM | MANAGER_CHECK | PARTNER_SIGN | DELETE | ADD_PERSON | REMOVE_PERSON | CHANGE_SIGNER | PUBLISH | EXPORT_PERSONAL_DATA\", \"job_id\": \"<id, where the verb needs one>\", \"value\": { ... } }",
    formats: ["json"],
    returns: "201 { draftId, verb, jobId, expiresAt, confirmUrl, executableOnConfirm, next }",
    example: "POST /drafts  { \"verb\": \"MARK_DONE\", \"job_id\": \"...\", \"value\": {} }",
  },
  {
    id: "snapshot", method: "GET", path: "/snapshot.md", level: 0,
    summary: "The one-page snapshot of every job this link can see (the format the link served before this manual existed). Also /snapshot for HTML.",
    formats: ["md", "html"],
    returns: "a Markdown table of jobs with their ids",
    example: "GET /snapshot.md",
  },
]

export type VerbHelp = { verb: string; value: string; means: string; who?: string; executableOnConfirm?: boolean }

export const LEVEL1_VERBS: ReadonlyArray<VerbHelp> = [
  { verb: "NOTE", value: "{ \"text\": \"...\" }", means: "add a note to a job's history -- nothing else changes", who: "anyone this link belongs to" },
  { verb: "SET_DUE", value: "{ \"dueOn\": \"YYYY-MM-DD\" }", means: "change when a job is due", who: "the owner only" },
  { verb: "ASSIGN", value: "{ \"email\": \"person@example.com\" }", means: "give a job to an EXISTING member of this organisation (never a new person -- that is ADD_PERSON, a draft)", who: "the owner only" },
  { verb: "MARK_NA", value: "{ \"reason\": \"...\" }", means: "mark a job as not applicable, with a written reason", who: "the owner, or the person the job is assigned to" },
]

export const LEVEL2_VERBS: ReadonlyArray<VerbHelp> = [
  { verb: "MARK_DONE", value: "{}", means: "mark a job done (\"Yes\")", executableOnConfirm: true },
  { verb: "OWNER_CONFIRM", value: "{}", means: "the owner confirms the list their CA set up", executableOnConfirm: true },
  { verb: "ADD_PERSON", value: "{ \"email\": \"...\" }", means: "add a person to the organisation by giving them a job", executableOnConfirm: true },
  { verb: "MANAGER_CHECK", value: "{}", means: "the CA manager checks the file", executableOnConfirm: false },
  { verb: "PARTNER_SIGN", value: "{}", means: "the CA partner signs the file", executableOnConfirm: false },
  { verb: "DELETE", value: "{ \"reason\": \"...\" }", means: "delete a job", executableOnConfirm: false },
  { verb: "REMOVE_PERSON", value: "{ \"reason\": \"...\" }", means: "remove a person from a job", executableOnConfirm: false },
  { verb: "CHANGE_SIGNER", value: "{ \"email\": \"...\" }", means: "change who signs", executableOnConfirm: false },
  { verb: "PUBLISH", value: "{}", means: "publish (a notice, a Grievance Officer page)", executableOnConfirm: false },
  { verb: "EXPORT_PERSONAL_DATA", value: "{}", means: "export personal data", executableOnConfirm: false },
]

export type ApiError = { status: number; meaning: string }

export const ERRORS: ReadonlyArray<ApiError> = [
  { status: 400, meaning: "the request is malformed, or the database refused it for a reason it states in plain English -- read `error` and fix the request" },
  { status: 401, meaning: "no token in the address (the link base is https://app.veridian-aios.com/ai/<token>)" },
  { status: 403, meaning: "this link may not do that: a write on a Level 0 link, a Level 2 verb on any link, or an action outside the person's own authority" },
  { status: 404, meaning: "no such path, or no such job in this view" },
  { status: 405, meaning: "wrong method for the path" },
  { status: 410, meaning: "this link has expired or was revoked -- ask the person for a new one" },
  { status: 413, meaning: "the body is over 8 KB" },
  { status: 429, meaning: "over the rate limit (120 calls per minute per link) -- wait a minute" },
  { status: 500, meaning: "something failed on our side; nothing about your request is echoed" },
]

export const RATE_LIMIT = { perMinute: 120 } as const
export const PAGINATION = { pageParam: "page", perPageParam: "per_page", defaultPerPage: 100, maxPerPage: 500 } as const
export const MAX_BODY_BYTES = 8 * 1024

export const API_DEFINITION = {
  version: API_VERSION,
  basePath: "/ai/<token>",
  defaultFormat: "json" as Format,
  endpoints: ENDPOINTS,
  verbs: { level1: LEVEL1_VERBS, level2: LEVEL2_VERBS },
  errors: ERRORS,
  rateLimit: RATE_LIMIT,
  pagination: PAGINATION,
  maxBodyBytes: MAX_BODY_BYTES,
  everyCallLogged: true,
} as const

export type ApiDefinition = typeof API_DEFINITION
