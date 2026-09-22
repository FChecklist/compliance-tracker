/// <reference types="bun-types" />
// WO-DPDP-012 §7: the /ai/<token> Pages Function's pure logic
// (functions/ai/_proxy.ts) -- token shape, content-type choice, header set,
// status pass-through -- exercised with a fake fetch, no network.
import { describe, expect, test } from "bun:test"
import {
  HTML, JSON_TYPE, MARKDOWN, NOT_FOUND, PRIVATE_HEADERS, TOKEN_RE, UPSTREAM,
  contentTypeFor, parseTokenParam, proxyDraft, proxyGet, upstreamUrl, wantsMarkdown,
} from "../../functions/ai/_proxy"

const GOOD = "a".repeat(64)

type Call = { url: string; init?: RequestInit }
function fakeFetch(status: number, body: string, contentType: string, calls: Call[] = []) {
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return new Response(body, { status, headers: { "content-type": contentType } })
  }
  return { fn, calls }
}

describe("token shape", () => {
  test("accepts the 64-hex token dpdp_create_ai_link mints, with and without .md", () => {
    expect(parseTokenParam(GOOD)).toEqual({ token: GOOD, markdown: false })
    expect(parseTokenParam(`${GOOD}.md`)).toEqual({ token: GOOD, markdown: true })
    expect(parseTokenParam("abcdefghijklmnop")).toEqual({ token: "abcdefghijklmnop", markdown: false })
    expect(parseTokenParam("A-Z_09" + "x".repeat(250))).not.toBeNull()
  })

  test("rejects anything that is not a token", () => {
    for (const bad of ["", "short", "a".repeat(15), "a".repeat(257), `${GOOD}/../x`, `${GOOD}?x=1`, `${GOOD}.html`, "..", "%2e%2e", "a b".padEnd(20, "c"), "token.md", null, undefined]) {
      expect(parseTokenParam(bad as string), `should reject ${JSON.stringify(bad)}`).toBeNull()
    }
    expect(TOKEN_RE.test("é".repeat(20))).toBe(false)
  })
})

describe("content type", () => {
  test(".md or Accept: text/markdown -> markdown; otherwise html; both utf-8", () => {
    expect(wantsMarkdown({ token: GOOD, markdown: true }, null)).toBe(true)
    expect(wantsMarkdown({ token: GOOD, markdown: false }, "text/markdown")).toBe(true)
    expect(wantsMarkdown({ token: GOOD, markdown: false }, "text/html,application/xhtml+xml")).toBe(false)
    expect(wantsMarkdown({ token: GOOD, markdown: false }, null)).toBe(false)
    expect(contentTypeFor(true)).toBe(MARKDOWN)
    expect(contentTypeFor(false)).toBe(HTML)
    expect(MARKDOWN).toBe("text/markdown; charset=utf-8")
    expect(HTML).toBe("text/html; charset=utf-8")
  })

  test("upstream URLs", () => {
    expect(UPSTREAM).toBe("https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/dpdp-ai-link")
    expect(upstreamUrl(GOOD, false)).toBe(`${UPSTREAM}/${GOOD}`)
    expect(upstreamUrl(GOOD, true)).toBe(`${UPSTREAM}/${GOOD}.md`)
    expect(upstreamUrl(GOOD, false, true)).toBe(`${UPSTREAM}/${GOOD}/draft`)
  })
})

describe("GET /ai/<token>", () => {
  test("a bad token is 404 with the one sentence and never reaches upstream", async () => {
    const { fn, calls } = fakeFetch(200, "<html>", "text/plain")
    const res = await proxyGet(new Request("https://app.example/ai/nope"), "nope", fn)
    expect(res.status).toBe(404)
    expect(await res.text()).toBe(NOT_FOUND)
    expect(calls).toHaveLength(0)
    for (const [k, v] of Object.entries(PRIVATE_HEADERS)) expect(res.headers.get(k)).toBe(v)
  })

  test("html: upstream text/plain body comes back as text/html; charset=utf-8 with every private header", async () => {
    const { fn, calls } = fakeFetch(200, "<!doctype html><html><body>jobs</body></html>", "text/plain;charset=UTF-8")
    const res = await proxyGet(new Request("https://app.example/ai/x", { headers: { accept: "text/html" } }), GOOD, fn)
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe(HTML)
    expect(await res.text()).toContain("jobs")
    expect(calls[0].url).toBe(`${UPSTREAM}/${GOOD}`)
    expect(new Headers(calls[0].init?.headers).get("accept")).toBe("text/html")
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive, nosnippet")
    expect(res.headers.get("referrer-policy")).toBe("no-referrer")
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'")
  })

  test("markdown by .md suffix and by Accept header", async () => {
    const a = fakeFetch(200, "# jobs", "text/plain")
    const r1 = await proxyGet(new Request("https://app.example/ai/x.md"), `${GOOD}.md`, a.fn)
    expect(r1.headers.get("content-type")).toBe(MARKDOWN)
    expect(a.calls[0].url).toBe(`${UPSTREAM}/${GOOD}.md`)
    const b = fakeFetch(200, "# jobs", "text/plain")
    const r2 = await proxyGet(new Request("https://app.example/ai/x", { headers: { accept: "text/markdown" } }), GOOD, b.fn)
    expect(r2.headers.get("content-type")).toBe(MARKDOWN)
    expect(b.calls[0].url).toBe(`${UPSTREAM}/${GOOD}.md`)
    expect(new Headers(b.calls[0].init?.headers).get("accept")).toBe("text/markdown")
  })

  test("an upstream refusal passes its status through and is not relabelled as html", async () => {
    const { fn } = fakeFetch(404, NOT_FOUND, "text/plain;charset=UTF-8")
    const res = await proxyGet(new Request("https://app.example/ai/x"), GOOD, fn)
    expect(res.status).toBe(404)
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8")
    expect(await res.text()).toBe(NOT_FOUND)
    const j = fakeFetch(429, JSON.stringify({ error: "slow down" }), "application/json")
    const r2 = await proxyGet(new Request("https://app.example/ai/x"), GOOD, j.fn)
    expect(r2.status).toBe(429)
    expect(r2.headers.get("content-type")).toBe(JSON_TYPE)
  })
})

describe("POST /ai/<token>/draft", () => {
  test("JSON through both ways, status through, private headers on", async () => {
    const { fn, calls } = fakeFetch(201, JSON.stringify({ draftId: "d1", verb: "NOTE" }), "application/json")
    const body = JSON.stringify({ verb: "NOTE", obligationId: "o1", payload: { text: "hi" } })
    const res = await proxyDraft(new Request("https://app.example/ai/x/draft", { method: "POST", body, headers: { "content-type": "application/json" } }), GOOD, fn)
    expect(res.status).toBe(201)
    expect(res.headers.get("content-type")).toBe(JSON_TYPE)
    expect(await res.json()).toEqual({ draftId: "d1", verb: "NOTE" })
    expect(calls[0].url).toBe(`${UPSTREAM}/${GOOD}/draft`)
    expect(calls[0].init?.method).toBe("POST")
    expect(calls[0].init?.body).toBe(body)
    for (const [k, v] of Object.entries(PRIVATE_HEADERS)) expect(res.headers.get(k)).toBe(v)
  })

  test("a bad token, a .md token, or an oversized body never reaches upstream", async () => {
    const { fn, calls } = fakeFetch(201, "{}", "application/json")
    expect((await proxyDraft(new Request("https://app.example/ai/x/draft", { method: "POST", body: "{}" }), "nope", fn)).status).toBe(404)
    expect((await proxyDraft(new Request("https://app.example/ai/x/draft", { method: "POST", body: "{}" }), `${GOOD}.md`, fn)).status).toBe(404)
    const big = await proxyDraft(new Request("https://app.example/ai/x/draft", { method: "POST", body: "x".repeat(9000) }), GOOD, fn)
    expect(big.status).toBe(413)
    expect(calls).toHaveLength(0)
  })

  test("the RPC's own 400 refusal passes through as JSON", async () => {
    const { fn } = fakeFetch(400, JSON.stringify({ error: "Marking something not applicable needs a written reason." }), "application/json")
    const res = await proxyDraft(new Request("https://app.example/ai/x/draft", { method: "POST", body: "{}" }), GOOD, fn)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("written reason")
  })
})
