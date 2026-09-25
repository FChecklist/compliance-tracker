// PROJEXA-BUILD-001 U-21 (PMD-12): the PROJEXA timer's worker. pg_cron (drizzle/0615) posts here once a day at 09:30 UTC with
// {"job":"exchange_rate_refresh"}. Vercel is not in the path. The logic is in handler.ts (bun-testable); this file only wires the
// platform-injected service-role client to it. See handler.ts for the security model.
import { createClient } from "npm:@supabase/supabase-js@2"
import { handleTimer } from "./handler.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

Deno.serve((req: Request) =>
  handleTimer(req, {
    rpc: async (fn, args) => {
      const { data, error } = await client.rpc(fn, args)
      return { data, error: error ? { message: error.message } : null }
    },
    fetchImpl: (input, init) => fetch(input, init),
    now: () => new Date(),
  }),
)
