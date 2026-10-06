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
//   POST /functions/{fn}: 503 "not switched on yet" once scope passes (the reads run on the exec host), 501 if ever switched on early;
//   the signed-in app routes (mint, links, warning): 401 with no session, else 501.
// BUILT IN U-47b: POST /drafts/{id}/confirm (confirm.ts), when index.ts wires the session verifier (session.ts).
// BUILT IN BUILD-002 WP-09a (drafts.ts, one dispatch line each): POST /drafts, GET /drafts/{id}, GET|POST /drafts/{id}/preview (a session), and
//   POST /actions, which refuses with the true reason while the switch is off and claims and runs an intent once the exec function is wired.
//
// THE USER-WIDE LINK (drizzle/0668): a link of scope `user` belongs to a person, not to a project. Its context has a null project until a route binds one: GET /projects
// and GET /portfolio list and report, and /projects/{id}/<endpoint> answers as <endpoint> does, inside that project (bindProject: the database re-checks the project now,
// and any project that does not bind is a 404). Outside a project it may only draft create_project; everything else is 400 PROJECT_REQUIRED. POST /user-link (mint.ts) makes it.
//
// The token is never logged and never echoed: log lines carry a route name and a status only, and errorBody scrubs anything token-shaped.
import {
  CORS_PREFLIGHT_HEADERS, LIMITS, LINK_GONE, NO_QUERY_TOKEN, ROBOTS_DOC, contentTypeFor, errorBody, hasQueryToken, isRateLimited, linkBase, negotiateFormat, paginate,
  parseTarget, privateHeaders, relativePathOf, remainingCalls, throttleAddress, tokenFromHeaders, uaFamilyOf, type Format,
} from "../_shared/ai-link/core.ts"
import { CARD_DATA_DEFAULT_KINDS, KIND_NAMES, USER_LEVEL_IDS, bodyLimitFor, functionDef, kb, matchEndpoint, underlyingOf, type EndpointId } from "./api-definition.ts"
import { suggestionAdd, suggestionList } from "./suggestions.ts"
import { INLINE_PROJECTS_MAX, allAddresses, renderCard, renderCardData, renderManualJson, renderManualMarkdown, type ManualInput } from "./manual.ts"
import { handleConfirm } from "./confirm.ts"
import { handlePersonSetting } from "./person-settings.ts"
import { actionCreate, draftCreate, draftGet, draftPreview } from "./drafts.ts"
import { handleMcp, type McpReads } from "./mcp.ts"
import { handleMint, isMintRoute } from "./mint.ts"
import { buildOpenApi, buildSwagger } from "./openapi.ts"
import {
  AwlError, availabilityOf, checkChange, effectiveFunctionViews, fail, proposeChange, readContext, readHistory, readIntent, readPortfolio, readProjects, readRecord, readRecords,
  requireScope, resolveInProject, resolveLink, searchRecords, fetchRecord, type AwlConfig, type ExecClient, type LinkCtx, type ReadEnv, type Rpc,
} from "./reads.ts"
import type { SessionVerifier } from "./session.ts"
import { renderWorkspace } from "./workspace.ts"
import { contextMarkdown, functionsMarkdown, historyMarkdown, intentMarkdown, portfolioMarkdown, projectsMarkdown, proposalMarkdown, recordMarkdown, recordsCsv, recordsMarkdown, suggestionsMarkdown } from "./render.ts"

export type { AwlConfig, Rpc } from "./reads.ts"

export type AwlDeps = {
  rpc: Rpc
  config: AwlConfig
  log?: (line: string) => void
  /** Verifies a signed-in person's access token (session.ts). Without it every app route keeps its 401 / 501 answers (U-46b1). */
  session?: SessionVerifier
  /** Milliseconds since the epoch for the confirm route's per-person brake; the test passes its own clock. */
  now?: () => number
  /** The client of the ai-work-link-exec function (exec-client.ts). Absent when the function is not deployed: no change can run, so every direct change answers 503. */
  exec?: ExecClient
  /**
   * Keeps background work alive after the response is sent (index.ts wires EdgeRuntime.waitUntil). Without it the call-result write is still fire-and-forget:
   * it is started at once, never awaited, and its failure is swallowed.
   */
  defer?: (work: Promise<unknown>) => void
  /** Time box in milliseconds for each database read on the way to an answer (the call log, the link resolve). Default DB_TIMEOUT_MS. */
  dbTimeoutMs?: number
}

/** Chat AI fetchers give up after roughly 5 to 10 seconds, so a database that is slower than this is answered with a clear 503, never left to hang. */
export const DB_TIMEOUT_MS = 4000
/** The call-result write runs after the answer and may never delay or fail it; this only stops the background promise from living forever. */
const RESULT_WRITE_TIMEOUT_MS = 5000

class DbTimeout extends Error {}

/** Races `work` against a timer; the timer is always cleared. A loser's late result or rejection is ignored. */
function timeBox<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const clock = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DbTimeout("db timeout")), ms)
  })
  work.catch(() => undefined)
  return Promise.race([work, clock]).finally(() => clearTimeout(timer))
}

const ALLOW_ALL = "GET, HEAD, POST, OPTIONS"

/** What public.ai_work_link_log_call answers (drizzle/0624): ok, gone, unknown, throttled (with a scope) or malformed. */
type LoggedCall = { status: string; call_id?: string; calls_last_minute?: number; limit_per_minute?: number; scope?: string }

/** `robots` replaces the X-Robots-Tag: ROBOTS_DOC on the guide and its documents (core.ts), the default everywhere else. */
type Out = { status: number; contentType: string | null; body: string | null; headers?: Record<string, string>; robots?: string }

const json = (status: number, body: unknown, headers?: Record<string, string>): Out => ({ status, contentType: contentTypeFor("json"), body: JSON.stringify(body), headers })
const text = (format: Format, body: string): Out => ({ status: 200, contentType: contentTypeFor(format), body })
const plain = (status: number, message: string, hint?: string, headers?: Record<string, string>): Out => json(status, errorBody(status, message, hint), headers)
const fromError = (e: AwlError): Out => json(e.status, e.body, e.headers)

function bodyBytes(s: string): number {
  return new TextEncoder().encode(s).length
}

/**
 * The JSON object of a POST body: empty is {}, over its function's limit is 413, anything that is not a JSON object is 400. The limit is
 * LIMITS.bodyMaxBytes (8 KB) unless the generated policy gives the function more (bodyLimitFor); the function is `fn` when the path names
 * it, else the body's own `function`. A body over the ceiling (64 KB) is refused before it is parsed.
 */
async function readJsonObject(req: Request, fn?: string): Promise<Record<string, unknown>> {
  const raw = await req.text()
  const size = bodyBytes(raw)
  if (size > LIMITS.bodyMaxBytesCeiling) throw fail(413, `The body is over ${kb(LIMITS.bodyMaxBytesCeiling)}.`)
  if (size > LIMITS.bodyMaxBytes && raw.trim() === "") throw fail(413, `The body is over ${kb(LIMITS.bodyMaxBytes)}.`)
  if (raw.trim() === "") return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    if (size > LIMITS.bodyMaxBytes) throw fail(413, `The body is over ${kb(LIMITS.bodyMaxBytes)}.`)
    throw fail(400, "The body must be JSON.")
  }
  const isObject = !!parsed && typeof parsed === "object" && !Array.isArray(parsed)
  const cap = bodyLimitFor(fn ?? (isObject ? (parsed as Record<string, unknown>).function : undefined))
  if (size > cap) throw fail(413, `The body is over ${kb(cap)}.`)
  if (!isObject) throw fail(400, "The body must be a JSON object.")
  return parsed as Record<string, unknown>
}

const APP_ROUTES: ReadonlyArray<{ pattern: string[]; methods: string[] }> = [
  { pattern: ["mint"], methods: ["POST"] },
  { pattern: ["links"], methods: ["GET"] },
  { pattern: ["links", ":id", "revoke"], methods: ["POST"] },
  { pattern: ["warning"], methods: ["GET", "POST"] },
  { pattern: ["new-project"], methods: ["POST"] },
  { pattern: ["user-link"], methods: ["POST"] },
  { pattern: ["drafts", ":id", "preview"], methods: ["GET", "POST"] },
  { pattern: ["drafts", ":id", "confirm"], methods: ["POST"] },
  // lf-b2-ai-crud: the signed-in person's own "let my AI act without asking" switch (person-settings.ts)
  { pattern: ["settings", "act-without-asking"], methods: ["GET", "POST"] },
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
      done = await handleConfirm(req, route[1], { rpc: deps.rpc, session: deps.session, log: deps.log, now: deps.now, exec: deps.config.execPresent ? deps.exec : undefined })
    } catch {
      (deps.log ?? console.log)("ai-work-link: confirm: unhandled error -> 500")
      return plain(500, "Something failed on our side. Try again in a minute.")
    }
    return json(done.status, done.body, done.headers)
  }
  if (deps.session && isMintRoute(route)) {
    // mint.ts (BUILD-002 WP-08) answers its own 401s (with a stable code), so it reads the Authorization header itself
    let made
    try {
      made = await handleMint(req, route, { rpc: deps.rpc, session: deps.session, config: deps.config, log: deps.log, now: deps.now })
    } catch {
      (deps.log ?? console.log)("ai-work-link: mint routes: unhandled error -> 500")
      return plain(500, "Something failed on our side. Try again in a minute.")
    }
    return json(made.status, made.body, made.headers)
  }
  if (deps.session && route.length === 2 && route[0] === "settings" && route[1] === "act-without-asking") {
    // the same session, brake and identity gates as the confirm route; a link token is a 401 there
    let set
    try {
      set = await handlePersonSetting(req, { rpc: deps.rpc, session: deps.session, log: deps.log, now: deps.now })
    } catch {
      (deps.log ?? console.log)("ai-work-link: person setting: unhandled error -> 500")
      return plain(500, "Something failed on our side. Try again in a minute.")
    }
    return json(set.status, set.body, set.headers)
  }
  if (deps.session && route.length === 3 && route[0] === "drafts" && route[2] === "preview") {
    // the preview shows a person what they are about to confirm: same session, brake and identity gates as the confirm (drafts.ts)
    let shown
    try {
      shown = await draftPreview(req, route[1], { rpc: deps.rpc, session: deps.session, log: deps.log, now: deps.now })
    } catch {
      (deps.log ?? console.log)("ai-work-link: preview: unhandled error -> 500")
      return plain(500, "Something failed on our side. Try again in a minute.")
    }
    return json(shown.status, shown.body, shown.headers)
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

  // AUDIT-100 (ChatGPT, 2026-10-05): ChatGPT's web reader refuses a page served as text/markdown ("rejected the text/markdown response").
  // The words are the same, so a plain fetch gets text/plain; only a caller that asks for text/markdown in Accept gets that type.
  const readerSafe = (contentType: string | null): string | null =>
    contentType?.startsWith("text/markdown") && !(req.headers.get("accept") ?? "").toLowerCase().includes("text/markdown") ? "text/plain; charset=utf-8" : contentType

  const finish = (out: Out): Response => {
    const headers = privateHeaders(readerSafe(out.contentType), { remaining, retryAfter: out.status === 429 ? (retryAfter ?? LIMITS.retryAfterSeconds) : null, extra: out.headers, robots: out.robots })
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
  const dbMs = deps.dbTimeoutMs ?? DB_TIMEOUT_MS
  try {
    const res = await timeBox(deps.rpc("ai_work_link_log_call", {
      p_token: token,
      p_method: method,
      p_path: relativePathOf(rest),
      p_ip_prefix: throttleAddress(req.headers.get("x-forwarded-for"), deps.config.addressPosition),
      p_ua_family: uaFamilyOf(req.headers.get("user-agent")),
    }), dbMs)
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
  // It is started now but NEVER awaited: the answer does not wait for it, and its failure or slowness changes nothing the caller sees.
  const settle = async (out: Out): Promise<Response> => {
    const res = finish(out)
    if (callId) {
      try {
        const write = timeBox(Promise.resolve(deps.rpc("ai_work_link_log_call_result", { p_call_id: callId, p_status: out.status, p_bytes: out.body === null ? 0 : bodyBytes(out.body) })), RESULT_WRITE_TIMEOUT_MS)
          .catch(() => log("ai-work-link: call result not recorded"))
        deps.defer?.(write)
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
    let ctx: LinkCtx
    try {
      ctx = await timeBox(resolveLink(deps.rpc, token), dbMs)
    } catch (e) {
      if (e instanceof DbTimeout) throw fail(503, "Service unavailable. Try again in a minute.", "The link check is slow right now; nothing was read.")
      throw e
    }
    const env: ReadEnv = { rpc: deps.rpc, token, ctx, config: deps.config, base, mode, exec: deps.exec }
    if (!["GET", "HEAD", "POST"].includes(method)) return await settle(plain(405, "Wrong method for this path.", undefined, { Allow: ALLOW_ALL }))

    // 3. ROUTE ---------------------------------------------------------------------------------------------------------------------------
    if (rest.length === 0 && (method === "GET" || head) && (req.headers.get("accept") ?? "").toLowerCase().includes("text/event-stream")) {
      return await settle(plain(405, "Use POST for MCP.", undefined, { Allow: "POST" }))
    }
    const hit = matchEndpoint(rest, method)
    if (hit.kind === "none") return await settle(plain(404, "No such path"))
    if (hit.kind === "method") return await settle(plain(405, "Wrong method for this path.", undefined, { Allow: hit.allow.join(", ") }))
    const opts: RouteOpts = { dbMs, now: deps.now ?? Date.now, footer: footerFor(env, hit.matched.params.pid ?? null) }
    const out = await route(hit.matched.endpoint.id, hit.matched.params, req, url, env, opts)
    return await settle(withFooter(out, hit.matched.endpoint.id, opts.footer))
  } catch (e) {
    if (e instanceof AwlError) return settle(fromError(e))
    log("ai-work-link: unhandled error -> 500")
    return settle(plain(500, "Something failed on our side. Try again in a minute."))
  }
}

const actionOut = (a: { status: number; body: unknown; headers?: Record<string, string> }): Out => json(a.status, a.body, a.headers)

function formatOf(req: Request, url: URL, offered: ReadonlyArray<Format>): Format {
  return negotiateFormat(offered, url.searchParams.get("format"), req.headers.get("accept"), "md")
}

function manualInput(env: ReadEnv): ManualInput {
  return { base: env.base, mode: env.mode, token: env.mode === "path" ? env.token : null, config: env.config, ctx: env.ctx, functions: effectiveFunctionViews(env) }
}

/** `footer`: the "All addresses" footer of a link made for a person (manual.ts allAddresses), null on a link for one project. */
type RouteOpts = { dbMs: number; now: () => number; footer: string | null }

/** The footer of a link made for a PERSON (AUDIT-100, owner decision 2026-10-06), with the project's own reads when the answer is inside one. */
function footerFor(env: ReadEnv, projectId: string | null): string | null {
  return env.ctx.scope === "user" && env.ctx.project_id === null ? allAddresses(env.base, projectId) : null
}

/** The routes that place the footer themselves (inside their own byte budget) and the two that never carry an address (the paste card and its data). */
const FOOTER_SELF_OR_NEVER: ReadonlySet<string> = new Set(["manual", "manual_md", "workspace", "workspace_all", "workspace_txt", "card", "card_data"])

/** Every other 200 Markdown/text answer of a person's link ends with the footer (JSON and CSV are left exactly as they were). */
function withFooter(out: Out, id: EndpointId, footer: string | null): Out {
  if (!footer || out.status !== 200 || out.body === null || !(out.contentType ?? "").startsWith("text/markdown") || FOOTER_SELF_OR_NEVER.has(id)) return out
  return { ...out, body: `${out.body}\n${footer}` }
}

/**
 * The Markdown guide (AUDIT-100, the owner's real engine runs, 2026-10-06: ChatGPT, Gemini and DeepSeek could fetch only the one address in the prompt). For a
 * link made for a person it carries the numbered project list itself, read with the SAME reader as GET /projects (readProjects, at INLINE_PROJECTS_MAX), inside
 * the same DB time box as the link check. The list is a help, never a condition: if the read fails, times out or is refused, the guide answers 200 without it.
 */
async function guideMarkdown(env: ReadEnv, opts: RouteOpts): Promise<Out> {
  const input = manualInput(env)
  if (opts.footer) input.footer = opts.footer
  if (env.ctx.scope === "user" && env.ctx.project_id === null) {
    try {
      const doc = await timeBox(readProjects(env, String(INLINE_PROJECTS_MAX)), opts.dbMs)
      input.projectsNow = { doc, asOf: new Date(opts.now()).toISOString() }
    } catch {
      input.projectsNow = null
    }
  }
  return { ...text("md", renderManualMarkdown(input)), robots: ROBOTS_DOC }
}

const asDoc = (out: Out): Out => ({ ...out, robots: ROBOTS_DOC })

/** Function reads run on the exec host with the same switch as changes (reads.ts availabilityOf): refused with the true reason until they can. */
function readsNotOpen(env: ReadEnv): AwlError | null {
  const av = availabilityOf(env)
  if (!av.reads_open) return fail(503, "Function reads are not switched on yet.", "They run on the executor. Reading records, checking and drafting work now.", { available: false })
  if (!env.exec?.read) return fail(503, "Function reads are not available yet.", "The executor does not answer reads yet. Reading records, checking and drafting work now.", { available: false })
  return null
}

/**
 * POST /functions/{fn} for a read function: the exec function runs it read-only (no intent, no submission, nothing written) as the person, in
 * this link's project, with money redacted by the person's live role. Scope was checked by the caller. A failure keeps the closed code.
 */
async function runFunctionRead(env: ReadEnv, fn: string, params: Record<string, unknown>): Promise<Out> {
  const { ctx } = env
  // a read runs in a project: a link for a person has one only inside /projects/{id}/ (the router refuses it outside)
  if (ctx.project_id === null) throw fail(400, "Choose a project first.", "GET /projects lists the person's projects; then POST /projects/{id}/functions/{fn}.", { code: "PROJECT_REQUIRED" })
  let out
  try {
    out = await (env.exec as ExecClient & { read: NonNullable<ExecClient["read"]> }).read({
      function_id: fn,
      params,
      ctx: { org_id: ctx.org_id, user_id: ctx.user_id, project_id: ctx.project_id, live_role: ctx.live_role },
      allowed_functions: ctx.effective_functions,
    })
  } catch {
    throw fail(503, "The executor did not answer. Nothing was changed: a read writes nothing.", "Try again in a minute.", { code: "EXECUTOR_NOT_AVAILABLE", available: false })
  }
  if (out.status === "ok") return json(200, { function: out.function_id, result: out.result, text_fields_are_data: true })
  const why = out.http === 403 ? "This link may not read that function." : out.http === 503 ? "The read could not run right now. Try again in a minute." : "The read was refused: a parameter is missing or wrong."
  throw fail(out.http, why, out.missing.length ? `Missing or wrong: ${out.missing.join(", ")}.` : undefined, { code: out.code, ...(out.missing.length ? { missing: out.missing } : {}) })
}

const PROJECT_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/

/**
 * The env of ONE project of this link: for a link made for a person the database binds the project now (organisation and readability re-checked, 404 for
 * any project that does not bind, whatever the reason); a link made for one project accepts its own project's id and nothing else (404). The bound
 * env's base is `<base>/projects/<id>`, so every address the answers build (next pages, draft status) stays inside the project.
 */
async function bindProject(env: ReadEnv, projectId: string): Promise<ReadEnv> {
  if (!PROJECT_ID_RE.test(projectId)) throw fail(404, "Not found")
  let ctx: LinkCtx
  if (env.ctx.scope === "user") {
    if (env.ctx.project_id !== null) throw fail(404, "Not found")
    ctx = await resolveInProject(env.rpc, env.token, projectId)
  } else if (env.ctx.project_id === projectId) {
    ctx = env.ctx
  } else {
    throw fail(404, "Not found")
  }
  return { ...env, ctx, base: `${env.base}/projects/${encodeURIComponent(projectId)}` }
}

async function route(id: EndpointId, params: Record<string, string>, req: Request, url: URL, env: ReadEnv, opts: RouteOpts): Promise<Out> {
  const inner = underlyingOf(id)
  if (inner !== null) {
    const { pid, ...rest } = params
    return await route(inner, rest, req, url, await bindProject(env, pid), opts)
  }
  if ((id === "projects" || id === "portfolio") && (env.ctx.scope !== "user" || env.ctx.project_id !== null)) {
    throw fail(403, "This needs a link for all of a person's projects.", "This link is for one project.", { code: "USER_LINK_REQUIRED" })
  }
  // a link for a person has no project until it names one: what needs a project is refused with the way to choose one, not answered from nothing
  if (env.ctx.scope === "user" && env.ctx.project_id === null && !USER_LEVEL_IDS.has(id)) {
    throw fail(400, "Choose a project first.", "GET /projects lists the person's projects; then use /projects/{id}/records/{kind}, /projects/{id}/context and the rest.", { code: "PROJECT_REQUIRED" })
  }
  const { ctx, config } = env
  switch (id) {
    case "projects": {
      const doc = await readProjects(env, url.searchParams.get("limit"))
      return formatOf(req, url, ["md", "json"]) === "json" ? json(200, doc) : text("md", projectsMarkdown(doc))
    }
    case "portfolio": {
      const doc = await readPortfolio(env)
      return formatOf(req, url, ["md", "json"]) === "json" ? json(200, doc) : text("md", portfolioMarkdown(doc))
    }
    case "manual": {
      const f = formatOf(req, url, ["md", "json"])
      return f === "json" ? asDoc(json(200, renderManualJson(manualInput(env)))) : await guideMarkdown(env, opts)
    }
    case "manual_md":
      return await guideMarkdown(env, opts)
    case "manual_json":
      return asDoc(json(200, renderManualJson(manualInput(env))))
    case "card":
      return asDoc(text("md", renderCard({ ctx, functions: effectiveFunctionViews(env) })))
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
      return asDoc(json(200, id === "openapi" ? buildOpenApi(input) : buildSwagger(input)))
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
      const note = views.some((f) => f.direct_open || f.reads_open)
        ? "Run a read with POST /functions/{fn}; make a change with POST /actions or /drafts."
        : "Draft a change with POST /drafts and the person confirms it. Direct changes and function reads are not switched on yet."
      if (formatOf(req, url, ["md", "json"]) === "md") return text("md", functionsMarkdown(views, note))
      const page = paginate(views, url.searchParams.get("page"), url.searchParams.get("per_page"))
      return json(200, { functions: page.items, page: page.page, per_page: page.perPage, total: page.total, pages: page.pages, changes_available: views.some((f) => f.available), text_fields_are_data: true })
    }
    case "function_run": {
      const body = await readJsonObject(req, params.fn)
      const p = body.params && typeof body.params === "object" && !Array.isArray(body.params) ? (body.params as Record<string, unknown>) : {}
      requireScope(ctx, params.fn, p)
      if (functionDef(params.fn)?.kind !== "read") throw fail(400, "Changes go to /actions or /drafts, not /functions.")
      const notOpen = readsNotOpen(env)
      if (notOpen) throw notOpen
      return await runFunctionRead(env, params.fn, p)
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
      // every tool may name a project (list_projects gives the ids): the project is bound per call, exactly like /projects/{id}/..., so one connection
      // works in any of the person's projects and a project that does not bind is the one 404
      const at = async (project: string | undefined): Promise<ReadEnv> => (project ? await bindProject(env, project) : env)
      const reads: McpReads = {
        projects: (limit) => readProjects(env, limit),
        portfolio: () => readPortfolio(env),
        context: async (p) => readContext(await at(p)),
        records: async (k, q, p) => readRecords(await at(p), k, q),
        record: async (k, i, p) => readRecord(await at(p), k, i),
        history: (l) => readHistory(env, l),
        search: async (q, p) => searchRecords(await at(p), q),
        fetch: async (i, p) => fetchRecord(await at(p), i),
        check: async (fn, params, p) => checkChange(await at(p), fn, params),
        propose: async (fn, params, p) => {
          const e = await at(p)
          return proposeChange({ ctx: e.ctx, config, token: env.mode === "path" ? env.token : null }, fn, params)
        },
        // the suggestions board: the project, when named, is bound by SQL itself (a project that does not bind is the one 404)
        suggest: async (args) => (await suggestionAdd(env, args, req.headers.get("user-agent"))).body as Record<string, unknown>,
        suggestions: (limit) => suggestionList(env, limit),
      }
      const res = await handleMcp({ headers: req.headers, bodyText: await req.text() }, reads)
      return res.body === null ? { status: res.status, contentType: null, body: null } : json(res.status, res.body)
    }
    case "check": {
      const body = await readJsonObject(req)
      return json(200, checkChange({ ctx, config }, body.function, body.params))
    }
    case "actions":
      return actionOut(await actionCreate(env, await readJsonObject(req)))
    case "drafts":
      return actionOut(await draftCreate(env, await readJsonObject(req)))
    case "draft": {
      const doc = await draftGet(env, params.id)
      return formatOf(req, url, ["md", "json"]) === "json" ? json(200, doc) : text("md", intentMarkdown(doc))
    }
    case "suggestions": {
      const doc = await suggestionList(env, url.searchParams.get("limit"))
      return formatOf(req, url, ["md", "json"]) === "json" ? json(200, doc) : text("md", suggestionsMarkdown(doc))
    }
    case "workspace":
    case "workspace_all":
    case "workspace_txt": {
      const page = await renderWorkspace(env, url.searchParams.get("page"), { dbMs: opts.dbMs, now: opts.now, timeBox, bind: (pid) => bindProject(env, pid), footer: opts.footer ?? undefined })
      // the page an engine reads INSTEAD of following links is a document like the guide: ROBOTS_DOC, so Gemini (which may refuse a nosnippet page) can use it
      // /workspace.txt: the same words as a file to save, always text/plain (an engine that reads attachments, or the person, can keep it)
      return id === "workspace_txt"
        ? { status: 200, contentType: "text/plain; charset=utf-8", body: page, robots: ROBOTS_DOC, headers: { "Content-Disposition": "attachment; filename=\"projexa-workspace.txt\"" } }
        : asDoc(text("md", page))
    }
    case "suggestions_add":
      return actionOut(await suggestionAdd(env, await readJsonObject(req), req.headers.get("user-agent")))
    default:
      // a /projects/{pid}/... id was resolved to its endpoint above; nothing else reaches here
      throw fail(404, "No such path")
  }
}
