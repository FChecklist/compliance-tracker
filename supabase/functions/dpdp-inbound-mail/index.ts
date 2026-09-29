// DPDP single mailbox -- the inbound side of dpdp@veridian-aios.com.
//
//   Cloudflare Email Routing -> Email Worker (workers/dpdp-inbound-mail) -> POST here
//     -> classify -> dpdp.mail_inbound (ticket) -> [acknowledge the sender] -> [tell the operator]
//
// The logic is in handler.ts (bun-testable, see handler.test.ts); this file only wires Deno.serve, the
// platform-injected service-role client and Resend. classify.ts is the pure classifier; README.md lists the
// secrets, the payload the Worker posts and what the Worker must do with a non-2xx answer.
//
// DEPLOY WITH JWT VERIFICATION OFF (--no-verify-jwt): the Worker presents a shared secret
// (DPDP_INBOUND_SECRET), not a Supabase JWT. handler.ts compares it in constant time and refuses
// everything, before parsing or touching the database, if it is missing, short or wrong.
//
// The service-role client is used ONLY here, never shipped to a browser. It reaches the dpdp schema
// through the public.dpdp_mail_* SECURITY DEFINER functions (drizzle/0662), which PostgREST can see and
// only service_role can execute.
//
// DRY RUN: no RESEND_API_KEY. Messages are still recorded and get their ticket; nothing is sent (the answer is
// 502, so the Worker forwards the mail natively and it still reaches a person) and nothing
// is marked sent. Set the key only once Resend has verified veridian-aios.com as a sending domain.
import { createClient } from "npm:@supabase/supabase-js@2"
import { handleInbound, parseLegalDays, type OutMessage } from "./handler.ts"

const env = (k: string): string => Deno.env.get(k) ?? ""
const SUPABASE_URL = env("SUPABASE_URL")
const SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY")
const RESEND_API_KEY = env("RESEND_API_KEY")

const config = {
  secret: env("DPDP_INBOUND_SECRET"),
  operatorEmail: env("DPDP_OPERATOR_EMAIL"),
  from: env("DPDP_EMAIL_FROM") || "VERIDIAN AI DPDP <dpdp@veridian-aios.com>",
  legalResponseDays: parseLegalDays(env("DPDP_LEGAL_RESPONSE_DAYS")),
  dryRun: RESEND_API_KEY === "",
}

const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

async function sendViaResend(m: OutMessage): Promise<{ id: string }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": m.idempotencyKey },
    body: JSON.stringify({
      from: m.from,
      to: [m.to],
      subject: m.subject,
      text: m.text,
      ...(m.replyTo ? { reply_to: [m.replyTo] } : {}),
      headers: m.headers,
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Resend ${res.status}: ${JSON.stringify(body).slice(0, 300)}`)
  return { id: String((body as { id?: string }).id ?? "") }
}

Deno.serve((req: Request) =>
  handleInbound(req, {
    config,
    send: sendViaResend,
    rpc: async (fn, args) => {
      const { data, error } = await client.rpc(fn, args)
      return { data, error: error ? { message: error.message, code: error.code ?? undefined } : null }
    },
  }),
)
