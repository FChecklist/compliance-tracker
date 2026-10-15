// DPDP audit trail -- the daily job's Edge Function (Deno). Logic and tests: handler.ts / src/lib/services/dpdp-audit-lifecycle.test.ts.
//
// SECURITY: deployed with verify_jwt FALSE (pg_cron sends a Vault secret, not a Supabase JWT). The bearer is checked against DPDP_TIMER_SECRET when set, else through
// public.dpdp_timer_check_bearer (drizzle/0608, the same Vault secret the cron reads). A missing or short bearer, or no secret anywhere, refuses everything (fail
// closed) -- the same rule as dpdp-lifecycle-email. One public mailbox: From "VERIDIAN AI DPDP <dpdp@veridian-aios.com>". No RESEND_API_KEY = dry run: heads are
// recorded, nothing is mailed, nothing is marked as mailed (so adding the key later loses nothing); the day-365 deletion still runs on schedule.
import { createClient } from "npm:@supabase/supabase-js@2"
import { buildOutbound, foreignSenderWarning, resendPayload, resolveFrom } from "../_shared/mail-outbound.ts"
import { mailGate } from "../_shared/mail-gate.ts"
import { runDaily } from "./handler.ts"

const env = (k: string): string => Deno.env.get(k) ?? ""
const SUPABASE_URL = env("SUPABASE_URL")
const SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY")
const TIMER_SECRET = env("DPDP_TIMER_SECRET")
const RESEND_API_KEY = env("RESEND_API_KEY")
const EMAIL_FROM = resolveFrom(env("DPDP_EMAIL_FROM"))
const APP_ORIGIN = (env("APP_ORIGIN") || "https://dpdp.veridian-aios.com").replace(/\/+$/, "")
const SENDER_WARNING = foreignSenderWarning(EMAIL_FROM)
if (SENDER_WARNING) console.warn(SENDER_WARNING)

const client = () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function bearerOk(req: Request): Promise<boolean> {
  const m = /^Bearer\s+(.+)$/i.exec((req.headers.get("authorization") ?? "").trim())
  const presented = m?.[1]?.trim() ?? ""
  if (presented.length < 24) return false
  if (TIMER_SECRET) return TIMER_SECRET.length >= 24 && constantTimeEqual(presented, TIMER_SECRET)
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return false
  try {
    const { data, error } = await client().rpc("dpdp_timer_check_bearer", { p_bearer: presented })
    return !error && data === true
  } catch {
    return false
  }
}

async function sendMail(to: string, subject: string, text: string, html: string, idempotencyKey: string): Promise<void> {
  if (!(await mailGate(to, "dpdp-audit-lifecycle")).send) return // Test mode: not on the allowlist (drizzle/0735)
  const out = buildOutbound("support", subject, { from: EMAIL_FROM })
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey.slice(0, 256) },
    body: JSON.stringify(resendPayload(to, out, { html, text })),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`Resend ${res.status}`)
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return new Response("Use POST", { status: 405 })
  if (!(await bearerOk(req))) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "content-type": "application/json" } })
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return new Response(JSON.stringify({ error: "This service is not configured." }), { status: 500, headers: { "content-type": "application/json" } })
  let dry = false
  try { dry = ((await req.json()) as { dryRun?: boolean })?.dryRun === true } catch { /* no body is fine */ }
  const report = await runDaily({
    rpc: async (fn, args) => {
      const { data, error } = await client().rpc(fn, args)
      return { data, error: error ? { code: error.code ?? undefined, message: error.message } : null }
    },
    send: RESEND_API_KEY && !dry ? sendMail : null,
    appOrigin: APP_ORIGIN,
    now: () => Date.now(),
  })
  return new Response(JSON.stringify(report), { status: 200, headers: { "content-type": "application/json" } })
})
