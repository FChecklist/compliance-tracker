// Cloudflare Pages Function: GET /api/mode -- the public, read-only Test / Live mode (drizzle/0735 dpdp_platform_mode). Cached for a few seconds.
// It can only READ: the switch is an owner-only database function that this relay never calls. Pages variable SUPABASE_ANON_KEY (the publishable key).
export type Env = { SUPABASE_ANON_KEY?: string; SUPABASE_URL?: string }
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export const DEFAULT_URL = "https://pcrjmlpuqsbocqfwoxod.supabase.co"
const HEADERS = { "Content-Type": "application/json", "Cache-Control": "public, max-age=5, s-maxage=5", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex" }

export async function readMode(method: string, env: Env, fetchImpl: FetchLike = fetch): Promise<Response> {
  if (method.toUpperCase() !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET", "Cache-Control": "no-store" } })
  const key = env.SUPABASE_ANON_KEY
  // Not configured or unreachable: say LIVE (a practice banner must never appear by mistake) and do not cache the guess for long.
  const live = () => new Response(JSON.stringify({ mode: "LIVE", test: false }), { status: 200, headers: { ...HEADERS, "Cache-Control": "no-store" } })
  if (!key) return live()
  try {
    const res = await fetchImpl(`${(env.SUPABASE_URL || DEFAULT_URL).replace(/\/+$/, "")}/rest/v1/rpc/dpdp_platform_mode`, {
      method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return live()
    const d = (await res.json()) as { mode?: string }
    const mode = d?.mode === "TEST" ? "TEST" : "LIVE"
    return new Response(JSON.stringify({ mode, test: mode === "TEST" }), { status: 200, headers: HEADERS })
  } catch {
    return live()
  }
}
