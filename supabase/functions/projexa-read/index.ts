// PROJEXA-BUILD-001 U-25 (PMD-01): the identity gateway. A PROJEXA browser session calls this with its own access token and reads
// verdian-ai construction data of its own organisation, with no Vercel function in the path. The logic is in handler.ts and jwt.ts
// (bun-testable); this file only wires jose, the key set and the platform-injected service-role client to them. See handler.ts
// for the security model. Deploy with verify_jwt false.
import { createClient } from "npm:@supabase/supabase-js@2"
import * as jose from "npm:jose@6.2.10"
import { handleProjexaRead } from "./handler.ts"
import { createProjexaKeyResolver, verifyProjexaToken, type JoseLike } from "./jwt.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

// Created once per isolate, so a warm isolate reuses the fetched key set for its 10 minute cache.
const joseLike = jose as unknown as JoseLike
const keys = createProjexaKeyResolver(joseLike)

Deno.serve((req: Request) =>
  handleProjexaRead(req, {
    verify: (token) => verifyProjexaToken(token, { jose: joseLike, keys }),
    rpc: async (fn, args) => {
      const { data, error } = await client.rpc(fn, args)
      return { data, error: error ? { message: error.message } : null }
    },
  }),
)
