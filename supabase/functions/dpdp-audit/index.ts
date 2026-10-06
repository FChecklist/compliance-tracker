// DPDP audit trail -- the Edge Function (Deno). See handler.ts for every route and README.md alongside for deployment.
//
// Deployed with verify_jwt = FALSE: the one unauthenticated route (POST /event for a failed sign-in) cannot carry a user token, so the platform's own JWT gate is off
// and every other route authenticates here, by asking Supabase Auth (`auth.getUser`) to validate the bearer token -- a forged or expired token is refused. The database
// is reached with the service-role client only; the audit RPCs (drizzle/0730) are executable by service_role alone.
//
// Secrets: DPDP_AUDIT_SEAL_KEY (+ _ID), optionally DPDP_AUDIT_SEAL_KEY_OLD (+ _ID) for rotation, DPDP_AUDIT_CODE_MAX_AGE_SECONDS, DPDP_AUDIT_EXPORTS_PER_HOUR,
// DPDP_AUDIT_ALLOWED_ORIGINS, APP_ORIGIN. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are platform-injected and never leave this process.
import { createClient } from "npm:@supabase/supabase-js@2"
import { type KeyRing, keyRingFrom } from "../_shared/audit/seal.ts"
import type { Rpc } from "../_shared/audit/writer.ts"
import { handle } from "./handler.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const db = () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })

const rpc: Rpc = async (fn, args) => {
  const { data, error } = await db().rpc(fn, args)
  return { data, error: error ? { code: error.code ?? undefined, message: error.message } : null }
}

function claimsOf(jwt: string): Record<string, unknown> {
  try {
    const part = jwt.split(".")[1] ?? ""
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (part.length % 4)) % 4)
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))) as Record<string, unknown>
  } catch {
    return {}
  }
}

let ringPromise: Promise<KeyRing> | null = null
const ring = (): Promise<KeyRing> => (ringPromise ??= keyRingFrom((n) => Deno.env.get(n)))

Deno.serve((req: Request): Promise<Response> => {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return Promise.resolve(new Response(JSON.stringify({ error: "This service is not configured." }), { status: 500, headers: { "content-type": "application/json" } }))
  return handle(req, {
    rpc,
    ring,
    now: () => Date.now(),
    env: (n) => Deno.env.get(n) ?? "",
    verifyJwt: async (jwt) => {
      const { data, error } = await db().auth.getUser(jwt)
      if (error || !data.user?.email) return null
      return { email: data.user.email, claims: claimsOf(jwt) }
    },
  })
})
