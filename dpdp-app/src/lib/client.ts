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
    verifyOtp(opts: { email: string; token: string; type: "email" }): Promise<{ error: { message: string } | null }>
    signOut(): Promise<{ error: { message: string } | null }>
  }
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<RpcResult>
  /** Payment proof upload (WO-DPDP-016 follow-on). Any signed-in person may upload; only the Owner may read one back (enforced by storage policy, not here). */
  uploadPaymentProof(orgId: string, file: File): Promise<{ path: string | null; error: string | null }>
  /** For calling an authenticated Edge Function (dpdp-invoice-email) -- the caller's own access token, or null if signed out. */
  accessToken(): Promise<string | null>
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
    async uploadPaymentProof(orgId, file) {
      const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png"
      const path = `${orgId}/${crypto.randomUUID()}.${ext}`
      const { error } = await supabase.storage.from("dpdp-payment-proofs").upload(path, file, { contentType: file.type || undefined })
      return { path: error ? null : path, error: error ? error.message : null }
    },
    async accessToken() {
      const { data } = await supabase.auth.getSession()
      return data.session ? (data.session as unknown as { access_token: string }).access_token : null
    },
  }
}
