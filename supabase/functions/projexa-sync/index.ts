// PROJEXA local-first sync. Wires Deno.serve, the service-role client and the session verifier of ai-work-link (the same two Auth
// projects' published ES256 key sets) to handler.ts. Deploy with verify_jwt false: a PROJEXA session token is signed by the PROJEXA Auth project, not
// by verdian-ai, so the platform's own check would refuse it; session.ts verifies it instead. See handler.ts and README.md.
//
// The signing key (ES256) lives in platform.projexa_sync_key behind SECURITY DEFINER functions (drizzle/0678). The first isolate to need one creates it
// (the unique "one active key" index settles a race: the loser re-reads the winner); every isolate then caches it for 5 minutes so a rotation is noticed.
// The key caches are the pure createKeyCaches() of handler.ts (tested there): a failed refresh keeps serving the last good key, concurrent cold requests
// share one load, and an errored or empty public-key list is not cached for 5 minutes (review D1 F-11).
import { createClient } from "npm:@supabase/supabase-js@2"
import * as jose from "npm:jose@6.2.10"
import { createKeyResolvers, createSessionVerifier, type JoseLike } from "../ai-work-link/session.ts"
import { createExecRun, createExecRunBatch, createKeyCaches, handleSync, RateLimiter, type ReleaseInfo } from "./handler.ts"
import { createSigning, generateKeyRecord } from "./sign.ts"

// A driver error that surfaces outside any await would otherwise end the isolate (and every other request in flight on it) with no log line. Log its
// class and a redacted, shortened message, and keep the isolate alive (the same listeners as ai-work-link-exec/index.ts; review D1 F-14a).
const redact = (v: unknown): string => String((v as { message?: unknown })?.message ?? v).replace(/postgres(ql)?:\/\/\S+/gi, "<hidden>").replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "<token>").slice(0, 300)
globalThis.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
  console.error("projexa-sync: unhandled rejection:", redact(e.reason))
  e.preventDefault()
})
globalThis.addEventListener("error", (e: ErrorEvent) => {
  console.error("projexa-sync: uncaught error:", redact(e.error ?? e.message))
  e.preventDefault()
})

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })

// once per isolate: a warm isolate reuses the fetched key sets and the rate-cap memory
const joseLike = jose as unknown as JoseLike
const session = createSessionVerifier({ jose: joseLike, keys: createKeyResolvers(joseLike) })
const limiter = new RateLimiter()
const orgCache = new Map<string, { org: string; exp: number }>()
const releaseBox: { at: number; value: ReleaseInfo | null } = { at: 0, value: null }
const registerBox: { at: number; answer: { status: number; body: unknown } | null } = { at: 0, answer: null }

const rpc = async (fn: string, args?: Record<string, unknown>) => {
  const { data, error } = await client.rpc(fn, args)
  return { data, error: error ? { message: error.message, code: error.code ?? undefined } : null }
}

const keys = createKeyCaches({ rpc, createSigning, generateKeyRecord })

// A pushed write runs in the ai-work-link-exec function (the real pipeline). AWL_SYNC_EXEC_SECRET, when the owner sets it, is a secret for /sync-run only
// (the AI link's AWL_EXEC_INTERNAL_SECRET is the fallback, so nothing breaks before it is set). The HTTP mapping is execOutcomeOf in handler.ts.
// Batch mode: the ops of one push run in ONE exec invocation (/sync-run-batch), falling back to one call per op when that route is not deployed yet.
const execOptions = { url: SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/ai-work-link-exec` : "", secret: Deno.env.get("AWL_SYNC_EXEC_SECRET") || Deno.env.get("AWL_EXEC_INTERNAL_SECRET") }
const execRun = createExecRun(execOptions)
const execRunBatch = createExecRunBatch(execOptions)

Deno.serve((req: Request) =>
  handleSync(req, {
    session,
    limiter,
    orgCache,
    releaseBox,
    releaseOrigin: Deno.env.get("PX_RELEASE_ORIGIN") ?? undefined,
    registerBox,
    execRun,
    execRunBatch,
    rpc,
    signing: keys.signing,
    publicKeys: keys.publicKeys,
  }),
)
