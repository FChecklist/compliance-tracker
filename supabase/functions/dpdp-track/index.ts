// DPDP visitor-journey tracking -- the Edge Function (Deno). See handler.ts for every route and README.md alongside for deployment.
//
// Deployed with verify_jwt = FALSE: the beacon comes from anonymous visitors. /link and the owner reads authenticate here, by asking Supabase Auth (`auth.getUser`) to
// validate the bearer token; the owner reads additionally require dpdp.platform_admin. The database is reached with the service-role client only; the RPCs
// (drizzle/0733) are executable by service_role alone.
//
// Secrets: DPDP_VISIT_KEY (REQUIRED for ip hashing -- without it no hash is stored), DPDP_VISIT_PROXY_KEY (optional; lets the Pages Function's forwarded address / country / city be
// trusted), DPDP_VISIT_RATE_PER_MIN (optional). SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are platform-injected.
import { createClient } from "npm:@supabase/supabase-js@2"
import { handle, type Rpc } from "./handler.ts"

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

Deno.serve((req: Request): Promise<Response> => {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return Promise.resolve(new Response(JSON.stringify({ error: "This service is not configured." }), { status: 500, headers: { "content-type": "application/json" } }))
  return handle(req, {
    rpc,
    now: () => Date.now(),
    env: (n) => Deno.env.get(n) ?? "",
    verifyJwt: async (jwt) => {
      const { data, error } = await db().auth.getUser(jwt)
      if (error || !data.user?.email) return null
      return { email: data.user.email, claims: { ...claimsOf(jwt), sub: data.user.id } }
    },
  })
})
