// PROJEXA-BUILD-001 U-40 (PMD-39): the scheduler bridge's Edge Function. pg_cron (drizzle/0642) posts here every five minutes with
// {"job":"scheduler_bridge"} once the PM switches the job on at go-live. Vercel is not in the first two hops. The logic is in
// handler.ts (bun-testable); this file only wires the platform-injected service-role client and two Edge Function secrets to it.
// See handler.ts for the security model.
import { createClient } from "npm:@supabase/supabase-js@2"
import { handleBridge } from "./handler.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

Deno.serve((req: Request) =>
  handleBridge(req, {
    rpc: async (fn, args) => {
      const { data, error } = await client.rpc(fn, args)
      return { data, error: error ? { message: error.message } : null }
    },
    fetchImpl: (input, init) => fetch(input, init),
    now: () => new Date(),
    config: {
      appBaseUrl: Deno.env.get("SCHEDULER_BRIDGE_APP_URL") ?? null,
      internalSecret: Deno.env.get("SCHEDULER_BRIDGE_INTERNAL_SECRET") ?? null,
    },
  }),
)
