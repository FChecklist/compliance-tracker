// PROJEXA-BUILD-001 U-46b1 (spec sections 3, 4, 6, 10.5, 10.9; register rows BR-480, BR-482): the request handler of the ai-work-link Edge Function
// (the universal AI work link, first half: the read layer). The database is passed in as `deps.rpc`, so bun runs this REAL handler in
// src/lib/services/ai-work-link-router.test.ts with fakes; index.ts only wires Deno.serve and the service-role client.
//
// WHAT THE HANDLER OWNS: the address (path mode and header mode), the ORDER of checks, the private headers on every response, and the
// answer to every route. WHAT IT NEVER DOES: build SQL (every read is a call to a public.ai_work_link_* function of drizzle/0624 to 0626,
// reached with the service-role key), run a pipeline function, call a model, or take the organisation or project from the caller.
//
// ORDER OF CHECKS on a link address (section 4.3):
//   query-string token (400) -> token shape (404) -> CALL LOG (503; over the limit 429) -> link resolve (410) -> effective level, function and project (403)
//   -> body and parameters (400, 413, 422) -> availability (503).
//   Two notes. (1) The 120-a-minute and 30-a-minute limits are decided INSIDE ai_work_link_log_call, so the 429 comes with the call-log step; it is
//   still before any data is read. (2) A malformed token creates no log row, exactly like the DPDP function.
//
// FAIL CLOSED. The call-log row is written BEFORE anything is answered. If ai_work_link_log_call errors, throws, or answers a shape this file
// does not know, the answer is 503 and no data is read or returned (section 10.5, fixing the DPDP fail-open).
//
// NOT IN THIS UNIT (a later unit writes them; each answers with the section 4.3 shape and says so):
//   POST /functions/{fn} and POST /actions: 503 "not switched on yet" once scope passes (no Edge executor: spike S-1), 501 if ever switched on early;
//   POST /drafts: 501 after scope passes; the signed-in app routes (mint, links, warning, drafts/{id}/preview): 401 with no session, else 501.
// BUILT IN U-47b: POST /drafts/{id}/confirm (confirm.ts), when index.ts wires the session verifier (session.ts).
//
// The token is never logged and never echoed: log lines carry a route name and a status only, and errorBody scrubs anything token-shaped.
import {
  CORS_PREFLIGHT_HEADERS, LIMITS, LINK_GONE, NO_QUERY_TOKEN, contentTypeFor, errorBody, hasQueryToken, isRateLimited, linkBase, negotiateFormat, paginate,
  parseTarget, privateHeaders, relativePathOf, remainingCalls, throttleAddress, tokenFromHeaders, uaFamilyOf, type Format,
} from "../_shared/ai-link/core.ts"
import { CARD_DATA_DEFAULT_KINDS, KIND_NAMES, functionDef, matchEndpoint, type EndpointId } from "./api-definition.ts"
import { renderCard, renderCardData, renderManualJson, renderManualMarkdown, type ManualInput } from "./manual.ts"
import { handleConfirm } from "./confirm.ts"
import { handleMcp, type McpReads } from "./mcp.ts"
import { buildOpenApi, buildSwagger } from "./openapi.ts"
import {
  AwlError, checkChange, effectiveFunctionViews, fail, proposeChange, readContext, readHistory, readIntent, readRecord, readRecords, resolveLink,
  searchRecords, fetchRecord, type AwlConfig, type LinkCtx, type ReadEnv, type Rpc,
} from "./reads.ts"
import type { SessionVerifier } from "./session.ts"
import { contextMarkdown, functionsMarkdown, historyMarkdown, intentMarkdown, proposalMarkdown, recordMarkdown, recordsCsv, recordsMarkdown } from "./render.ts"

export type { AwlConfig, Rpc } from "./reads.ts"

export type AwlDeps = {
  rpc: Rpc
  config: AwlConfig
  log?: (line: string) => void
  /** Verifies a signed-in person's access token (session.ts). Without it every app route keeps its 401 / 501 answers (U-46b1). */
  session?: SessionVerifier
  /** Milliseconds since the epoch for the confirm route's per-person brake; the test passes its own clock. */
  now?: () => number
}

const ALLOW_ALL = "GET, HEAD, POST, OPTIONS"

/** What public.ai_work_link_log_call answers (drizzle/0624): ok, gone, unknown, throttled (with a scope) or malformed. */
type LoggedCall = { status: string; call_id?: string; calls_last_minute?: number; limit_per_minute?: number; scope?: string }

type Out = { status: number; contentType: string | null; body: string | null; headers?: Record<string, string> }

const json = (status: number, body: unknown, headers?: Record<string, string>): Out => ({ status, contentType: contentTypeFor("json"), body: JSON.stringify(body), headers })
const text = (format: Format, body: string): Out => ({ status: 200, contentType: contentTypeFor(format), body })
const plain = (status: number, message: string, hint?: string, headers?: Record<string, string>): Out => json(status, errorBody(status, message, hint), headers)
const fromError = (e: AwlError): Out => json(e.status, e.body, e.headers)

function bodyBytes(s: string): number {
  return new TextEncoder().encode(s).length
}

/** The JSON object of a POST body: empty is {}, over 8 KB is 413, anything that is not a JSON object is 400. */
async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  const raw = await req.text()
  if (bodyBytes(raw) > LIMITS.bodyMaxBytes) throw fail(413, "The body is over 8 KB.")
  if (raw.trim() === "") return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw fail(400, "The body must be JSON.")
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw fail(400, "The body must be a JSON object.")
  return parsed as Record<string, unknown>
}

const APP_ROUTES: ReadonlyArray<{ pattern: string[]; methods: string[] }> = [
  { pattern: ["mint"], methods: ["POST"] },
  { pattern: ["links"], methods: ["GET"] },
  { pattern: ["links", ":id", "revoke"], methods: ["POST"] },
  { pattern: ["warning"], methods: ["GET", "POST"] },
  { pattern: ["drafts", ":id", "preview"], methods: ["GET"] },
  { pattern: ["drafts", ":id", "confirm"], methods: ["POST"] },
]

/**
 * Routes for a signed-in person (section 3.4 app-route): a user session token in Authorization, no link token. With none the answer is a
 * plain 401 (these are not link-token routes, section 3.6, AWL-H18) and never a WWW-Authenticate challenge. POST /drafts/{id}/confirm is built
 * (confirm.ts, U-47b) when the session verifier is wired; every other app route belongs to a later unit and answers 501 with a session.
 */
async function appRoute(req: Request, route: string[], deps: AwlDeps): Promise<Out> {
  const method = req.method === "HEAD" ? "GET" : req.method
  const hit = APP_ROUTES.find((r) => r.pattern.length === route.length && r.pattern.every((seg, i) => seg.startsWith(":") || seg === route[i]))
  if (!hit) return plain(404, "No such path")
  if (!hit.methods.includes(method)) return plain(405, "Wrong method for this path.", undefined, { Allow: hit.methods.join(", ") })
  if (deps.session && route.length === 3 && route[0] === "drafts" && route[2] === "confirm") {
    // confirm.ts answers its own 401s (with a stable code), so it reads the Authorization header itself
    let done
    try {
      done = await handleConfirm(req, route[1], { rpc: deps.rpc, session: deps.session, log: deps.log, now: deps.now })
    } catch {
      (deps.log ?? console.log)("ai-work-link: confirm: unhandled error -> 500")
      return plain(500, "Something failed on our side. Try again in a minute.")
    }
    return json(done.status, done.body, done.headers)
  }
  const bearer = /^Bearer[ ]+([^\s]+)$/i.exec((req.headers.get("authorization") ?? "").trim())
  if (!bearer || bearer[1].startsWith("pxa_")) return plain(401, "Sign in to PROJEXA and send your session token in the Authorization header.", "A link token is not a session.")
  return plain(501, "Written in a later unit.")
}

export async function handleAwl(req: Request, deps: AwlDeps): Promise<Response> {
  const log = deps.log ?? ((line: string) => console.log(line))
  const method = req.method.toUpperCase()
  const head = method === "HEAD"
  let remaining: number | null = null
  let retryAfter: number | null = null

  const finish = (out: Out): Response => {
    const headers = privateHeaders(out.contentType, { remaining, retryAfter: out.status === 429 ? (retryAfter ?? LIMITS.retryAfterSeconds) : null, extra: out.headers })
    const body = head || out.body === null ? null : out.body
    return new Response(body, { status: out.status, headers })
  }

  if (method === "OPTIONS") return new Response(null, { status: 204, headers: privateHeaders(null, { extra: CORS_PREFLIGHT_HEADERS }) })

  const url = new URL(req.url)
  if (hasQueryToken(url.searchParams)) return finish(plain(400, NO_QUERY_TOKEN))

  const target = parseTarget(url.pathname)
  if (target.kind === "error") return finish(plain(target.status, target.message))
  if (target.kind === "app") return finish(await appRoute(req, target.route, deps))

  const token = target.mode === "path" ? target.token : tokenFromHeaders(req.headers)
  if (!token) return finish(plain(404, LINK_GONE, "In header mode send the token in the Link-Token header."))
  const rest = target.rest
  const mode = target.mode
  const base = linkBase(deps.config.functionBase, mode === "path" ? token : null)

  // 1. THE CALL LOG, before anything is read or answered (fail closed) ---------------------------------------------------------------
  let callId: string | null = null
  let logged: LoggedCall | null = null
  try {
    const res = await deps.rpc("ai_work_link_log_call", {
      p_token: token,
      p_method: method,
      p_path: relativePathOf(rest),
      p_ip_prefix: throttleAddress(req.headers.get("x-forwarded-for"), deps.config.addressPosition),
      p_ua_family: uaFamilyOf(req.headers.get("user-agent")),
    })
    if (!res.error && res.data && typeof res.data === "object") logged = res.data as LoggedCall
  } catch {
    logged = null
  }
  const known = logged?.status
  if (!logged || !(known === "ok" || known === "gone" || known === "unknown" || known === "throttled" || known === "malformed")) {
    log("ai-work-link: call log unavailable -> 503, nothing read")
    return finish(plain(503, "Service unavailable. Try again in a minute.", "The call log could not be written, so nothing was read."))
  }
  if (known === "malformed") return finish(plain(404, LINK_GONE))
  if (known === "throttled") {
    remaining = 0
    retryAfter = LIMITS.retryAfterSeconds
    return finish(plain(429, logged.scope === "address" ? "Too many calls with an unknown or expired link. Wait a minute." : `Over the rate limit (${LIMITS.linkPerMinute} calls per minute per link). Wait a minute.`))
  }
  callId = typeof logged.call_id === "string" ? logged.call_id : null
  const limit = typeof logged.limit_per_minute === "number" ? logged.limit_per_minute : known === "ok" ? LIMITS.linkPerMinute : LIMITS.unknownPerMinute
  const calls = typeof logged.calls_last_minute === "number" ? logged.calls_last_minute : 0
  remaining = remainingCalls(calls, limit)

  // The result of the call, written after the answer is known (best effort: the row itself is already safe).
  const settle = async (out: Out): Promise<Response> => {
    const res = finish(out)
    if (callId) {
      try {
        await deps.rpc("ai_work_link_log_call_result", { p_call_id: callId, p_status: out.status, p_bytes: out.body === null ? 0 : bodyBytes(out.body) })
      } catch {
        log("ai-work-link: call result not recorded")
      }
    }
    return res
  }

  if (isRateLimited(calls, limit)) {
    retryAfter = LIMITS.retryAfterSeconds
    return settle(plain(429, `Over the rate limit (${limit} calls per minute). Wait a minute.`))
  }
  if (known !== "ok") return settle(plain(410, LINK_GONE, "Ask the person for a new link."))

  try {
    // 2. THE LIVE LINK: effective level, functions and role, read now (section 10.9) ----------------------------------------------------
    const ctx = await resolveLink(deps.rpc, token)
    const env: ReadEnv = { rpc: deps.rpc, token, ctx, config: deps.config, base, mode }
    if (!["GET", "HEAD", "POST"].includes(method)) return await settle(plain(405, "Wrong method for this path.", undefined, { Allow: ALLOW_ALL }))

    // 3. ROUTE ---------------------------------------------------------------------------------------------------------------------------
    if (rest.length === 0 && (method === "GET" || head) && (req.headers.get("accept") ?? "").toLowerCase().includes("text/event-stream")) {
      return await settle(plain(405, "Use POST for MCP.", undefined, { Allow: "POST" }))
    }
    const hit = matchEndpoint(rest, method)
    if (hit.kind === "none") return await settle(plain(404, "No such path"))
    if (hit.kind === "method") return await settle(plain(405, "Wrong method for this path.", undefined, { Allow: hit.allow.join(", ") }))
    const out = await route(hit.matched.endpoint.id, hit.matched.params, req, url, env)
    return await settle(out)
  } catch (e) {
    if (e instanceof AwlError) return settle(fromError(e))
    log("ai-work-link: unhandled error -> 500")
    return settle(plain(500, "Something failed on our side. Try again in a minute."))
  }
}

function formatOf(req: Request, url: URL, offered: ReadonlyArray<Format>): Format {
  return negotiateFormat(offered, url.searchParams.get("format"), req.headers.get("accept"), "md")
}

function manualInput(env: ReadEnv): ManualInput {
  return { base: env.base, mode: env.mode, token: env.mode === "path" ? env.token : null, config: env.config, ctx: env.ctx, functions: effectiveFunctionViews(env) }
}

/** Scope of a change request (section 4.3): the function must be on the effective list and any projectId must be the link's own. */
function requireScope(ctx: LinkCtx, fn: unknown, params: Record<string, unknown>): void {
  const id = typeof fn === "string" ? fn : ""
  if (!id || !ctx.effective_functions.includes(id)) throw fail(403, "This link may not use that function.", "GET /functions lists what this link may use now.", { code: "FUNCTION_NOT_ON_LINK" })
  if (params.projectId !== undefined && params.projectId !== null && params.projectId !== ctx.project_id) {
    throw fail(403, "This link is for one project only.", "Leave projectId out: the link supplies it.", { code: "WRONG_PROJECT" })
  }
}

function notSwitchedOn(env: ReadEnv, what: string): AwlError {
  if (!env.config.executorEnabled || !env.ctx.writes_enabled) {
    return fail(503, `${what} is not switched on yet.`, "It is written in a later unit; reading, checking and proposing work now.", { available: false })
  }
  return fail(501, "Written in a later unit.")
}

async function route(id: EndpointId, params: Record<string, string>, req: Request, url: URL, env: ReadEnv): Promise<Out> {
  const { ctx, config } = env
  switch (id) {
    case "manual": {
      const f = formatOf(req, url, ["md", "json"])
      return f === "json" ? json(200, renderManualJson(manualInput(env))) : text("md", renderManualMarkdown(manualInput(env)))
    }
    case "manual_md":
      return text("md", renderManualMarkdown(manualInput(env)))
    case "manual_json":
      return json(200, renderManualJson(manualInput(env)))
    case "card":
      return text("md", renderCard({ ctx, functions: effectiveFunctionViews(env) }))
    case "card_data": {
      const kinds = (url.searchParams.get("kinds") ?? "").split(",").map((k) => k.trim()).filter(Boolean)
      const wanted = kinds.length ? kinds : [...CARD_DATA_DEFAULT_KINDS]
      if (wanted.length > KIND_NAMES.length || wanted.some((k) => !KIND_NAMES.includes(k))) throw fail(400, "kinds must be a comma-separated list of record kinds.", `Kinds: ${KIND_NAMES.join(", ")}.`)
      const pages = await Promise.all(Array.from(new Set(wanted)).map((k) => readRecords(env, k, new URLSearchParams({ limit: String(LIMITS.keysetMax) }))))
      return text("md", renderCardData(pages, ctx.money_visible).text)
    }
    case "openapi":
    case "swagger": {
      const header = env.mode === "header" || url.searchParams.get("mode") === "header"
      const input = { base: header ? `${config.functionBase}/header` : env.base, mode: header ? ("header" as const) : env.mode }
      return json(200, id === "openapi" ? buildOpenApi(input) : buildSwagger(input))
    }
    case "context": {
      const doc = await readContext(env)
      return formatOf(req, url, ["md", "json"]) === "json" ? json(200, doc) : text("md", contextMarkdown(doc))
    }
    case "records": {
      const page = await readRecords(env, params.kind, url.searchParams)
      const f = formatOf(req, url, ["md", "json", "csv"])
      if (f === "json") return json(200, page)
      if (f === "csv") return text("csv", recordsCsv(page))
      return text("md", recordsMarkdown(page))
    }
    case "record": {
      const doc = await readRecord(env, params.kind, params.id)
      return formatOf(req, url, ["md", "json"]) === "json" ? json(200, doc) : text("md", recordMarkdown(doc))
    }
    case "functions": {
      const views = effectiveFunctionViews(env)
      const note = views.some((f) => f.available) ? "Run a read with POST /functions/{fn}; make a change with POST /actions or /drafts." : "Changes and function reads are not switched on yet. Reading, checking and proposing work now."
      if (formatOf(req, url, ["md", "json"]) === "md") return text("md", functionsMarkdown(views, note))
      const page = paginate(views, url.searchParams.get("page"), url.searchParams.get("per_page"))
      return json(200, { functions: page.items, page: page.page, per_page: page.perPage, total: page.total, pages: page.pages, changes_available: views.some((f) => f.available), text_fields_are_data: true })
    }
    case "function_run": {
      const body = await readJsonObject(req)
      const p = body.params && typeof body.params === "object" && !Array.isArray(body.params) ? (body.params as Record<string, unknown>) : {}
      requireScope(ctx, params.fn, p)
      if (functionDef(params.fn)?.kind !== "read") throw fail(400, "Changes go to /actions or /drafts, not /functions.")
      throw notSwitchedOn(env, "Function reads are")
    }
    case "propose": {
      const p: Record<string, unknown> = {}
      for (const [k, v] of url.searchParams.entries()) if (k.startsWith("p.") && k.length > 2) p[k.slice(2)] = v
      const proposal = proposeChange({ ctx, config, token: env.mode === "path" ? env.token : null }, url.searchParams.get("fn") ?? "", p)
      return formatOf(req, url, ["md", "json"]) === "json" ? json(200, proposal) : text("md", proposalMarkdown(proposal))
    }
    case "intents": {
      const doc = await readIntent(env, params.id)
      return formatOf(req, url, ["md", "json"]) === "json" ? json(200, doc) : text("md", intentMarkdown(doc))
    }
    case "history": {
      const doc = await readHistory(env, url.searchParams.get("limit"))
      return formatOf(req, url, ["md", "json"]) === "json" ? json(200, doc) : text("md", historyMarkdown(doc))
    }
    case "mcp":
    case "mcp_path": {
      const reads: McpReads = {
        context: () => readContext(env),
        records: (k, q) => readRecords(env, k, q),
        record: (k, i) => readRecord(env, k, i),
        history: (l) => readHistory(env, l),
        search: (q) => searchRecords(env, q),
        fetch: (i) => fetchRecord(env, i),
        check: (fn, p) => checkChange({ ctx, config }, fn, p),
        propose: (fn, p) => proposeChange({ ctx, config, token: env.mode === "path" ? env.token : null }, fn, p),
      }
      const res = await handleMcp({ headers: req.headers, bodyText: await req.text() }, reads)
      return res.body === null ? { status: res.status, contentType: null, body: null } : json(res.status, res.body)
    }
    case "check": {
      const body = await readJsonObject(req)
      return json(200, checkChange({ ctx, config }, body.function, body.params))
    }
    case "actions": {
      const body = await readJsonObject(req)
      const p = body.params && typeof body.params === "object" && !Array.isArray(body.params) ? (body.params as Record<string, unknown>) : {}
      requireScope(ctx, body.function, p)
      const def = functionDef(String(body.function))
      if (def?.kind !== "write") throw fail(400, "Reads go to /functions or /records, not /actions.")
      if (ctx.effective_level < 1 || def.link_level !== 1) throw fail(403, "This change needs the person's confirmation: use /drafts.", undefined, { code: "LEVEL_NOT_ALLOWED" })
      const check = checkChange({ ctx, config }, body.function, body.params)
      if (!check.valid) throw fail(422, "The change is not valid yet.", check.problems.join(" ") || undefined, { code: "PARAMS_INVALID", missing: check.missing })
      throw notSwitchedOn(env, "Changes are")
    }
    case "drafts": {
      const body = await readJsonObject(req)
      const p = body.params && typeof body.params === "object" && !Array.isArray(body.params) ? (body.params as Record<string, unknown>) : {}
      requireScope(ctx, body.function, p)
      if (functionDef(String(body.function))?.kind !== "write") throw fail(400, "Reads go to /functions or /records, not /drafts.")
      throw fail(501, "Written in a later unit.", "Drafts are recorded and confirmed by a later unit. Use /check or /propose for now.")
    }
  }
}
