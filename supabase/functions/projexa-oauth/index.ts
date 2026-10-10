// Wires Deno.serve and the platform-injected service-role client to handler.ts (the logic, bun-tested in src/lib/ai-links/projexa-oauth.test.ts).
// Deploy with verify_jwt false (the callers are AI tools and the PROJEXA consent page; see handler.ts).
import { createClient } from "npm:@supabase/supabase-js@2"
import { handleOAuth, type OAuthStore } from "./handler.ts"

const url = Deno.env.get("SUPABASE_URL")!
const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } })

const must = async <T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> => {
  const { data, error } = await p
  if (error) throw new Error(error.message)
  return data
}

const store: OAuthStore = {
  async register(clientId, name, redirectUris) {
    await must(db.rpc("px_oauth_register", { p_client_id: clientId, p_name: name, p_redirect_uris: redirectUris }))
  },
  async getClient(clientId) {
    if (!clientId) return null
    const rows = await must(db.rpc("px_oauth_get_client", { p_client_id: clientId }))
    const r = (rows as Array<{ client_name: string; redirect_uris: string[] }> | null)?.[0]
    return r ? { name: r.client_name, redirectUris: r.redirect_uris } : null
  },
  async putCode(row) {
    await must(db.rpc("px_oauth_put_code", { p_code_hash: row.codeHash, p_client_id: row.clientId, p_redirect_uri: row.redirectUri, p_code_challenge: row.codeChallenge, p_link_token: row.linkToken, p_ttl_seconds: row.ttlSeconds }))
  },
  async takeCode(codeHash) {
    const rows = await must(db.rpc("px_oauth_take_code", { p_code_hash: codeHash }))
    const r = (rows as Array<{ client_id: string; redirect_uri: string; code_challenge: string; link_token: string }> | null)?.[0]
    return r ? { clientId: r.client_id, redirectUri: r.redirect_uri, codeChallenge: r.code_challenge, linkToken: r.link_token } : null
  },
}

const config = { base: `${url}/functions/v1/projexa-oauth`, awlBase: `${url}/functions/v1/ai-work-link`, appOrigin: "https://projexa-ai.com" }

Deno.serve((req) =>
  handleOAuth(req, { config, store, fetch, random: (n) => crypto.getRandomValues(new Uint8Array(n)) }).catch(
    () => new Response(JSON.stringify({ error: "server_error" }), { status: 500, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }),
  ),
)
