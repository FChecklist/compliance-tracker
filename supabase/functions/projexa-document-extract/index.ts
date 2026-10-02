// PROJEXA-BUILD-001 U-36 (E-13), BUILD-002 WP-15 (AW-902): the extraction worker of "create a project from a document". The compliance-tracker route posts a
// workbook digest here and this function makes the model call, so no Vercel function is billed for the model work. The logic is in
// handler.ts (bun-testable); the model call and the ledger are in wiring.ts; this file only wires Deno.serve and the environment.
import { createClient } from "npm:@supabase/supabase-js@2"
import { attributionFromHeaders, DEFAULT_BUDGET_CAP_USD, parseCapUsd } from "./budget.ts"
import { bearerMatches, handleProjexaDocumentExtract } from "./handler.ts"
import { GROQ_MODEL, GROQ_PROVIDER, OPENROUTER_PROVIDER, chooseModel, ledgerOver } from "./wiring.ts"

// The shared bearer secret (PROJEXA_DOCUMENT_EXTRACT_SECRET). Until it is set (or when it is shorter than 32 characters) bearerMatches() refuses every caller.
const CALLER_SECRET = Deno.env.get("PROJEXA_DOCUMENT_EXTRACT_SECRET") ?? ""
// The model: openai/gpt-oss-120b (PMD-43). OpenRouter (the platform's metered internal-AI route) when OPENROUTER_API_KEY is set, else Groq when GROQ_API_KEY is
// set (its on-demand tier refuses a whole workbook: 8,000 tokens a minute); with neither, null and every authenticated call answers 503 model_not_configured.
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? ""
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? ""
// The spend cap: 1.00 USD unless PROJEXA_EXTRACT_BUDGET_CAP_USD says another plain number. The ledger is compliance.token_usage_ledger through three
// service-role-only SQL functions (drizzle/0652); with no service key there is no budget, and the handler refuses every model call without one.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const client = SUPABASE_URL && SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) : null

Deno.serve((req: Request) =>
  handleProjexaDocumentExtract(req, {
    verifyCaller: (r) => Promise.resolve(bearerMatches(r.headers.get("authorization"), CALLER_SECRET)),
    // lf-b3-ai-off: null unless PROJEXA_INTERNAL_AI_ENABLED is exactly "1" (wiring.ts chooseModel).
    model: chooseModel((name) => Deno.env.get(name)),
    budget: client
      ? {
          ledger: ledgerOver(async (fn, args) => {
            const { data, error } = await client.rpc(fn, args)
            return { data, error: error ? { message: error.message } : null }
          }),
          provider: OPENROUTER_API_KEY ? OPENROUTER_PROVIDER : GROQ_PROVIDER,
          model: GROQ_MODEL,
          capUsd: parseCapUsd(Deno.env.get("PROJEXA_EXTRACT_BUDGET_CAP_USD") ?? String(DEFAULT_BUDGET_CAP_USD)),
          resolveAttribution: (r: Request) => attributionFromHeaders(r.headers, () => crypto.randomUUID()),
        }
      : null,
  }),
)
