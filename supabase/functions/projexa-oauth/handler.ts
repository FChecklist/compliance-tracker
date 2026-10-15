// "Sign in with PROJEXA" for AI connectors (ChatGPT apps, Claude custom connectors, Gemini MCP): the OAuth 2.1 pieces an AI tool needs
// before it will keep a login to an MCP server, built so the access token IS an ordinary PROJEXA AI work link (pxa_<64 hex>, user-wide,
// level 1, 30 days). Everything the link may do, and everything it may not, is therefore decided by the work-link service exactly as
// before; this function adds no new permission, only a way to obtain the same link without copying it by hand.
//
//   GET  /.well-known/oauth-protected-resource   which server guards /mcp and who signs people in
//   GET  /.well-known/oauth-authorization-server the endpoints below (also served as a static file on projexa-ai.com, the issuer)
//   POST /register                               dynamic client registration (RFC 7591), public clients only, PKCE required
//   GET  /authorize                              checks the request, then sends the browser to the PROJEXA consent page
//   POST /approve                                called by the consent page with the link the signed-in person just minted; returns the redirect
//   POST /token                                  authorization_code + PKCE S256 -> the link as a bearer token
//   ANY  /mcp                                    401 + WWW-Authenticate without a bearer; with one, forwards to the work link's header-mode MCP
//
// Deploy with verify_jwt false: the callers are AI tools and a browser page, and the bearer token is the credential.

export type OAuthStore = {
  register(clientId: string, name: string, redirectUris: string[]): Promise<void>
  getClient(clientId: string): Promise<{ name: string; redirectUris: string[] } | null>
  putCode(row: { codeHash: string; clientId: string; redirectUri: string; codeChallenge: string; linkToken: string; ttlSeconds: number }): Promise<void>
  takeCode(codeHash: string): Promise<{ clientId: string; redirectUri: string; codeChallenge: string; linkToken: string } | null>
}

export type OAuthConfig = {
  /** https://<project>.supabase.co/functions/v1/projexa-oauth */
  base: string
  /** https://<project>.supabase.co/functions/v1/ai-work-link */
  awlBase: string
  /** The consent page's origin, e.g. https://projexa-ai.com */
  appOrigin: string
}

export type OAuthDeps = { config: OAuthConfig; store: OAuthStore; fetch: typeof fetch; random: (bytes: number) => Uint8Array }

export const TOKEN_RE = /^pxa_[0-9a-f]{64}$/
export const ACCESS_TOKEN_SECONDS = 30 * 24 * 60 * 60
const CODE_TTL_SECONDS = 300

const enc = new TextEncoder()
export const b64url = (b: Uint8Array): string => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
export const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")
export async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))
}

/** PKCE S256: base64url(sha256(verifier)) must equal the challenge the browser leg stored. */
export async function pkceMatches(verifier: string, challenge: string): Promise<boolean> {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false
  return b64url(await sha256(verifier)) === challenge
}

/** A redirect address a client may register: https, or plain http only for a program on this very computer. No fragment, no credentials. */
export function redirectUriAllowed(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 500) return false
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.hash || u.username || u.password) return false
  if (u.protocol === "https:") return true
  return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]")
}

export function protectedResourceMetadata(c: OAuthConfig) {
  return { resource: `${c.base}/mcp`, authorization_servers: [c.appOrigin], bearer_methods_supported: ["header"], resource_name: "PROJEXA" }
}

export function authorizationServerMetadata(c: OAuthConfig) {
  return {
    issuer: c.appOrigin,
    authorization_endpoint: `${c.base}/authorize`,
    token_endpoint: `${c.base}/token`,
    registration_endpoint: `${c.base}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["projexa"],
  }
}

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" }
const jsonRes = (status: number, body: unknown, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...NO_STORE, ...extra } })
const oauthError = (status: number, error: string, description: string): Response => jsonRes(status, { error, error_description: description })
const page = (status: number, text: string): Response =>
  new Response(`<!doctype html><meta charset="utf-8"><title>PROJEXA</title><p style="font:16px system-ui;margin:2rem">${text}</p>`, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE } })

const cors = (origin: string | null, allow: string): Record<string, string> =>
  origin === allow ? { "Access-Control-Allow-Origin": allow, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" } : {}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const v = await req.json()
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** "list_projects" -> "List projects". */
export const toolTitle = (name: string): string => name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())

const bearerOf = (req: Request): string | null => /^Bearer[ ]+(\S+)$/i.exec((req.headers.get("authorization") ?? "").trim())?.[1] ?? null

export async function handleOAuth(req: Request, deps: OAuthDeps): Promise<Response> {
  const { config, store } = deps
  const url = new URL(req.url)
  const i = url.pathname.indexOf("/projexa-oauth")
  const path = (i >= 0 ? url.pathname.slice(i + "/projexa-oauth".length) : url.pathname).replace(/\/+$/, "") || "/"
  const method = req.method.toUpperCase()

  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers:
        path === "/mcp"
          ? {
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
              "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version",
              "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
            }
          : cors(req.headers.get("origin"), config.appOrigin),
    })
  }

  if (path === "/.well-known/oauth-protected-resource" && method === "GET") return jsonRes(200, protectedResourceMetadata(config), { "Cache-Control": "public, max-age=300" })
  if (path === "/.well-known/oauth-authorization-server" && method === "GET") return jsonRes(200, authorizationServerMetadata(config), { "Cache-Control": "public, max-age=300" })

  if (path === "/register" && method === "POST") {
    const body = await readJson(req)
    const uris = body?.redirect_uris
    if (!body || !Array.isArray(uris) || uris.length < 1 || uris.length > 5 || !uris.every(redirectUriAllowed)) {
      return oauthError(400, "invalid_redirect_uri", "redirect_uris must be 1 to 5 https addresses (http only for localhost), with no fragment.")
    }
    const name = typeof body.client_name === "string" && body.client_name.trim() ? body.client_name.trim().slice(0, 80) : "An AI assistant"
    const clientId = `px_${hex(deps.random(12))}`
    await store.register(clientId, name, uris as string[])
    return jsonRes(201, { client_id: clientId, client_name: name, redirect_uris: uris, grant_types: ["authorization_code"], response_types: ["code"], token_endpoint_auth_method: "none" })
  }

  if (path === "/authorize" && method === "GET") {
    const q = url.searchParams
    const client = await store.getClient(q.get("client_id") ?? "")
    const redirectUri = q.get("redirect_uri") ?? ""
    // An unknown client or an unregistered redirect address is never redirected to: the browser stays here.
    if (!client || !client.redirectUris.includes(redirectUri)) return page(400, "This sign-in request is not valid (unknown app or return address). Close this window and start again from your AI tool.")
    const back = (error: string, description: string): Response => {
      const r = new URL(redirectUri)
      r.searchParams.set("error", error)
      r.searchParams.set("error_description", description)
      if (q.get("state")) r.searchParams.set("state", q.get("state")!)
      return new Response(null, { status: 302, headers: { Location: r.toString(), ...NO_STORE } })
    }
    if (q.get("response_type") !== "code") return back("unsupported_response_type", "Only response_type=code is supported.")
    if (q.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9\-_]{43}$/.test(q.get("code_challenge") ?? "")) return back("invalid_request", "PKCE with code_challenge_method=S256 is required.")
    const payload = b64url(enc.encode(JSON.stringify({ c: q.get("client_id"), r: redirectUri, s: q.get("state") ?? "", h: q.get("code_challenge"), n: client.name })))
    return new Response(null, { status: 302, headers: { Location: `${config.appOrigin}/connect/authorize/${payload}`, ...NO_STORE } })
  }

  if (path === "/approve") {
    const headers = cors(req.headers.get("origin"), config.appOrigin)
    if (method !== "POST") return jsonRes(405, { error: "method_not_allowed" }, headers)
    if (req.headers.get("origin") !== config.appOrigin) return jsonRes(403, { error: "forbidden", error_description: "Only the PROJEXA consent page may call this." }, headers)
    const body = await readJson(req)
    const clientId = typeof body?.client_id === "string" ? body.client_id : ""
    const redirectUri = typeof body?.redirect_uri === "string" ? body.redirect_uri : ""
    const challenge = typeof body?.code_challenge === "string" ? body.code_challenge : ""
    const linkToken = typeof body?.link_token === "string" ? body.link_token : ""
    const client = await store.getClient(clientId)
    if (!client || !client.redirectUris.includes(redirectUri) || !/^[A-Za-z0-9\-_]{43}$/.test(challenge) || !TOKEN_RE.test(linkToken)) {
      return jsonRes(400, { error: "invalid_request", error_description: "The request does not match a registered app." }, headers)
    }
    // The page minted this link as the signed-in person a moment ago; prove it is a live link before a code is attached to it.
    const probe = await deps
      .fetch(`${config.awlBase}/header`, {
        method: "POST",
        headers: { Authorization: `Bearer ${linkToken}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "projexa-oauth", version: "1" } } }),
      })
      .catch(() => null)
    if (!probe || probe.status !== 200) return jsonRes(400, { error: "invalid_request", error_description: "That link is not valid. Sign in to PROJEXA and try again." }, headers)
    const code = b64url(deps.random(32))
    await store.putCode({ codeHash: hex(await sha256(code)), clientId, redirectUri, codeChallenge: challenge, linkToken, ttlSeconds: CODE_TTL_SECONDS })
    const r = new URL(redirectUri)
    r.searchParams.set("code", code)
    if (typeof body?.state === "string" && body.state) r.searchParams.set("state", body.state)
    return jsonRes(200, { redirect: r.toString() }, headers)
  }

  if (path === "/token" && method === "POST") {
    const form = new URLSearchParams(await req.text())
    if (form.get("grant_type") !== "authorization_code") return oauthError(400, "unsupported_grant_type", "Only authorization_code is supported.")
    const code = form.get("code") ?? ""
    const row = code ? await store.takeCode(hex(await sha256(code))) : null
    if (!row || row.clientId !== form.get("client_id") || row.redirectUri !== form.get("redirect_uri") || !(await pkceMatches(form.get("code_verifier") ?? "", row.codeChallenge))) {
      return oauthError(400, "invalid_grant", "The code is wrong, used, expired or does not match. Start the sign-in again.")
    }
    return jsonRes(200, { access_token: row.linkToken, token_type: "Bearer", expires_in: ACCESS_TOKEN_SECONDS, scope: "projexa" })
  }

  if (path === "/mcp") {
    const corsMcp = { "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id" }
    const needSignIn = (): Response =>
      new Response(JSON.stringify({ error: "unauthorized", error_description: "Sign in with PROJEXA." }), {
        status: 401,
        headers: { "Content-Type": "application/json", "WWW-Authenticate": `Bearer resource_metadata="${config.base}/.well-known/oauth-protected-resource"`, ...NO_STORE, ...corsMcp },
      })
    const token = bearerOf(req)
    if (!token || !TOKEN_RE.test(token)) return needSignIn()
    const forward = new Headers({ Authorization: `Bearer ${token}` })
    for (const h of ["content-type", "accept", "mcp-session-id", "mcp-protocol-version"]) {
      const v = req.headers.get(h)
      if (v) forward.set(h, v)
    }
    const hasBody = method !== "GET" && method !== "HEAD"
    const bodyText = hasBody ? await req.text() : undefined
    const upstream = await deps.fetch(`${config.awlBase}/header`, { method, headers: forward, body: bodyText })
    // A revoked or expired link answers 404; for an OAuth client that means "sign in again".
    if (upstream.status === 404 || upstream.status === 401) return needSignIn()
    const out = new Headers({ ...NO_STORE, ...corsMcp })
    for (const h of ["content-type", "mcp-session-id"]) {
      const v = upstream.headers.get(h)
      if (v) out.set(h, v)
    }
    // The connector directories ask every tool for a human title; the work link names tools but does not title them, so tools/list gets one here.
    if (upstream.status === 200 && bodyText && /"method"\s*:\s*"tools\/list"/.test(bodyText) && (upstream.headers.get("content-type") ?? "").includes("application/json")) {
      const text = await upstream.text()
      try {
        const doc = JSON.parse(text) as { result?: { tools?: Array<Record<string, unknown>> } }
        for (const tool of doc.result?.tools ?? []) if (typeof tool.title !== "string" && typeof tool.name === "string") tool.title = toolTitle(tool.name)
        return new Response(JSON.stringify(doc), { status: 200, headers: out })
      } catch {
        return new Response(text, { status: 200, headers: out })
      }
    }
    return new Response(upstream.body, { status: upstream.status, headers: out })
  }

  return jsonRes(404, { error: "not_found" })
}
