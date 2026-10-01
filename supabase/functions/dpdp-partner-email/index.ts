// Sales Partner emails (drizzle/0674). Two callers:
//   * pg_cron (Vault secret as bearer, same as dpdp-monday-email): {"job":"flush"} every 30 minutes,
//     {"job":"statements"} on the 11th at 09:00 IST (queues last month's statements, then flushes);
//   * the Owner's payout screen (a signed-in Owner's own JWT): {"job":"flush"} right after marking a payout paid.
// Deploy with --no-verify-jwt (the cron presents a Vault secret, not a Supabase JWT). The bearer is checked
// here: the DPDP_TIMER_SECRET function secret when set, otherwise public.dpdp_timer_check_bearer (drizzle/0608)
// against the same Vault secret the cron reads; failing that, the caller's own JWT must belong to the
// platform admin (dpdp__is_platform_admin, evaluated with the caller's JWT). Anything else is refused.
//
// Every email goes to the partner only, from the one public address, class "partner" (Reply-To
// dpdp+prt.<ref>@, so a reply is filed as a Partner ticket). A notice holds counts and amounts: no client
// name, no payout detail. DRY RUN with no RESEND_API_KEY (or {"dryRun":true}): nothing is sent, nothing is
// marked, so the notices go out once the key is set.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"
import { type OutboundEnvelope, foreignSenderWarning, logOutbound, resendPayload, resolveFrom } from "../_shared/mail-outbound.ts"
import { flushNotices } from "./flush.ts"
import type { Notice, Rendered } from "./render.ts"

const env = (k: string): string => Deno.env.get(k) ?? ""
const SUPABASE_URL = env("SUPABASE_URL")
const ANON_KEY = env("SUPABASE_ANON_KEY")
const SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY")
const TIMER_SECRET = env("DPDP_TIMER_SECRET")
const RESEND_API_KEY = env("RESEND_API_KEY")
const EMAIL_FROM = resolveFrom(env("DPDP_EMAIL_FROM"))
const SENDER_WARNING = foreignSenderWarning(EMAIL_FROM)
if (SENDER_WARNING) console.warn(SENDER_WARNING)

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

const serviceClient = (): SupabaseClient => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

async function cronBearerOk(presented: string): Promise<boolean> {
  if (presented.length < 24) return false
  if (TIMER_SECRET) return TIMER_SECRET.length >= 24 && constantTimeEqual(presented, TIMER_SECRET)
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return false
  try {
    const { data, error } = await serviceClient().rpc("dpdp_timer_check_bearer", { p_bearer: presented })
    return !error && data === true
  } catch {
    return false
  }
}

async function ownerJwtOk(authHeader: string): Promise<boolean> {
  if (!SUPABASE_URL || !ANON_KEY) return false
  try {
    const caller = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: authHeader } } })
    const { data, error } = await caller.rpc("dpdp__is_platform_admin", {})
    return !error && data === true
  } catch {
    return false
  }
}

async function sendViaResend(to: string, rendered: Rendered, out: OutboundEnvelope): Promise<string> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(resendPayload(to, out, rendered)),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Resend ${res.status}: ${JSON.stringify(body).slice(0, 300)}`)
  return String((body as { id?: string }).id ?? "")
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405)
  const authHeader = req.headers.get("authorization") ?? ""
  const presented = /^Bearer\s+(.+)$/i.exec(authHeader.trim())?.[1]?.trim() ?? ""
  const isCron = await cronBearerOk(presented)
  if (!isCron && !(await ownerJwtOk(authHeader))) return json({ error: "Not allowed" }, 401)

  let body: { job?: string; dryRun?: boolean; period?: string } = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const job = body.job === "statements" ? "statements" : "flush"
  const sb = serviceClient()
  const dryRun = body.dryRun === true || !RESEND_API_KEY

  let queued: number | null = null
  if (job === "statements") {
    const { data, error } = await sb.rpc("dpdp_partner_enqueue_statements", { p_period: body.period ?? null })
    if (error) return json({ error: error.message }, 500)
    queued = (data as { queued?: number } | null)?.queued ?? 0
  }

  try {
    const summary = await flushNotices({
      from: EMAIL_FROM,
      dryRun,
      pending: async (limit) => {
        const { data, error } = await sb.rpc("dpdp_partner_notices_pending", { p_limit: limit })
        if (error) throw new Error(error.message)
        return (data as Notice[] | null) ?? []
      },
      mark: async (id, status, error) => {
        await sb.rpc("dpdp_partner_notice_mark", { p_id: id, p_status: status, p_error: error ?? null })
      },
      send: sendViaResend,
      log: async (e) => {
        await logOutbound(sb, { ref: e.ref, cls: "partner", to: e.to, subject: e.subject, providerMessageId: e.providerMessageId })
      },
    })
    console.log(JSON.stringify({ evt: "dpdp-partner-email", job, queued, ...summary }))
    return json({ ok: true, job, queued, ...summary })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(JSON.stringify({ evt: "dpdp-partner-email", job, error: message.slice(0, 200) }))
    return json({ ok: false, error: message }, 500)
  }
})
