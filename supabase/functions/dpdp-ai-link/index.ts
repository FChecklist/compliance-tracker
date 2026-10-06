// WO-DPDP-013 Part 1 -- the AI work link's API, as a Supabase Edge Function
// (Deno). Vercel is not in this path. See README.md alongside.
//
// Relative to the link base (https://dpdp.veridian-aios.com/ai/<token>,
// proxied by dpdp-app/functions/ai/[[path]].ts; on this function the same
// paths sit under /functions/v1/dpdp-ai-link/<token>):
//
//   GET  /                 manual (HTML)      GET /manual.md  GET /manual.json
//   GET  /context          GET /jobs[?part&status&late&today&mine&nobody]
//   GET  /jobs/{id}        GET /playbook[?filters as /jobs]   GET /law/{code}    GET /report/{kind}[?format=md|csv]
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
  LINK_GONE, contentTypeFor, errorBody, isRateLimited, jobFilters, lawWithWords, methodsFor, negotiateFormat, offeredFormats, paginate, parseRoute, relativePathOf,
  maskEmails, maskPersonal, methodOverride, playbookItems, renderHistoryMarkdown, renderJobMarkdown, renderJobsCsv, renderJobsMarkdown, renderLawMarkdown, renderPlaybookMarkdown, renderReportCsv, renderReportMarkdown, summariseJobs,
  type HistoryEntry, type JobDetail, type JobRow, type LawPayload, type ReportPayload, type Route,
} from "./router.ts"
import { buildManual, renderManualHtml, renderManualJson, renderManualMarkdown, type ContextPayload } from "./manual.ts"
import { MAX_BODY_BYTES, RATE_LIMIT, REGISTER_KINDS, type Format } from "./api-definition.ts"
import { aiPasteText } from "../_shared/ai-link/prompt.ts"
import { playbookFor } from "./playbook.ts"
import { paymentPendingNotice, type BillingNotice } from "./brief.ts"
import { alertEmail, clientPrefix, uaFamily, type UseAlert } from "./unfamiliar.ts"
import { buildOutbound, resendPayload, resolveFrom } from "../_shared/mail-outbound.ts"
import { mailGate } from "../_shared/mail-gate.ts"
// Audit trail (drizzle/0731): one audit row per call, joined to the call log above by ai_call_id. Never blocks or fails a call.
import { GUIDE_ROUTES, auditAiLinkCall, sha256HexOfBytes } from "../_shared/audit/ai-call.ts"
import { parseVendorRanges } from "../_shared/audit/provenance.ts"
import { type KeyRing, keyRingFrom } from "../_shared/audit/seal.ts"
import { type Rpc, makeWriter } from "../_shared/audit/writer.ts"

const FUNCTION_NAME = "dpdp-ai-link"
let auditRingPromise: Promise<KeyRing> | null = null
const auditRing = (): Promise<KeyRing> => (auditRingPromise ??= keyRingFrom((n) => Deno.env.get(n)))
const AUDIT_VENDOR_RANGES = parseVendorRanges(Deno.env.get("DPDP_AUDIT_VENDOR_IP_RANGES"))
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
// Defaults to the production static-app origin so the function works with
// only the platform-injected env (function secrets cannot be set from the
// PM's machine -- same reason as dpdp-monday-email).
const APP_ORIGIN = (Deno.env.get("APP_ORIGIN") || "https://dpdp.veridian-aios.com").replace(/\/+$/, "")

function privateHeaders(contentType: string, extra?: Record<string, string>): HeadersInit {
  return {
    "content-type": contentType,
    // The *.supabase.co gateway serves HTML as text/plain; the Pages proxy
    // restores the intended type from this header (see dpdp-app/functions/ai/_proxy.ts).
    "x-dpdp-content-type": contentType,
    "x-robots-tag": "noindex, nofollow, noarchive",
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

/** Where a person makes a new link: shown with every 410, so an AI can tell them exactly where to go. */
const LINK_GONE_HINT = `Ask the person to make a new link: they sign in at ${APP_ORIGIN}/app/ and use "Copy AI link" on their own page. This old address cannot be revived.`

/**
 * Has this link's organisation's free trial ended with nothing paid? A NOTICE only (owner's rule: access never locks): the lookup
 * (dpdp_ai_link_billing_notice, drizzle/0676) reads and changes nothing, and a failed or not-yet-deployed lookup means no notice.
 */
async function billingFor(token: string): Promise<BillingNotice | null> {
  try {
    const r = await rpc<BillingNotice>("dpdp_ai_link_billing_notice", { p_token: token })
    return r.error ? null : r.data
  } catch {
    return null
  }
}

// Errors the database raises on purpose, with plain-English messages meant
// for the caller. Anything else is an internal error and is not echoed.
type DbError = { code?: string; message: string }
function mapDbError(e: DbError, notFoundIs404 = false): Response {
  const code = e.code ?? ""
  if (code === "42501" && e.message.includes(LINK_GONE)) return fail(410, LINK_GONE, LINK_GONE_HINT)
  if (code === "42501") return fail(403, e.message)
  if (code === "P0002") return fail(notFoundIs404 ? 404 : 400, e.message)
  if (code === "22023" || code === "P0001" || code === "22007" || code === "22008" || code === "22P02") return fail(400, e.message)
  console.error(`${FUNCTION_NAME}: database error (${code || "?"})`)
  return fail(500, "Something failed on our side. Try again in a minute.")
}

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? ""
const EMAIL_FROM = resolveFrom(Deno.env.get("DPDP_EMAIL_FROM"))

/**
 * The unfamiliar-use alert (drizzle/0695). The database decides (first use never alerts; a new network prefix or tool family does; one alert a
 * day per link); this only reads the caller's network prefix (forwarded by the Pages proxy as x-dpdp-client-ip, from CF-Connecting-IP) and tool
 * family, asks, and sends the one plain e-mail, which contains no link. It never fails or slows the request: errors are logged without detail.
 */
async function noteUse(token: string, req: Request): Promise<void> {
  try {
    const prefix = clientPrefix(req.headers.get("x-dpdp-client-ip"))
    const family = uaFamily(req.headers.get("user-agent"))
    if (!prefix && family === "unknown") return
    const r = await rpc<{ alert: boolean } & Partial<UseAlert>>("dpdp_ai_link_note_use", { p_token: token, p_ip_prefix: prefix ?? "", p_ua_family: family })
    if (r.error || !r.data.alert || !r.data.to || !RESEND_API_KEY) return
    const a = r.data as UseAlert
    const mail = alertEmail(a)
    if (!(await mailGate(a.to, "dpdp-ai-link")).send) return // Test mode: not on the allowlist (drizzle/0735)
    const out = buildOutbound("support", mail.subject, { from: EMAIL_FROM })
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(resendPayload(a.to, out, mail)),
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) console.error(`${FUNCTION_NAME}: unfamiliar-use alert not sent (${res.status})`)
  } catch {
    console.error(`${FUNCTION_NAME}: unfamiliar-use alert failed`)
  }
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
      // "Start here" carries today's numbers and the most urgent jobs so the AI does not spend calls finding them. A failure here only
      // means the section tells the AI to fetch them itself.
      const [jr, billing] = await Promise.all([rpc<JobRow[]>("dpdp_ai_link_jobs", { p_token: token, p_filters: {} }), billingFor(token)])
      const summary = !jr.error && Array.isArray(jr.data) ? summariseJobs(jr.data) : null
      // ?brief=1 is the short version (the full one stays at the same address without it).
      const compact = q.get("brief") === "1"
      const manual = buildManual({ context: r.data, base: linkBase(token), now: new Date(), summary, billingNotice: billing, compact })
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
      const ctxNotice = paymentPendingNotice(await billingFor(token))
      return json(200, { ...r.data, base: linkBase(token), ...(ctxNotice ? { notice: ctxNotice } : {}) })
    }
    case "prompt": {
      // The two lines the person pastes ("open this link and follow the page"), for the one-tap Copy page. The token must be a live
      // link -- the context call is the check -- but the text carries no personal data: the personal part is the page itself.
      const r = await rpc<ContextPayload>("dpdp_ai_link_context", { p_token: token })
      if (r.error) return mapDbError(r.error)
      const promptNotice = paymentPendingNotice(await billingFor(token))
      return text(200, (promptNotice ? `Note for you: ${promptNotice}

` : "") + aiPasteText(linkBase(token)))
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
      // The job's own playbook (its library key is on the detail), or a general one for its part of the list: why, who, steps, questions, note, email.
      const pb = playbookFor(r.data.templateKey ?? null, { part: r.data.part, what: r.data.what, requiredToday: r.data.requiredToday })
      // A link that hides other people's addresses: mask the two fields the database does not (a reason, an action's value).
      let job = r.data
      const ctx = await rpc<ContextPayload>("dpdp_ai_link_context", { p_token: token })
      if (!ctx.error && ctx.data.link.hideEmails) {
        const keep = ctx.data.viewer.email
        job = { ...job, naReason: job.naReason == null ? null : maskEmails(job.naReason, keep), aiActions: job.aiActions.map((a) => ({ ...a, value: JSON.parse(maskEmails(JSON.stringify(a.value ?? null), keep)) })) }
      }
      return format === "md" ? formatted("md", renderJobMarkdown(job, pb)) : json(200, { ...job, playbook: pb.playbook, playbookSource: pb.source })
    }
    case "playbook": {
      const format = negotiateFormat(offeredFormats("playbook"), q.get("format"), accept, "md")
      const r = await rpc<JobRow[]>("dpdp_ai_link_jobs", { p_token: token, p_filters: jobFilters(q) })
      if (r.error) return mapDbError(r.error)
      const page = paginate(playbookItems(r.data), q.get("page"), q.get("per_page"))
      if (format === "json") return json(200, page)
      const ctx = await rpc<ContextPayload>("dpdp_ai_link_context", { p_token: token })
      return formatted("md", renderPlaybookMarkdown(page, ctx.error ? "this organisation" : ctx.data.org.name))
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
    case "register": {
      if (route.register === null) return json(200, { registers: REGISTER_KINDS, next: "GET /register/{kind}. Read-only; owner, coordinator, Grievance Officer and CA links only." })
      if (!(REGISTER_KINDS as ReadonlyArray<{ kind: string }>).some((r) => r.kind === route.register)) return fail(404, `No such register. Use one of: ${REGISTER_KINDS.map((r) => r.kind).join(", ")}.`)
      const r = await rpc<{ kind: string; data: unknown }>("dpdp_ai_link_register", { p_token: token, p_kind: route.register })
      if (r.error) return mapDbError(r.error)
      return json(200, r.data)
    }
    case "suggestions": {
      if (req.method === "POST") {
        const raw = await req.text()
        if (raw.length > MAX_BODY_BYTES) return fail(413, "Request body is too large (8 KB at most).")
        let b: { kind?: unknown; title?: unknown; body?: unknown; endorse?: unknown }
        try { b = JSON.parse(raw || "{}") } catch { return fail(400, "Body must be JSON: { kind, title, body } or { endorse }.") }
        if (!b || typeof b !== "object" || Array.isArray(b)) return fail(400, "Body must be a JSON object: { kind, title, body } or { endorse }.")
        const str = (v: unknown) => (typeof v === "string" ? v : null)
        const r = await rpc<{ suggestionId: string; status: string; duplicate: boolean; endorseCount: number; alreadyEndorsed?: boolean }>(
          "dpdp_ai_link_suggest", { p_token: token, p_kind: str(b.kind), p_title: str(b.title), p_body: str(b.body), p_endorse_id: str(b.endorse) },
        )
        if (r.error) return mapDbError(r.error)
        return json(201, {
          ...r.data,
          next: r.data.duplicate
            ? "Already in the shared pool; your voice is counted once. Tell the person you passed it on."
            : "Added to the shared pool for the VERIDIAN team to review. Nothing in this organisation changed. Tell the person you passed it on.",
        })
      }
      const r = await rpc<unknown[]>("dpdp_ai_link_suggestions", { p_token: token })
      if (r.error) return mapDbError(r.error)
      return json(200, r.data)
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

/**
 * A link that hides other people's details (the default): whatever route answered, every address but the link's own person's (and the product's own
 * support address) and every phone number in the finished body is replaced before it leaves. The database already does this for most fields; this is the
 * net under the rest (free text in a note, a reason, an evidence label). Links that were switched to show addresses are served as they are.
 */
async function guardHiddenLink(res: Response, token: string): Promise<Response> {
  if (res.status >= 300) return res
  const ct = res.headers.get("content-type") ?? ""
  if (!/json|text|csv|markdown|html/i.test(ct)) return res
  const ctx = await rpc<ContextPayload>("dpdp_ai_link_context", { p_token: token })
  if (ctx.error || !ctx.data.link.hideEmails) return res
  const body = maskPersonal(await res.text(), ctx.data.viewer.email)
  return new Response(body, { status: res.status, headers: res.headers })
}

const auditWriter = makeWriter(rpc as unknown as Rpc, auditRing)

Deno.serve(async (req: Request): Promise<Response> => {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error(`${FUNCTION_NAME}: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing`)
    return text(500, "This service is not configured.")
  }
  const url = new URL(req.url)
  const parsed = parseRoute(url.pathname)
  if ("error" in parsed) return parsed.error === 401 ? fail(401, parsed.message) : fail(404, parsed.message)
  const { token, route } = parsed
  let method = req.method === "HEAD" ? "GET" : req.method
  const relativePath = relativePathOf(url.pathname)
  // The GET-only fallback (?_method=POST&_body=...): served exactly as the POST it stands for, so every check below applies to it unchanged.
  let request = req
  const override = methodOverride(method, route, url.searchParams)
  let overrideError: Response | null = null
  if ("error" in override) overrideError = fail(override.status, override.error)
  else if (override.method === "POST" && method === "GET") {
    method = "POST"
    request = new Request(url.toString(), { method: "POST", headers: { "content-type": "application/json", accept: req.headers.get("accept") ?? "application/json" }, body: override.body ?? "{}" })
  }

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
    // The audit row (spec item 9). Started before the response is returned (the clone is taken now, while the body is unread), finished in the background where
    // the platform allows it, awaited otherwise. A failure is logged without detail and never changes what the caller gets.
    // The person's own browser fetching the paste (/prompt) is not "the link being used" (same rule as noteUse below): not audited.
    const audited = route.kind === "prompt" ? Promise.resolve() : (async () => {
      try {
        const guideHash = GUIDE_ROUTES.includes(route.kind) && res.status < 300 ? await sha256HexOfBytes(await res.clone().arrayBuffer()) : null
        const out = await auditAiLinkCall({
          rpc: rpc as unknown as Rpc, writer: auditWriter, headers: req.headers, url, method, relativePath, routeKind: route.kind, status: res.status,
          callId, linkId: begun.error ? null : begun.data.linkId, guideHash, vendorRanges: AUDIT_VENDOR_RANGES,
        })
        if (!out.written && out.reason && out.reason !== "unknown_link") console.error(`${FUNCTION_NAME}: audit row not written (${out.reason})`)
      } catch {
        console.error(`${FUNCTION_NAME}: audit row failed`)
      }
    })()
    const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime
    if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(audited)
    else await audited
    return res
  }

  if (overrideError) return finish(overrideError)
  if (!begun.error && isRateLimited(begun.data.callsLastMinute)) {
    return finish(fail(429, `Over the rate limit (${RATE_LIMIT.perMinute} calls per minute per link). Wait a minute.`))
  }
  const allowed = methodsFor(route)
  if (!(allowed as ReadonlyArray<string>).includes(method)) {
    const allow = allowed.join(", ")
    return finish(new Response(JSON.stringify(errorBody(405, `Use ${allow} for this path.`)), { status: 405, headers: privateHeaders("application/json; charset=utf-8", { allow }) }))
  }

  // The person's own browser fetching the paste (/prompt) is not "the link being used"; counting it would make the first real AI call look unfamiliar.
  const noted = route.kind === "prompt" ? Promise.resolve() : noteUse(token, req)
  try {
    const handled = await handle(request, token, route, url)
    // The two pasted lines (/prompt) hold no personal detail by construction; every other route passes through the net.
    const res = route.kind === "prompt" ? handled : await guardHiddenLink(handled, token)
    await noted
    const body = await res.clone().arrayBuffer()
    const withLength = new Response(body, { status: res.status, headers: res.headers })
    withLength.headers.set("content-length", String(body.byteLength))
    return finish(withLength)
  } catch (e) {
    console.error(`${FUNCTION_NAME}: unhandled`, e instanceof Error ? e.message : String(e))
    return finish(fail(500, "Something failed on our side. Try again in a minute."))
  }
})
