import { describe, expect, test } from "bun:test"
import {
  ACCESS_TOKEN_SECONDS, authorizationServerMetadata, b64url, handleOAuth, pkceMatches, protectedResourceMetadata, redirectUriAllowed, sha256, toolTitle,
  type OAuthDeps, type OAuthStore,
} from "../../../supabase/functions/projexa-oauth/handler"

// "Sign in with PROJEXA" for AI connectors. The whole flow runs against an in-memory store and a fake work-link service, so what is
// proven is the protocol and its refusals: PKCE, exact redirect matching, one-use codes, only the consent page may approve, and a
// bearer-less /mcp call being told to sign in. The access token IS a work link, so what it may do is decided by the work-link service.

const BASE = "https://x.supabase.co/functions/v1/projexa-oauth"
const AWL = "https://x.supabase.co/functions/v1/ai-work-link"
const APP = "https://projexa-ai.com"
const TOKEN = "pxa_" + "ab".repeat(32)
const REDIRECT = "https://claude.ai/api/mcp/auth_callback"

function memoryStore(): OAuthStore & { clients: Map<string, { name: string; redirectUris: string[] }>; codes: Map<string, Parameters<OAuthStore["putCode"]>[0]> } {
  const clients = new Map<string, { name: string; redirectUris: string[] }>()
  const codes = new Map<string, Parameters<OAuthStore["putCode"]>[0]>()
  return {
    clients, codes,
    async register(id, name, redirectUris) { clients.set(id, { name, redirectUris }) },
    async getClient(id) { return clients.get(id) ?? null },
    async putCode(row) { codes.set(row.codeHash, row) },
    async takeCode(h) { const r = codes.get(h); codes.delete(h); return r ? { clientId: r.clientId, redirectUri: r.redirectUri, codeChallenge: r.codeChallenge, linkToken: r.linkToken } : null },
  }
}

function setup(awl: (url: string, init: RequestInit) => Response | Promise<Response> = () => new Response(JSON.stringify({ result: {} }), { status: 200, headers: { "content-type": "application/json" } })) {
  const store = memoryStore()
  const calls: Array<{ url: string; init: RequestInit }> = []
  const deps: OAuthDeps = {
    config: { base: BASE, awlBase: AWL, appOrigin: APP },
    store,
    fetch: (async (url: string, init: RequestInit) => { calls.push({ url: String(url), init }); return awl(String(url), init) }) as unknown as typeof fetch,
    random: (n) => crypto.getRandomValues(new Uint8Array(n)),
  }
  const call = (path: string, init: RequestInit & { origin?: string } = {}) => {
    const headers = new Headers(init.headers)
    if (init.origin) headers.set("origin", init.origin)
    return handleOAuth(new Request(`${BASE}${path}`, { ...init, headers, redirect: "manual" }), deps)
  }
  return { store, calls, call }
}

async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)))
  return { verifier, challenge: b64url(await sha256(verifier)) }
}

async function register(call: ReturnType<typeof setup>["call"]) {
  const res = await call("/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: [REDIRECT] }) })
  expect(res.status).toBe(201)
  return ((await res.json()) as { client_id: string }).client_id
}

describe("discovery", () => {
  test("metadata names the endpoints, S256 only, public clients, issuer = the PROJEXA site", () => {
    const m = authorizationServerMetadata({ base: BASE, awlBase: AWL, appOrigin: APP })
    expect(m).toMatchObject({ issuer: APP, authorization_endpoint: `${BASE}/authorize`, token_endpoint: `${BASE}/token`, registration_endpoint: `${BASE}/register`, code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"] })
    expect(protectedResourceMetadata({ base: BASE, awlBase: AWL, appOrigin: APP })).toMatchObject({ resource: `${BASE}/mcp`, authorization_servers: [APP] })
  })

  test("the well-known pages answer 200 JSON", async () => {
    const { call } = setup()
    for (const p of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server"]) {
      const r = await call(p)
      expect(r.status).toBe(200)
      expect(r.headers.get("content-type")).toContain("application/json")
    }
  })
})

describe("registration", () => {
  test("only https addresses (and localhost http), no fragments, 1 to 5", () => {
    expect(redirectUriAllowed("https://claude.ai/cb")).toBe(true)
    expect(redirectUriAllowed("http://localhost:3000/cb")).toBe(true)
    expect(redirectUriAllowed("http://evil.example/cb")).toBe(false)
    expect(redirectUriAllowed("https://a.example/cb#frag")).toBe(false)
    expect(redirectUriAllowed("https://u:p@a.example/cb")).toBe(false)
    expect(redirectUriAllowed("javascript:alert(1)")).toBe(false)
    expect(redirectUriAllowed(42)).toBe(false)
  })

  test("a bad registration is refused and stores nothing", async () => {
    const { call, store } = setup()
    for (const body of [{}, { redirect_uris: [] }, { redirect_uris: ["http://evil.example/cb"] }, { redirect_uris: Array(6).fill(REDIRECT) }]) {
      const r = await call("/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      expect(r.status).toBe(400)
    }
    expect(store.clients.size).toBe(0)
  })
})

describe("the full sign-in, as an AI tool does it", () => {
  test("register -> authorize -> consent page approves -> token -> the same link comes back as a bearer", async () => {
    const { call, store, calls } = setup()
    const clientId = await register(call)
    const { verifier, challenge } = await pkce()

    const auth = await call(`/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}&state=st1&code_challenge=${challenge}&code_challenge_method=S256`)
    expect(auth.status).toBe(302)
    const loc = auth.headers.get("location")!
    expect(loc.startsWith(`${APP}/connect/authorize/`)).toBe(true)
    const carried = JSON.parse(atob(loc.split("/").pop()!.replace(/-/g, "+").replace(/_/g, "/")))
    expect(carried).toEqual({ c: clientId, r: REDIRECT, s: "st1", h: challenge, n: "Claude" })

    const approve = await call("/approve", { method: "POST", origin: APP, headers: { "content-type": "application/json" }, body: JSON.stringify({ client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, state: "st1", link_token: TOKEN }) })
    expect(approve.status).toBe(200)
    expect(approve.headers.get("access-control-allow-origin")).toBe(APP)
    const redirect = new URL(((await approve.json()) as { redirect: string }).redirect)
    expect(redirect.origin + redirect.pathname).toBe(REDIRECT)
    expect(redirect.searchParams.get("state")).toBe("st1")
    const code = redirect.searchParams.get("code")!
    // the link was proven live against the work-link service before a code was attached to it, and only a hash of the code is stored
    expect(calls[0].url).toBe(`${AWL}/header`)
    expect([...store.codes.keys()][0]).not.toContain(code)

    const tok = await call("/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier }).toString() })
    expect(tok.status).toBe(200)
    expect(tok.headers.get("cache-control")).toBe("no-store")
    expect(await tok.json()).toEqual({ access_token: TOKEN, token_type: "Bearer", expires_in: ACCESS_TOKEN_SECONDS, scope: "projexa" })
  })

  async function approved() {
    const s = setup()
    const clientId = await register(s.call)
    const { verifier, challenge } = await pkce()
    const approve = await s.call("/approve", { method: "POST", origin: APP, headers: { "content-type": "application/json" }, body: JSON.stringify({ client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, link_token: TOKEN }) })
    const code = new URL(((await approve.json()) as { redirect: string }).redirect).searchParams.get("code")!
    const exchange = (over: Record<string, string>) =>
      s.call("/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier, ...over }).toString() })
    return { ...s, clientId, verifier, challenge, code, exchange }
  }

  test("a code works once: the second exchange is refused", async () => {
    const { exchange } = await approved()
    expect((await exchange({})).status).toBe(200)
    expect((await exchange({})).status).toBe(400)
  })

  test("a wrong verifier, a wrong redirect, or another client's id is refused, and the code is spent", async () => {
    for (const over of [{ code_verifier: "x".repeat(43) }, { redirect_uri: "https://claude.ai/other" }, { client_id: "px_other" }]) {
      const { exchange } = await approved()
      const bad = await exchange(over)
      expect(bad.status).toBe(400)
      expect(((await bad.json()) as { error: string }).error).toBe("invalid_grant")
      expect((await exchange({})).status).toBe(400)
    }
  })

  test("only PKCE S256 is accepted at authorize, and an unregistered redirect never receives the browser", async () => {
    const { call } = setup()
    const clientId = await register(call)
    const { challenge } = await pkce()
    const plain = await call(`/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}&code_challenge=${challenge}&code_challenge_method=plain`)
    expect(plain.status).toBe(302)
    expect(new URL(plain.headers.get("location")!).searchParams.get("error")).toBe("invalid_request")
    const evil = await call(`/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent("https://evil.example/cb")}&code_challenge=${challenge}&code_challenge_method=S256`)
    expect(evil.status).toBe(400)
    expect(evil.headers.get("location")).toBeNull()
    expect((await call(`/authorize?response_type=code&client_id=nope&redirect_uri=${encodeURIComponent(REDIRECT)}`)).status).toBe(400)
  })

  test("approve is for the PROJEXA consent page only, and refuses a link the work-link service does not accept", async () => {
    const live = setup()
    const clientId = await register(live.call)
    const { challenge } = await pkce()
    const body = JSON.stringify({ client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, link_token: TOKEN })
    expect((await live.call("/approve", { method: "POST", headers: { "content-type": "application/json" }, body })).status).toBe(403)
    expect((await live.call("/approve", { method: "POST", origin: "https://evil.example", headers: { "content-type": "application/json" }, body })).status).toBe(403)
    expect(live.store.codes.size).toBe(0)

    const dead = setup(() => new Response("{}", { status: 404 }))
    const cid = await register(dead.call)
    const refused = await dead.call("/approve", { method: "POST", origin: APP, headers: { "content-type": "application/json" }, body: JSON.stringify({ client_id: cid, redirect_uri: REDIRECT, code_challenge: challenge, link_token: TOKEN }) })
    expect(refused.status).toBe(400)
    expect(dead.store.codes.size).toBe(0)
    // a token that is not shaped like a link never reaches the work-link service
    const shape = await live.call("/approve", { method: "POST", origin: APP, headers: { "content-type": "application/json" }, body: JSON.stringify({ client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, link_token: "pxa_short" }) })
    expect(shape.status).toBe(400)
  })

  test("pkceMatches only accepts the verifier that made the challenge", async () => {
    const { verifier, challenge } = await pkce()
    expect(await pkceMatches(verifier, challenge)).toBe(true)
    expect(await pkceMatches(verifier + "a", challenge)).toBe(false)
    expect(await pkceMatches("short", challenge)).toBe(false)
  })
})

describe("/mcp", () => {
  test("no bearer: 401 with the pointer to the protected-resource metadata", async () => {
    const { call, calls } = setup()
    for (const headers of [{}, { authorization: "Bearer nope" }, { authorization: "Basic abc" }]) {
      const r = await call("/mcp", { method: "POST", headers, body: "{}" })
      expect(r.status).toBe(401)
      expect(r.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource"`)
    }
    expect(calls.length).toBe(0)
  })

  test("a link bearer is forwarded to the work link's header-mode MCP, body and answer intact", async () => {
    const { call, calls } = setup(() => new Response('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}', { status: 200, headers: { "content-type": "application/json" } }))
    const r = await call("/mcp", { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", accept: "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' })
    expect(r.status).toBe(200)
    expect(await r.text()).toBe('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}')
    expect(calls[0].url).toBe(`${AWL}/header`)
    expect(new Headers(calls[0].init.headers).get("authorization")).toBe(`Bearer ${TOKEN}`)
    expect(calls[0].init.body).toBe('{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
  })

  test("an expired or revoked link (the service answers 404) becomes 401 so the tool signs in again", async () => {
    const { call } = setup(() => new Response("{}", { status: 404 }))
    const r = await call("/mcp", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: "{}" })
    expect(r.status).toBe(401)
    expect(r.headers.get("www-authenticate")).toContain("resource_metadata")
  })

  test("tools/list answers get a human title on every tool (the connector directories ask for one); other methods pass through untouched", async () => {
    const list = '{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"list_projects","annotations":{"readOnlyHint":true}},{"name":"search","title":"Already titled"}]}}'
    const { call } = setup(() => new Response(list, { status: 200, headers: { "content-type": "application/json" } }))
    const r = await call("/mcp", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' })
    const tools = ((await r.json()) as { result: { tools: Array<{ name: string; title: string; annotations?: unknown }> } }).result.tools
    expect(tools.map((t) => t.title)).toEqual(["List projects", "Already titled"])
    expect(tools[0].annotations).toEqual({ readOnlyHint: true })
    expect(toolTitle("get_record")).toBe("Get record")
    const other = setup(() => new Response(list, { status: 200, headers: { "content-type": "application/json" } }))
    const o = await other.call("/mcp", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: '{"jsonrpc":"2.0","id":2,"method":"tools/call"}' })
    expect(await o.text()).toBe(list)
  })
})
