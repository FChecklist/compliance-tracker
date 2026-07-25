import { createClient, type SupabaseClient } from "@supabase/supabase-js"

// Shared by every route that needs the service-role Supabase client to mint
// admin magic links (passcode-login/route.ts, sso/[orgSlug]/acs/route.ts) --
// this exact `createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,
// process.env.SUPABASE_SERVICE_ROLE_KEY!)` call was previously duplicated in
// both, with a bare `!` non-null assertion that crashes with an opaque
// "Invalid URL"/similar error deep inside @supabase/supabase-js when either
// var is unset, instead of a clear message pointing at the actual cause.
export class SupabaseAdminConfigError extends Error {
  constructor(missingVarName: string) {
    super(`getSupabaseAdmin: missing required environment variable ${missingVarName}`)
    this.name = "SupabaseAdminConfigError"
  }
}

export function requireSupabaseAdminEnv(
  env: Record<string, string | undefined>
): { supabaseUrl: string; supabaseServiceRoleKey: string } {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) throw new SupabaseAdminConfigError("NEXT_PUBLIC_SUPABASE_URL")

  const supabaseServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseServiceRoleKey) throw new SupabaseAdminConfigError("SUPABASE_SERVICE_ROLE_KEY")

  return { supabaseUrl, supabaseServiceRoleKey }
}

// Lazy, same pattern as src/lib/db/index.ts's getClient()/getDb() -- and for
// the same reason documented in that file's own header comment: validating
// and constructing eagerly at module-evaluation time would mean any file
// that merely imports getSupabaseAdmin (e.g. a test, or Next's build-time
// route tracing) turns a missing env var into a crash on import rather than
// on first real use. Still only validated once -- the first call either
// throws (and every subsequent call throws again, cheaply, until the env is
// fixed) or populates the cache for every call after it.
let supabaseAdmin: SupabaseClient | undefined

export function getSupabaseAdmin(): SupabaseClient {
  if (!supabaseAdmin) {
    const { supabaseUrl, supabaseServiceRoleKey } = requireSupabaseAdminEnv(process.env)
    supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey)
  }
  return supabaseAdmin
}
