// PROJEXA-BUILD-001 U-46b1: the universal AI work link, first half (the read layer). ONE capability URL per project and person: a manual, an
// MCP server, a REST API and its OpenAPI documents. The logic is in handler.ts (bun-testable); this file only wires Deno.serve, the
// settings and the platform-injected service-role client to it. See handler.ts for the order of checks and README.md for how it is
// deployed. Deploy with verify_jwt false: the token in the address is the credential, and the caller is an AI tool, not a signed-in browser.
// U-47b: the app route POST /drafts/{id}/confirm takes a signed-in person's token instead; jose and the two Auth projects' published key sets
// verify it (session.ts), so verify_jwt stays false for the whole function.
import { createClient } from "npm:@supabase/supabase-js@2"
import * as jose from "npm:jose@6.2.10"
import { configFromEnv, EXEC_FUNCTION_PRESENT } from "./config.ts"
import { makeExecClient } from "./exec-client.ts"
import { handleAwl } from "./handler.ts"
import { createKeyResolvers, createSessionVerifier, type JoseLike } from "./session.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const config = configFromEnv((name) => Deno.env.get(name))
const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })

// BUILD-002 WP-09b: the client of the ai-work-link-exec function. Built only when EXEC_FUNCTION_PRESENT is true (a code change made after the exec
// function is deployed) AND the owner has set the shared internal secret; without either, no change can run and every direct change answers 503.
const EXEC_SECRET = Deno.env.get("AWL_EXEC_INTERNAL_SECRET") ?? ""
const exec = EXEC_FUNCTION_PRESENT && EXEC_SECRET !== "" ? makeExecClient({ baseUrl: `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/ai-work-link-exec`, secret: EXEC_SECRET }) : undefined

// Created once per isolate, so a warm isolate reuses the fetched key sets for their 10 minute cache.
const joseLike = jose as unknown as JoseLike
const session = createSessionVerifier({ jose: joseLike, keys: createKeyResolvers(joseLike) })

Deno.serve((req: Request) =>
  handleAwl(req, {
    config,
    session,
    exec,
    rpc: async (fn, args) => {
      const { data, error } = await client.rpc(fn, args)
      return { data, error: error ? { message: error.message, code: error.code ?? undefined } : null }
    },
  }),
)
