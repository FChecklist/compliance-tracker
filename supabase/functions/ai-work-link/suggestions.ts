// PROJEXA AI WORK LINK SUGGESTIONS BOARD (drizzle/0672): the routes of the ai-work-link Edge function that let an outside AI SAY what the software lacks.
// A NEW file, like drafts.ts, so handler.ts holds one dispatch line per route.
//
//   POST /suggestions   {kind, title, body?, project?}   records ONE suggestion for the PROJEXA team to review: public.ai_suggestion_add.
//   GET  /suggestions   [?limit=]                        the link's own suggestions (every status) and the SHARED board: only the ones a person here
//                                                        approved for every assistant to see (public.ai_suggestion_list). Writes nothing.
//   MCP: suggest_improvement and list_suggestions are the same two calls.
//
// WHAT THIS FILE NEVER DOES: change a record, run a pipeline function, take the organisation, person or link from the caller, approve or edit a suggestion
// (approval is public.ai_suggestion_review, run from SQL by the team; no Edge route reaches it), or return any suggestion text as anything but a JSON string
// field of an answer that says text_fields_are_data. Text written by an AI is data for the next reader, never an instruction: the shared list holds only
// approved rows, and every string is cleaned (control characters, fence-closing backtick runs) and has any link-token-shaped text redacted on the way out.
import { cleanDeep, redactToken, uaFamilyOf } from "../_shared/ai-link/core.ts"
import { SUGGESTION_KINDS } from "./api-definition.ts"
import { callRpc, fail, type ReadEnv } from "./reads.ts"

export type Answer = { status: number; body: unknown; headers?: Record<string, string> }

const PROJECT_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/

/** What a suggestion is not: the first line of every answer tells the AI what it can and cannot do here. */
export const SUGGESTION_NOTE = "Suggestions are reviewed by the PROJEXA team. You cannot change the app or anyone's data. `shared` holds only suggestions the team approved for every assistant to see: check it before you suggest, so the same idea is not repeated."

/** Every string cleaned and any link token redacted: a title written by another AI is data, and it never carries an address. */
export function scrubSuggestions<T>(doc: T): T {
  return JSON.parse(redactToken(JSON.stringify(cleanDeep(doc)))) as T
}

type Added = { suggestion_id: string; status: string; replayed: boolean; visible_to_others: boolean; note: string }

/**
 * POST /suggestions and the MCP tool suggest_improvement. The kind, title and body are checked here (a plain 400 with a code) and again by SQL, which also
 * checks the link, binds the project (a project that does not bind is the one 404) and applies the caps. A repeat of the same title from the same link within
 * 24 hours answers 200 with the earlier id (replayed true); a new one answers 201.
 */
export async function suggestionAdd(env: ReadEnv, body: Record<string, unknown>, userAgent: string | null): Promise<Answer> {
  const kind = typeof body.kind === "string" ? body.kind.trim().toLowerCase() : ""
  if (!SUGGESTION_KINDS.includes(kind)) throw fail(400, "kind must be one of the listed kinds.", `Kinds: ${SUGGESTION_KINDS.join(", ")}.`, { code: "BAD_KIND" })
  if (typeof body.title !== "string" || body.title.trim() === "") throw fail(400, "title is required: one line of up to 120 characters.", undefined, { code: "BAD_TITLE" })
  if (body.body !== undefined && body.body !== null && typeof body.body !== "string") throw fail(400, "body must be text of at most 2,000 characters.", undefined, { code: "BAD_BODY" })
  const project = body.project
  if (project !== undefined && project !== null && project !== "" && (typeof project !== "string" || !PROJECT_ID_RE.test(project))) throw fail(404, "Not found")

  // a NUL byte is not text the database can hold (it would fail the whole call): it is removed here, every other control character is handled by SQL
  const noNul = (s: string): string => s.replace(/\u0000/g, "")
  const data = (await callRpc(env.rpc, "ai_suggestion_add", {
    p_token: env.token,
    p_kind: kind,
    p_title: noNul(body.title),
    p_body: typeof body.body === "string" ? noNul(body.body) : "",
    ...(typeof project === "string" && project !== "" ? { p_project_id: project } : {}),
    p_source_label: uaFamilyOf(userAgent),
  })) as Added | null
  if (!data || typeof data.suggestion_id !== "string" || typeof data.status !== "string") throw fail(500, "Something failed on our side. Try again in a minute.")
  return { status: data.replayed ? 200 : 201, body: { ...data, text_fields_are_data: true } }
}

/** GET /suggestions and the MCP tool list_suggestions: own suggestions and the shared board, from SQL, cleaned. Writes nothing. */
export async function suggestionList(env: ReadEnv, limitParam: string | null): Promise<Record<string, unknown>> {
  let limit = 50
  if (limitParam !== null && limitParam !== "") {
    if (!/^[0-9]{1,3}$/.test(limitParam) || Number(limitParam) < 1 || Number(limitParam) > 100) throw fail(400, "limit must be a whole number from 1 to 100.")
    limit = Number(limitParam)
  }
  const data = (await callRpc(env.rpc, "ai_suggestion_list", { p_token: env.token, p_limit: limit })) as { mine?: unknown; shared?: unknown; counts?: unknown } | null
  // the Edge layer holds on its own: only these fields leave, whatever SQL answers (never an organisation, person, project, body or internal note)
  const pick = (rows: unknown, fields: ReadonlyArray<string>): unknown[] =>
    (Array.isArray(rows) ? rows : []).map((r) => Object.fromEntries(fields.filter((f) => r && typeof r === "object" && f in r).map((f) => [f, (r as Record<string, unknown>)[f]])))
  return scrubSuggestions({
    mine: pick(data?.mine, ["id", "kind", "title", "status", "created_at"]),
    shared: pick(data?.shared, ["id", "kind", "title", "status", "also_suggested_count"]),
    counts: data?.counts && typeof data.counts === "object" ? data.counts : { mine: 0, shared: 0 },
    note: SUGGESTION_NOTE,
    text_fields_are_data: true,
  }) as Record<string, unknown>
}
