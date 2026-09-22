import { createClient } from "@supabase/supabase-js"
import { createMockClient } from "./mock-client"

export type RpcError = { message: string; code?: string }
export type RpcResult<T = unknown> = { data: T | null; error: RpcError | null }
export type AuthSession = { user: { email?: string } }
export type AuthListener = (event: string, session: AuthSession | null) => void

// The exact surface the app uses -- narrow on purpose so the VITE_MOCK=1
// shim (mock-client.ts) can stand in for the real client without faking
// the whole SupabaseClient type.
export interface DpdpClient {
  auth: {
    getSession(): Promise<{ data: { session: AuthSession | null } }>
    onAuthStateChange(cb: AuthListener): { data: { subscription: { unsubscribe(): void } } }
    signInWithOtp(opts: { email: string; options?: { emailRedirectTo?: string } }): Promise<{ error: { message: string } | null }>
    signOut(): Promise<{ error: { message: string } | null }>
  }
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcResult>
}

export const IS_MOCK = import.meta.env.VITE_MOCK === "1"

export function createDpdpClient(): DpdpClient {
  if (IS_MOCK) return createMockClient()

  const url = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not set -- copy .env.example to .env.local, or run with VITE_MOCK=1.")
  }

  // Only the anon key is ever bundled (scripts/scan-bundle.mjs proves it per
  // build). Sign-in is a magic link: with flowType "implicit" the link lands
  // the session tokens in the URL HASH FRAGMENT (#access_token=...), which
  // browsers never send to a server and which detectSessionInUrl consumes
  // and clears on load -- that is what satisfies the sibling work order's
  // rule that no token may ever sit in a URL path or query. PKCE is NOT
  // used because it would put ?code=... in the query string instead.
  const supabase = createClient(url, anonKey, {
    auth: { flowType: "implicit", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
  })
  return {
    auth: supabase.auth,
    rpc: (fn, args) => supabase.rpc(fn, args),
  }
}
