// PROJEXA local-first sync. Wires Deno.serve, the service-role client and the session verifier of ai-work-link (the same two Auth
// projects' published ES256 key sets) to handler.ts. Deploy with verify_jwt false: a PROJEXA session token is signed by the PROJEXA Auth project, not
// by verdian-ai, so the platform's own check would refuse it; session.ts verifies it instead. See handler.ts and README.md.
//
// The signing key (ES256) lives in platform.projexa_sync_key behind SECURITY DEFINER functions (drizzle/0678). The first isolate to need one creates it
// (the unique "one active key" index settles a race: the loser re-reads the winner); every isolate then caches it for 5 minutes so a rotation is noticed.
import { createClient } from "npm:@supabase/supabase-js@2"
import * as jose from "npm:jose@6.2.10"
import { createKeyResolvers, createSessionVerifier, type JoseLike } from "../ai-work-link/session.ts"
import { handleSync, RateLimiter, type ExecOutcome, type ExecRunBody, type PublicKeyInfo, type ReleaseInfo } from "./handler.ts"
import { createSigning, generateKeyRecord, type KeyRecord, type Signing } from "./sign.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })

// once per isolate: a warm isolate reuses the fetched key sets and the rate-cap memory
const joseLike = jose as unknown as JoseLike
const session = createSessionVerifier({ jose: joseLike, keys: createKeyResolvers(joseLike) })
const limiter = new RateLimiter()
const orgCache = new Map<string, { org: string; exp: number }>()
const releaseBox: { at: number; value: ReleaseInfo | null } = { at: 0, value: null }

const rpc = async (fn: string, args?: Record<string, unknown>) => {
  const { data, error } = await client.rpc(fn, args)
  return { data, error: error ? { message: error.message, code: error.code ?? undefined } : null }
}

const KEY_TTL_MS = 5 * 60_000
let signingCache: { signing: Signing; kid: string; at: number } | null = null
let publicCache: { keys: PublicKeyInfo[]; at: number } | null = null

async function loadSigning(): Promise<Signing | null> {
  if (signingCache && Date.now() - signingCache.at < KEY_TTL_MS) return signingCache.signing
  let res = await rpc("projexa_sync_key_active")
  let rec = res.data as KeyRecord | null
  if (!rec) {
    const fresh = await generateKeyRecord()
    res = await rpc("projexa_sync_key_put", { p_kid: fresh.kid, p_public: fresh.public_jwk, p_private: fresh.private_jwk })
    rec = res.data as KeyRecord | null
  }
  if (!rec || !rec.private_jwk) return null
  const signing = await createSigning(rec)
  signingCache = { signing, kid: rec.kid, at: Date.now() }
  return signing
}

async function loadPublicKeys(): Promise<PublicKeyInfo[]> {
  if (publicCache && Date.now() - publicCache.at < KEY_TTL_MS) return publicCache.keys
  const res = await rpc("projexa_sync_public_keys")
  const keys = Array.isArray(res.data) ? (res.data as PublicKeyInfo[]) : []
  publicCache = { keys, at: Date.now() }
  return keys
}

// A pushed write runs in the ai-work-link-exec function (the real pipeline), reached with the same internal secret the ai-work-link function uses. Secrets are project-wide.
// The answer is mapped to what happened: "unavailable" (nothing ran), "failed" (ran, refused, nothing written) or "uncertain" (sent, no answer: the write may have happened).
const EXEC_TIMEOUT_MS = 25_000
async function execRun(body: ExecRunBody): Promise<ExecOutcome> {
  const secret = Deno.env.get("AWL_EXEC_INTERNAL_SECRET")
  if (!secret || !SUPABASE_URL) return { kind: "unavailable" }
  let res: Response
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/ai-work-link-exec/sync-run`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(EXEC_TIMEOUT_MS),
    })
  } catch {
    return { kind: "uncertain" }
  }
  // not configured / not deployed / refused before anything ran
  if (res.status === 503 || res.status === 404 || res.status === 401 || res.status === 400) return { kind: "unavailable" }
  if (!res.ok) return { kind: "uncertain" }
  try {
    const j = (await res.json()) as { status?: string; record?: { id?: string | null; route?: string | null }; submission_id?: string | null; code?: string; missing?: string[] }
    if (j.status === "done") return { kind: "done", record: { id: j.record?.id ?? null, route: j.record?.route ?? null }, submission_id: j.submission_id ?? null }
    if (j.status === "failed" && typeof j.code === "string") return { kind: "failed", code: j.code, missing: Array.isArray(j.missing) ? j.missing : [] }
  } catch {
    // fall through
  }
  return { kind: "uncertain" }
}

Deno.serve((req: Request) =>
  handleSync(req, {
    session,
    limiter,
    orgCache,
    releaseBox,
    execRun,
    rpc,
    signing: () => loadSigning().catch(() => null),
    publicKeys: () => loadPublicKeys().catch(() => []),
  }),
)
