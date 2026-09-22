// WO-DPDP-011 Step 4 -- the Supabase timer's worker. pg_cron (drizzle/0606)
// posts here twice: Monday 00:30 UTC (06:00 IST) with {"job":"monday"} and
// daily 03:30 UTC (09:00 IST) with {"job":"legal_clocks"}. Vercel is not in
// the path; no browser ever calls this with anything but an unsubscribe.
//
// SECURITY MODEL
//   * Deployed with --no-verify-jwt (the cron sends a Vault secret, not a
//     Supabase JWT). The bearer is checked here: against DPDP_TIMER_SECRET
//     (constant-time) when that function secret is set, otherwise through
//     public.dpdp_timer_check_bearer (drizzle/0608, service_role only),
//     which compares sha256 digests against the SAME Vault secret the cron
//     reads -- so the function works with only the platform-injected env
//     (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) plus Vault. A missing/short
//     bearer, or no secret anywhere, refuses everything (fail closed).
//   * The service-role client is used ONLY inside this function -- never
//     shipped to a browser (WO-011 §0 limit 2). It reaches the dpdp.*
//     logic through the public.dpdp_timer_* wrappers (PostgREST cannot
//     see the dpdp schema).
//   * A person's sign-in link and one-click tokens go ONLY to that
//     person. "Coordinator copied" / "owner told" is a section in the
//     coordinator's/owner's own email, never a CC (a CC would hand one
//     person another person's credentials).
//   * ?action=unsubscribe&t=<token> is the one public path: GET redirects a
//     human to the static page (opening a link changes nothing); POST is
//     the RFC 8058 one-click, which a mail client sends on the user's
//     explicit "unsubscribe" press.
//
// DRY RUN: with no RESEND_API_KEY (or {"dryRun":true}), every email is
// rendered with placeholders in place of the sign-in link and tokens,
// recorded in dpdp.email_send as status 'dry_run' with its subject and
// body, and nothing is minted or sent. One failed send never aborts the
// run; the row is marked 'failed' with the error and the next one
// proceeds. Idempotent per (membership, ISO week): a re-run skips anyone
// already recorded for this week.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"
import {
  type ActionLinks, type Digest, type LegalClocks, type LegalRecipient, type RenderLinks, type Rendered,
  domainOfFrom, isDeliverableAddress, isEmpty, listUnsubscribeHeaders, renderDigest, renderLeakClock, renderRightsClock, statutorySubset,
} from "./render.ts"

const env = (k: string): string => Deno.env.get(k) ?? ""
const SUPABASE_URL = env("SUPABASE_URL")
const SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY")
const TIMER_SECRET = env("DPDP_TIMER_SECRET")
const RESEND_API_KEY = env("RESEND_API_KEY")
const EMAIL_FROM = env("DPDP_EMAIL_FROM") || "VERIDIAN AI DPDP <dpdp@send.veridian-aios.com>"
const APP_ORIGIN = (env("APP_ORIGIN") || "https://app.veridian-aios.com").replace(/\/+$/, "")
const FUNCTION_URL = (env("DPDP_FUNCTION_URL") || `${SUPABASE_URL}/functions/v1/dpdp-monday-email`).replace(/\/+$/, "")
const ACTION_PATH = env("DPDP_ACTION_PATH") || "/act/"
const UNSUBSCRIBE_PATH = env("DPDP_UNSUBSCRIBE_PATH") || "/unsubscribe/"

type Summary = {
  job: string
  dryRun: boolean
  digests: number
  sent: number
  dry_run: number
  failed: number
  skipped: number
  details: Array<{ membershipId: string; to: string; kind: string; status: string; error?: string }>
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function constantTimeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  if (ea.length !== eb.length) return false
  let diff = 0
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i]
  return diff === 0
}

function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** Env secret if set; otherwise the Vault-backed RPC (0608). Never both, never neither. */
async function bearerOk(req: Request): Promise<boolean> {
  const header = req.headers.get("authorization") ?? ""
  const m = /^Bearer\s+(.+)$/i.exec(header.trim())
  const presented = m?.[1]?.trim() ?? ""
  if (presented.length < 24) return false
  if (TIMER_SECRET) return TIMER_SECRET.length >= 24 && constantTimeEqual(presented, TIMER_SECRET)
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return false
  try {
    const { data, error } = await serviceClient().rpc("dpdp_timer_check_bearer", { p_bearer: presented })
    if (error) { console.error("dpdp_timer_check_bearer failed:", error.message); return false }
    return data === true
  } catch (e) {
    console.error("dpdp_timer_check_bearer threw:", e instanceof Error ? e.message : String(e))
    return false
  }
}

async function rpc<T>(sb: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args)
  if (error) throw new Error(`${fn}: ${error.message}`)
  return data as T
}

/** Supabase Auth magic link, generated server-side (WO-011 §2.2 A). Null on failure -- the email then points at "Send me a new link". */
async function mintSignInLink(sb: SupabaseClient, email: string): Promise<string | null> {
  try {
    const { data, error } = await sb.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo: `${APP_ORIGIN}/app/` } })
    if (error) { console.warn(`generateLink failed for ${email}: ${error.message}`); return null }
    return data?.properties?.action_link ?? null
  } catch (e) {
    console.warn(`generateLink threw for ${email}: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

function actionUrl(token: string): string {
  return `${APP_ORIGIN}${ACTION_PATH}#${token}`
}

function unsubscribeUrl(token: string): string {
  return `${FUNCTION_URL}?action=unsubscribe&t=${encodeURIComponent(token)}`
}

async function sendViaResend(to: string, rendered: Rendered, headers: Record<string, string>): Promise<string> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject: rendered.subject, html: rendered.html, text: rendered.text, headers }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Resend ${res.status}: ${JSON.stringify(body).slice(0, 300)}`)
  return String((body as { id?: string }).id ?? "")
}

type RecordResult = { id: string | null; unsubscribeToken?: string; duplicate: boolean }

type Deliverable = {
  orgId: string
  membershipId: string
  identityId: string
  to: string
  kind: "monday_digest" | "statutory" | "leak_clock" | "rights_clock" | "escalation"
  periodKey: string
  obligationIds: string[]
  /** Obligations the recipient may act on from this email (tokens are minted for exactly these). */
  actionableIds: string[]
  render: (links: RenderLinks) => Rendered
}

/**
 * record -> (mint links, send) -> mark. Never throws: every failure is
 * marked on the row and reported in the summary so one bad address cannot
 * stop the rest of the run.
 */
async function deliver(sb: SupabaseClient, d: Deliverable, dryRun: boolean, summary: Summary): Promise<void> {
  const placeholders: RenderLinks = { signIn: null, actions: null, unsubscribeUrl: null, appHome: `${APP_ORIGIN}/app/` }
  const base = { p_org_id: d.orgId, p_membership_id: d.membershipId, p_identity_id: d.identityId, p_obligation_ids: d.obligationIds, p_kind: d.kind, p_period_key: d.periodKey, p_to_email: d.to }

  if (dryRun) {
    try {
      const preview = d.render(placeholders)
      const rec = await rpc<RecordResult>(sb, "dpdp_timer_record_email_send", { ...base, p_subject: preview.subject, p_status: "dry_run", p_body_text: preview.text })
      if (rec.duplicate) { summary.skipped++; summary.details.push({ membershipId: d.membershipId, to: d.to, kind: d.kind, status: "skipped-duplicate" }); return }
      summary.dry_run++
      summary.details.push({ membershipId: d.membershipId, to: d.to, kind: d.kind, status: "dry_run" })
    } catch (e) {
      summary.failed++
      summary.details.push({ membershipId: d.membershipId, to: d.to, kind: d.kind, status: "failed", error: e instanceof Error ? e.message : String(e) })
    }
    return
  }

  // Real send: a reserved/test address is recorded as skipped, never handed
  // to Resend (see isDeliverableAddress in render.ts).
  if (!isDeliverableAddress(d.to)) {
    summary.skipped++
    summary.details.push({ membershipId: d.membershipId, to: d.to, kind: d.kind, status: "skipped-test-address" })
    return
  }

  let rowId: string | null = null
  try {
    const preview = d.render(placeholders)
    const rec = await rpc<RecordResult>(sb, "dpdp_timer_record_email_send", { ...base, p_subject: preview.subject, p_status: "queued" })
    if (rec.duplicate || !rec.id) { summary.skipped++; summary.details.push({ membershipId: d.membershipId, to: d.to, kind: d.kind, status: "skipped-duplicate" }); return }
    rowId = rec.id

    const signIn = await mintSignInLink(sb, d.to)
    let actions: ActionLinks | null = null
    if (d.actionableIds.length) {
      const minted = await rpc<Array<{ obligationId: string; done: string; cannot: string; neverHadAny: string | null }>>(
        sb, "dpdp_timer_issue_action_tokens", { p_membership_id: d.membershipId, p_obligation_ids: d.actionableIds, p_email_send_id: rowId },
      )
      actions = {}
      for (const t of minted) actions[t.obligationId] = { done: actionUrl(t.done), cannot: actionUrl(t.cannot), neverHadAny: t.neverHadAny ? actionUrl(t.neverHadAny) : null }
    }
    const unsub = unsubscribeUrl(rec.unsubscribeToken ?? "")
    const rendered = d.render({ signIn, actions, unsubscribeUrl: unsub, appHome: `${APP_ORIGIN}/app/` })
    const fromDomain = domainOfFrom(EMAIL_FROM)
    const headers = listUnsubscribeHeaders(unsub, fromDomain ? `unsubscribe@${fromDomain}?subject=unsubscribe%20${encodeURIComponent(rec.unsubscribeToken ?? "")}` : null)
    const messageId = await sendViaResend(d.to, rendered, headers)
    await rpc(sb, "dpdp_timer_mark_email_send_result", { p_id: rowId, p_status: "sent", p_resend_message_id: messageId || null, p_error: null })
    summary.sent++
    summary.details.push({ membershipId: d.membershipId, to: d.to, kind: d.kind, status: "sent" })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    summary.failed++
    summary.details.push({ membershipId: d.membershipId, to: d.to, kind: d.kind, status: "failed", error: message })
    if (rowId) {
      try { await rpc(sb, "dpdp_timer_mark_email_send_result", { p_id: rowId, p_status: "failed", p_resend_message_id: null, p_error: message.slice(0, 2000) }) } catch (markErr) { console.error("mark failed:", markErr) }
    }
  }
}

async function runMonday(sb: SupabaseClient, now: Date, orgId: string | null, dryRun: boolean): Promise<Summary> {
  const summary: Summary = { job: "monday", dryRun, digests: 0, sent: 0, dry_run: 0, failed: 0, skipped: 0, details: [] }
  const digests = await rpc<Digest[]>(sb, "dpdp_timer_build_monday_digests", { p_now: now.toISOString(), p_org_id: orgId })
  summary.digests = digests.length
  for (const raw of digests) {
    if (raw.alreadySentThisWeek) { summary.skipped++; summary.details.push({ membershipId: raw.membershipId, to: raw.email, kind: "monday_digest", status: "skipped-already-sent" }); continue }
    const kind: "monday_digest" | "statutory" = raw.statutoryOnly ? "statutory" : "monday_digest"
    const digest = raw.statutoryOnly ? statutorySubset(raw) : raw
    if (isEmpty(digest)) { summary.skipped++; summary.details.push({ membershipId: raw.membershipId, to: raw.email, kind, status: "skipped-nothing-to-say" }); continue }
    await deliver(sb, {
      orgId: digest.orgId,
      membershipId: digest.membershipId,
      identityId: digest.identityId,
      to: digest.email,
      kind,
      periodKey: digest.weekKey,
      obligationIds: digest.jobs.map((j) => j.obligationId),
      actionableIds: digest.jobs.filter((j) => j.isMine).map((j) => j.obligationId),
      render: (links) => renderDigest(digest, links, kind),
    }, dryRun, summary)
  }
  return summary
}

async function runLegalClocks(sb: SupabaseClient, now: Date, orgId: string | null, dryRun: boolean): Promise<Summary> {
  const summary: Summary = { job: "legal_clocks", dryRun, digests: 0, sent: 0, dry_run: 0, failed: 0, skipped: 0, details: [] }
  const clocks = await rpc<LegalClocks>(sb, "dpdp_timer_legal_clocks", { p_now: now.toISOString(), p_org_id: orgId })
  for (const leak of clocks.leaks) {
    for (const r of leak.recipients as LegalRecipient[]) {
      summary.digests++
      await deliver(sb, {
        orgId: leak.orgId, membershipId: r.membershipId, identityId: r.identityId, to: r.email,
        kind: "leak_clock", periodKey: `${leak.periodKey}:${r.membershipId}`, obligationIds: [], actionableIds: [],
        render: (links) => renderLeakClock(leak, r, links),
      }, dryRun, summary)
    }
  }
  for (const req of clocks.rights) {
    for (const r of req.recipients as LegalRecipient[]) {
      summary.digests++
      await deliver(sb, {
        orgId: req.orgId, membershipId: r.membershipId, identityId: r.identityId, to: r.email,
        kind: "rights_clock", periodKey: `${req.periodKey}:${r.membershipId}`, obligationIds: [], actionableIds: [],
        render: (links) => renderRightsClock(req, r, links),
      }, dryRun, summary)
    }
  }
  return summary
}

/** ?action=unsubscribe&t=<token>: GET -> the static page (no change yet); POST -> RFC 8058 one-click. */
async function handleUnsubscribe(req: Request, url: URL): Promise<Response> {
  const token = url.searchParams.get("t") ?? ""
  if (!/^[0-9a-f]{32,128}$/i.test(token)) return json({ ok: false, reason: "This link is not valid." }, 400)
  if (req.method === "GET" || req.method === "HEAD") {
    return new Response(null, { status: 302, headers: { Location: `${APP_ORIGIN}${UNSUBSCRIBE_PATH}#${token}`, "Cache-Control": "no-store" } })
  }
  if (req.method !== "POST") return json({ ok: false, reason: "Method not allowed" }, 405)
  try {
    const sb = serviceClient()
    const result = await rpc<{ ok: boolean; reason?: string }>(sb, "dpdp_unsubscribe", { p_token: token })
    return json(result, result.ok ? 200 : 400)
  } catch (e) {
    console.error("unsubscribe failed:", e)
    return json({ ok: false, reason: "Could not process that right now." }, 500)
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url)
  if (url.searchParams.get("action") === "unsubscribe") return handleUnsubscribe(req, url)
  if (req.method !== "POST") return json({ error: "POST only" }, 405)
  if (!(await bearerOk(req))) return json({ error: "unauthorised" }, 401)

  let body: { job?: string; now?: string; orgId?: string; dryRun?: boolean } = {}
  try { body = await req.json() } catch { body = {} }
  const now = body.now ? new Date(body.now) : new Date()
  if (Number.isNaN(now.getTime())) return json({ error: "bad now" }, 400)
  const orgId = typeof body.orgId === "string" && body.orgId ? body.orgId : null
  const dryRun = body.dryRun === true || !RESEND_API_KEY
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing" }, 500)

  const sb = serviceClient()
  try {
    if (body.job === "monday") return json(await runMonday(sb, now, orgId, dryRun))
    if (body.job === "legal_clocks") return json(await runLegalClocks(sb, now, orgId, dryRun))
    return json({ error: "unknown job; expected 'monday' or 'legal_clocks'" }, 400)
  } catch (e) {
    console.error("run failed:", e)
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
