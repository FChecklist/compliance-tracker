// DPDP single mailbox -- the inbound side of dpdp@veridian-aios.com.
//
//   PRIMARY   root MX -> Resend inbound -> Svix-signed webhook (email.received) -> POST here
//   OPTIONAL  Cloudflare Email Routing -> Email Worker (workers/dpdp-inbound-mail) -> bearer POST here
//     -> classify -> dpdp.mail_inbound (ticket) -> [acknowledge the sender] -> [tell the operator]
//
// The logic is in handler.ts (bun-testable, see handler.test.ts) and resend-inbound.ts (the Resend webhook, the
// recipient policy and the reconcile job; resend-inbound.test.ts); this file only wires Deno.serve, the
// platform-injected service-role client and Resend. classify.ts is the pure classifier; README.md lists the
// secrets, the payloads and what each caller must do with a non-2xx answer.
//
// DEPLOY WITH JWT VERIFICATION OFF (--no-verify-jwt): neither caller presents a Supabase JWT. The Worker (and the
// reconcile job) present a shared secret (DPDP_INBOUND_SECRET), which handler.ts compares in constant time and
// refuses everything on, before parsing or touching the database, if it is missing, short or wrong. Resend presents
// a Svix signature (DPDP_RESEND_WEBHOOK_SECRET), which resend-inbound.ts verifies over the raw body before it reads
// a byte of it; with no usable secret it answers 503 and does nothing else.
//
// The service-role client is used ONLY here, never shipped to a browser. It reaches the dpdp schema
// through the public.dpdp_mail_* SECURITY DEFINER functions (drizzle/0662), which PostgREST can see and
// only service_role can execute.
//
// DRY RUN: no RESEND_API_KEY. Messages are still recorded and get their ticket; nothing is sent (the answer is
// 502, so the Worker forwards the mail natively and it still reaches a person) and nothing
// is marked sent. Set the key only once Resend has verified veridian-aios.com as a sending domain.
import { createClient } from "npm:@supabase/supabase-js@2"
import { parseLegalDays, type OutMessage } from "./handler.ts"
import { routeInbound } from "./resend-inbound.ts"

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
    // A send that never answers must fail (and be retried by Svix / the Worker's fallback), not hold the function until the platform kills it.
    signal: AbortSignal.timeout(10_000),
    redirect: "error", // the key must never follow a redirect to another host
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

// Function secrets, read once at start. The webhook secret is the Svix signing secret Resend shows for the webhook
// endpoint ("whsec_..."); RESEND_API_KEY doubles as the key that fetches a received message.
const resend = { webhookSecret: env("DPDP_RESEND_WEBHOOK_SECRET"), apiKey: RESEND_API_KEY }

Deno.serve((req: Request) =>
  routeInbound(req, {
    resend,
    inbound: {
      config,
      send: sendViaResend,
      rpc: async (fn, args) => {
        const { data, error } = await client.rpc(fn, args)
        return { data, error: error ? { message: error.message, code: error.code ?? undefined } : null }
      },
    },
  }),
)
