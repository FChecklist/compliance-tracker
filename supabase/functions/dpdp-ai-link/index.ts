// WO-DPDP-013 Part 1 -- the AI work link's API, as a Supabase Edge Function
// (Deno). Vercel is not in this path. See README.md alongside.
//
// Relative to the link base (https://app.veridian-aios.com/ai/<token>,
// proxied by dpdp-app/functions/ai/[[path]].ts; on this function the same
// paths sit under /functions/v1/dpdp-ai-link/<token>):
//
//   GET  /                 manual (HTML)      GET /manual.md  GET /manual.json
//   GET  /context          GET /jobs[?part&status&late&today&mine&nobody]
//   GET  /jobs/{id}        GET /law/{code}    GET /report/{kind}[?format=md|csv]
//   GET  /history          POST /actions      POST /drafts
//   GET  /snapshot.md      (the pre-WO-013 page; <token>.md and /draft still work)
//
// The token IS the credential: an AI tool fetches these with no headers at
// all, so the function is deployed with verify_jwt = false and calls the
// database with the service-role client, which (with app_runtime, for the
// repo's tests) is the only role granted the public.dpdp_ai_link_* RPCs
// (drizzle/0610). The database decides everything -- which rows, whether
// the link is live, which level it has, whether a verb is allowed, whether
// a job is in scope; this file only routes, renders and maps errors. The
// pure halves (router.ts, manual.ts, facts.ts, api-definition.ts, law.ts,
// render.ts) carry no Deno globals and are unit-tested with bun.
//
// EVERY call is logged against the link (dpdp_ai_link_log_call before, the
// status and byte count after), and the per-link rate limit (120 per
// minute) is decided from that log. Undo tokens and confirm tokens travel
// in URL FRAGMENTS (`#undo=`, `#draft=`), never a path or query string, so
// they never reach a server log (WO-012 §2).
//
// The service-role key never leaves this process: it is an env secret the
// platform injects, used only to construct the client below, and no
// response body or log line ever includes it or the caller's token.
import { createClient } from "npm:@supabase/supabase-js@2"
import { renderHtml, renderMarkdown, type AiLinkView } from "./render.ts"
import {
  LINK_GONE, contentTypeFor, errorBody, isRateLimited, jobFilters, lawWithWords, methodFor, negotiateFormat, offeredFormats, paginate, parseRoute, relativePathOf,
  renderHistoryMarkdown, renderJobMarkdown, renderJobsCsv, renderJobsMarkdown, renderLawMarkdown, renderReportCsv, renderReportMarkdown,
  type HistoryEntry, type JobDetail, type JobRow, type LawPayload, type ReportPayload, type Route,
} from "./router.ts"
import { buildManual, renderManualHtml, renderManualJson, renderManualMarkdown, type ContextPayload } from "./manual.ts"
import { MAX_BODY_BYTES, RATE_LIMIT, type Format } from "./api-definition.ts"

const FUNCTION_NAME = "dpdp-ai-link"
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
// Defaults to the production static-app origin so the function works with
// only the platform-injected env (function secrets cannot be set from the
// PM's machine -- same reason as dpdp-monday-email).
const APP_ORIGIN = (Deno.env.get("APP_ORIGIN") || "https://app.veridian-aios.com").replace(/\/+$/, "")

function privateHeaders(contentType: string, extra?: Record<string, string>): HeadersInit {
  return {
    "content-type": contentType,
    // The *.supabase.co gateway serves HTML as text/plain; the Pages proxy
    // restores the intended type from this header (see dpdp-app/functions/ai/_proxy.ts).
    "x-dpdp-content-type": contentType,
    "x-robots-tag": "noindex, nofollow, noarchive, nosnippet",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    ...(extra ?? {}),
  }
}

function text(status: number, body: string, contentType = "text/plain; charset=utf-8"): Response {
  return new Response(body.endsWith("\n") ? body : body + "\n", { status, headers: privateHeaders(contentType) })
}
function json(status: number, body: unknown, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: privateHeaders("application/json; charset=utf-8", extra) })
}
function fail(status: number, error: string, hint?: string): Response {
  return json(status, errorBody(status, error, hint))
}
function formatted(format: Format, body: string): Response {
  return new Response(body, { status: 200, headers: privateHeaders(contentTypeFor(format)) })
}

// Errors the database raises on purpose, with plain-English messages meant
// for the caller. Anything else is an internal error and is not echoed.
type DbError = { code?: string; message: string }
function mapDbError(e: DbError, notFoundIs404 = false): Response {
  const code = e.code ?? ""
  if (code === "42501" && e.message.includes(LINK_GONE)) return fail(410, LINK_GONE, "Ask the person for a new link.")
  if (code === "42501") return fail(403, e.message)
  if (code === "P0002") return fail(notFoundIs404 ? 404 : 400, e.message)
  if (code === "22023" || code === "P0001" || code === "22007" || code === "22008" || code === "22P02") return fail(400, e.message)
  console.error(`${FUNCTION_NAME}: database error (${code || "?"})`)
  return fail(500, "Something failed on our side. Try again in a minute.")
}

function dbClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<{ data: T; error: null } | { data: null; error: DbError }> {
  const { data, error } = await dbClient().rpc(name, args)
  if (error) return { data: null, error: { code: error.code ?? undefined, message: error.message } }
  return { data: data as T, error: null }
}

async function readBody(req: Request): Promise<{ verb: string; jobId: string | null; value: Record<string, unknown> } | Response> {
  const raw = await req.text()
  if (raw.length > MAX_BODY_BYTES) return fail(413, "Request body is too large (8 KB at most).")
  let body: { verb?: unknown; job_id?: unknown; jobId?: unknown; obligationId?: unknown; value?: unknown; payload?: unknown }
  try {
    body = JSON.parse(raw || "{}")
  } catch {
    return fail(400, "Body must be JSON: { verb, job_id, value }.")
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "Body must be a JSON object: { verb, job_id, value }.")
  const verb = typeof body.verb === "string" ? body.verb : ""
  const jobRaw = body.job_id ?? body.jobId ?? body.obligationId
  const jobId = typeof jobRaw === "string" && jobRaw.trim() ? jobRaw.trim() : null
  const valueRaw = body.value ?? body.payload
  const value = valueRaw && typeof valueRaw === "object" && !Array.isArray(valueRaw) ? (valueRaw as Record<string, unknown>) : {}
  return { verb, jobId, value }
}

/** The link base the manual and every relative path are written against: the app's own /ai/<token>. */
function linkBase(token: string): string {
  return `${APP_ORIGIN}/ai/${token}`
}

async function handle(req: Request, token: string, route: Route, url: URL): Promise<Response> {
  const q = url.searchParams
  const accept = req.headers.get("accept")

  switch (route.kind) {
    case "manual": {
      const format = negotiateFormat(offeredFormats("manual"), q.get("format"), route.format === "html" ? accept : null, route.format)
      const r = await rpc<ContextPayload>("dpdp_ai_link_context", { p_token: token })
      if (r.error) return mapDbError(r.error)
      const manual = buildManual({ context: r.data, base: linkBase(token), now: new Date() })
      if (format === "json") return formatted("json", renderManualJson(manual))
      if (format === "md") return formatted("md", renderManualMarkdown(manual))
      return formatted("html", renderManualHtml(manual))
    }
    case "snapshot": {
      const r = await rpc<AiLinkView>("dpdp_ai_link_read", { p_token: token })
      if (r.error) return mapDbError(r.error)
      const base = linkBase(token)
      const opts = { draftEndpoint: `${base}/drafts`, markdownUrl: `${base}/snapshot.md`, htmlUrl: `${base}/snapshot`, now: new Date() }
      return route.format === "md" ? formatted("md", renderMarkdown(r.data, opts)) : formatted("html", renderHtml(r.data, opts))
    }
    case "context": {
      const r = await rpc<ContextPayload>("dpdp_ai_link_context", { p_token: token })
      if (r.error) return mapDbError(r.error)
      return json(200, { ...r.data, base: linkBase(token) })
    }
    case "jobs": {
      const format = negotiateFormat(offeredFormats("jobs"), q.get("format"), accept, "json")
      const r = await rpc<JobRow[]>("dpdp_ai_link_jobs", { p_token: token, p_filters: jobFilters(q) })
      if (r.error) return mapDbError(r.error)
      const page = paginate(r.data, q.get("page"), q.get("per_page"))
      if (format === "csv") return formatted("csv", renderJobsCsv(page))
      if (format === "md") {
        const ctx = await rpc<ContextPayload>("dpdp_ai_link_context", { p_token: token })
        return formatted("md", renderJobsMarkdown(page, ctx.error ? "this organisation" : ctx.data.org.name))
      }
      return json(200, page)
    }
    case "job": {
      const format = negotiateFormat(offeredFormats("job"), q.get("format"), accept, "json")
      const r = await rpc<JobDetail>("dpdp_ai_link_job", { p_token: token, p_job_id: route.id })
      if (r.error) return mapDbError(r.error, true)
      return format === "md" ? formatted("md", renderJobMarkdown(r.data)) : json(200, r.data)
    }
    case "law": {
      const format = negotiateFormat(offeredFormats("law"), q.get("format"), accept, "json")
      const r = await rpc<LawPayload>("dpdp_ai_link_law", { p_token: token, p_code: route.code })
      if (r.error) return mapDbError(r.error)
      const law = lawWithWords(r.data)
      return format === "md" ? formatted("md", renderLawMarkdown(law)) : json(200, law)
    }
    case "report": {
      const format = negotiateFormat(offeredFormats("report"), q.get("format"), accept, "json")
      const r = await rpc<ReportPayload>("dpdp_ai_link_report", { p_token: token, p_kind: route.report })
      if (r.error) return mapDbError(r.error)
      if (format === "md") return formatted("md", renderReportMarkdown(r.data))
      if (format === "csv") return formatted("csv", renderReportCsv(r.data))
      return json(200, r.data)
    }
    case "history": {
      const format = negotiateFormat(offeredFormats("history"), q.get("format"), accept, "json")
      const r = await rpc<HistoryEntry[]>("dpdp_ai_link_history", { p_token: token })
      if (r.error) return mapDbError(r.error)
      const page = paginate(r.data, q.get("page"), q.get("per_page"))
      if (format === "md") {
        const ctx = await rpc<ContextPayload>("dpdp_ai_link_context", { p_token: token })
        return formatted("md", renderHistoryMarkdown(page, ctx.error ? "this organisation" : ctx.data.org.name))
      }
      return json(200, page)
    }
    case "actions": {
      const body = await readBody(req)
      if (body instanceof Response) return body
      const r = await rpc<{ actionId: string; verb: string; jobId: string; appliedAt: string; undoableUntil: string; undoToken: string; recorded: string }>(
        "dpdp_ai_link_action", { p_token: token, p_verb: body.verb, p_job_id: body.jobId, p_value: body.value },
      )
      if (r.error) return mapDbError(r.error)
      const { undoToken, ...rest } = r.data
      return json(201, {
        ...rest,
        undoUrl: `${APP_ORIGIN}/app/#undo=${rest.actionId}.${undoToken}`,
        next: "Done, under the person's own authority. Tell them what changed and give them undoUrl -- it undoes this one change for 24 hours, in their own browser.",
      })
    }
    case "drafts": {
      const body = await readBody(req)
      if (body instanceof Response) return body
      const r = await rpc<{ draftId: string; confirmToken: string; verb: string; jobId: string | null; expiresAt: string; executableOnConfirm: boolean }>(
        "dpdp_ai_link_draft", { p_token: token, p_verb: body.verb, p_job_id: body.jobId, p_value: body.value },
      )
      if (r.error) return mapDbError(r.error)
      const { confirmToken, ...rest } = r.data
      return json(201, {
        ...rest,
        // 0607's `draftUrl` name is kept alongside so the pre-WO-013 clients keep working.
        confirmUrl: `${APP_ORIGIN}/app/#draft=${rest.draftId}.${confirmToken}`,
        draftUrl: `${APP_ORIGIN}/app/#draft=${rest.draftId}.${confirmToken}`,
        next: rest.executableOnConfirm
          ? "Give confirmUrl to the person. They open it in their own browser, sign in, and confirm. Nothing has changed yet."
          : "Give confirmUrl to the person. This kind of draft is recorded for them but cannot be executed from the confirm screen yet -- they will be told to do it on their page. Nothing has changed.",
      })
    }
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error(`${FUNCTION_NAME}: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing`)
    return text(500, "This service is not configured.")
  }
  const url = new URL(req.url)
  const parsed = parseRoute(url.pathname)
  if ("error" in parsed) return parsed.error === 401 ? fail(401, parsed.message) : fail(404, parsed.message)
  const { token, route } = parsed
  const method = req.method === "HEAD" ? "GET" : req.method
  const relativePath = relativePathOf(url.pathname)

  // Every call logged, before it is served; the rate limit is decided from
  // this link's own count in the last minute. A bad token is logged with
  // no link and then refused by the data call exactly as before.
  const begun = await rpc<{ callId: string; linkId: string | null; callsLastMinute: number }>("dpdp_ai_link_log_call", { p_token: token, p_method: method, p_path: relativePath + (url.search ? "?" : "") })
  const callId = begun.error ? null : begun.data.callId
  const finish = async (res: Response): Promise<Response> => {
    if (callId) {
      const bytes = Number(res.headers.get("content-length")) || (res.body ? undefined : 0)
      await rpc("dpdp_ai_link_log_call_result", { p_call_id: callId, p_status: res.status, p_bytes: bytes ?? null })
    }
    return res
  }

  if (!begun.error && isRateLimited(begun.data.callsLastMinute)) {
    return finish(fail(429, `Over the rate limit (${RATE_LIMIT.perMinute} calls per minute per link). Wait a minute.`))
  }
  const expected = methodFor(route)
  if (method !== expected) return finish(new Response(JSON.stringify(errorBody(405, `Use ${expected} for this path.`)), { status: 405, headers: privateHeaders("application/json; charset=utf-8", { allow: expected }) }))

  try {
    const res = await handle(req, token, route, url)
    const body = await res.clone().arrayBuffer()
    const withLength = new Response(body, { status: res.status, headers: res.headers })
    withLength.headers.set("content-length", String(body.byteLength))
    return finish(withLength)
  } catch (e) {
    console.error(`${FUNCTION_NAME}: unhandled`, e instanceof Error ? e.message : String(e))
    return finish(fail(500, "Something failed on our side. Try again in a minute."))
  }
})
