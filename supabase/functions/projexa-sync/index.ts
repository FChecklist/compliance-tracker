// PROJEXA local-first sync. Wires Deno.serve, the service-role client and the session verifier of ai-work-link (the same two Auth
// projects' published ES256 key sets) to handler.ts. Deploy with verify_jwt false: a PROJEXA session token is signed by the PROJEXA Auth project, not
// by verdian-ai, so the platform's own check would refuse it; session.ts verifies it instead. See handler.ts and README.md.
//
// The signing key (ES256) lives in platform.projexa_sync_key behind SECURITY DEFINER functions (drizzle/0678). The first isolate to need one creates it
// (the unique "one active key" index settles a race: the loser re-reads the winner); every isolate then caches it for 5 minutes so a rotation is noticed.
import { createClient } from "npm:@supabase/supabase-js@2"
import * as jose from "npm:jose@6.2.10"
import { createKeyResolvers, createSessionVerifier, type JoseLike } from "../ai-work-link/session.ts"
import { handleSync, RateLimiter, type PublicKeyInfo } from "./handler.ts"
import { createSigning, generateKeyRecord, type KeyRecord, type Signing } from "./sign.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })

// once per isolate: a warm isolate reuses the fetched key sets and the rate-cap memory
const joseLike = jose as unknown as JoseLike
const session = createSessionVerifier({ jose: joseLike, keys: createKeyResolvers(joseLike) })
const limiter = new RateLimiter()
const orgCache = new Map<string, { org: string; exp: number }>()

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

Deno.serve((req: Request) =>
  handleSync(req, {
    session,
    limiter,
    orgCache,
    rpc,
    signing: () => loadSigning().catch(() => null),
    publicKeys: () => loadPublicKeys().catch(() => []),
  }),
)
