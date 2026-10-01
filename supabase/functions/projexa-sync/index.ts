// PROJEXA local-first sync, read side. Wires Deno.serve, the service-role client and the session verifier of ai-work-link (the same two Auth
// projects' published ES256 key sets) to handler.ts. Deploy with verify_jwt false: a PROJEXA session token is signed by the PROJEXA Auth project, not
// by verdian-ai, so the platform's own check would refuse it; session.ts verifies it instead. See handler.ts and README.md.
import { createClient } from "npm:@supabase/supabase-js@2"
import * as jose from "npm:jose@6.2.10"
import { createKeyResolvers, createSessionVerifier, type JoseLike } from "../ai-work-link/session.ts"
import { handleSync, RateLimiter } from "./handler.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })

// once per isolate: a warm isolate reuses the fetched key sets and the rate-cap memory
const joseLike = jose as unknown as JoseLike
const session = createSessionVerifier({ jose: joseLike, keys: createKeyResolvers(joseLike) })
const limiter = new RateLimiter()

Deno.serve((req: Request) =>
  handleSync(req, {
    session,
    limiter,
    rpc: async (fn, args) => {
      const { data, error } = await client.rpc(fn, args)
      return { data, error: error ? { message: error.message, code: error.code ?? undefined } : null }
    },
  }),
)
