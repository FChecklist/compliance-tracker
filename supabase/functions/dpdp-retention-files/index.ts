// DPDP retention of payment-proof files -- the daily job's Edge Function (Deno). Logic and tests: handler.ts / src/lib/services/dpdp-retention-files.test.ts.
//
// SECURITY: deployed with verify_jwt FALSE (pg_cron sends a Vault secret, not a Supabase JWT), exactly like dpdp-audit-lifecycle. The bearer is checked against
// DPDP_TIMER_SECRET when set, else through public.dpdp_timer_check_bearer (drizzle/0608, the same Vault secret the cron reads). A missing or short bearer, or no secret
// anywhere, refuses everything (fail closed). It sends no e-mail and returns counts only: never a file name.
import { createClient } from "npm:@supabase/supabase-js@2"
import { runRetentionFiles } from "./handler.ts"

const env = (k: string): string => Deno.env.get(k) ?? ""
const SUPABASE_URL = env("SUPABASE_URL")
const SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY")
const TIMER_SECRET = env("DPDP_TIMER_SECRET")
const BUCKET = "dpdp-payment-proofs"

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

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return new Response("Use POST", { status: 405 })
  if (!(await bearerOk(req))) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "content-type": "application/json" } })
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return new Response(JSON.stringify({ error: "This service is not configured." }), { status: 500, headers: { "content-type": "application/json" } })
  let dryRun = false
  try { dryRun = ((await req.json()) as { dryRun?: boolean })?.dryRun === true } catch { /* no body is fine */ }
  const sb = client()
  const report = await runRetentionFiles({
    rpc: async (fn, args) => {
      const { data, error } = await sb.rpc(fn, args)
      return { data, error: error ? { code: error.code ?? undefined, message: error.message } : null }
    },
    removeFiles: async (names) => {
      const { data, error } = await sb.storage.from(BUCKET).remove(names)
      if (error) return { removed: [], error: "storage_error" }
      return { removed: (data ?? []).map((o: { name: string }) => o.name) }
    },
  }, { dryRun })
  return new Response(JSON.stringify(report), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } })
})
