/// <reference types="bun-types" />
// functions/api/_visit.ts, the Pages Function relay for the visit-journey beacon: adds what Cloudflare saw (address, country, city) under the shared secret, ignores anything the
// browser tried to say about those, enforces method / origin / size, forwards the privacy headers, answers 204, and never lets an upstream failure reach the page.
import { describe, expect, test } from "bun:test"
import { MAX_BODY_BYTES, UPSTREAM, relayVisit } from "../../functions/api/_visit"

type Sent = { url: string; init: RequestInit & { headers: Record<string, string> } }
const fake = (status = 204, fail = false) => {
  const sent: Sent[] = []
  const f = async (url: string, init?: RequestInit) => { sent.push({ url, init: init as Sent["init"] }); if (fail) throw new Error("down"); return new Response(null, { status }) }
  return { sent, f }
}
const req = (body: string, headers: Record<string, string> = {}, method = "POST") => new Request("https://veridian-aios.com/api/visit", { method, headers: { "content-type": "application/json", ...headers }, ...(method === "GET" ? {} : { body }) })
const BODY = JSON.stringify({ sid: "ab".repeat(8), p: "/", e: [{ k: "pv", p: "/" }] })

describe("the relay", () => {
  test("forwards the beacon to the dpdp-track function with the address, country and city Cloudflare saw, and the proxy key", async () => {
    const { sent, f } = fake()
    const res = await relayVisit(req(BODY, { "cf-connecting-ip": "203.0.113.9", "cf-ipcountry": "IN", "user-agent": "UA/1", "accept-language": "en-IN", "sec-gpc": "1", origin: "https://veridian-aios.com" }), { VISIT_PROXY_KEY: "secret-secret-secret" }, { city: "Pune" }, f)
    expect(res.status).toBe(204)
    expect(sent.length).toBe(1)
    expect(sent[0]!.url).toBe(UPSTREAM)
    expect(sent[0]!.init.body).toBe(BODY)
    expect(sent[0]!.init.headers).toMatchObject({ "x-dpdp-client-ip": "203.0.113.9", "x-dpdp-client-country": "IN", "x-dpdp-client-city": "Pune", "x-dpdp-proxy-key": "secret-secret-secret", "user-agent": "UA/1", "sec-gpc": "1", origin: "https://veridian-aios.com" })
  })
  test("anything the browser says in x-dpdp-* headers is NOT forwarded (the relay sets its own from Cloudflare)", async () => {
    const { sent, f } = fake()
    await relayVisit(req(BODY, { "x-dpdp-client-ip": "1.2.3.4", "x-dpdp-client-country": "US", "x-dpdp-client-city": "Atlantis", "x-dpdp-proxy-key": "guess" }), {}, undefined, f)
    const h = sent[0]!.init.headers
    expect(h["x-dpdp-client-ip"]).toBeUndefined(); expect(h["x-dpdp-client-country"]).toBeUndefined(); expect(h["x-dpdp-client-city"]).toBeUndefined(); expect(h["x-dpdp-proxy-key"]).toBeUndefined()
  })
  test("only POST; another method is 405 and nothing is sent", async () => {
    const { sent, f } = fake()
    const res = await relayVisit(req("", {}, "GET"), {}, undefined, f)
    expect(res.status).toBe(405); expect(res.headers.get("allow")).toBe("POST"); expect(sent.length).toBe(0)
  })
  test("a foreign Origin is dropped silently; an oversize body is 413; neither is sent", async () => {
    const { sent, f } = fake()
    expect((await relayVisit(req(BODY, { origin: "https://evil.example" }), {}, undefined, f)).status).toBe(204)
    expect((await relayVisit(req("x".repeat(MAX_BODY_BYTES + 1)), {}, undefined, f)).status).toBe(413)
    expect(sent.length).toBe(0)
  })
  test("the answer is always empty, never cached, never indexed; an upstream outage is 204 so the page never notices; upstream 429/400/413 are passed through", async () => {
    const down = await relayVisit(req(BODY), {}, undefined, fake(200, true).f)
    expect(down.status).toBe(204)
    expect(down.headers.get("cache-control")).toBe("no-store"); expect(down.headers.get("x-robots-tag")).toContain("noindex")
    expect((await relayVisit(req(BODY), {}, undefined, fake(429).f)).status).toBe(429)
    expect((await relayVisit(req(BODY), {}, undefined, fake(500).f)).status).toBe(204)
  })
  test("the city is URL-encoded and length-capped before it goes into a header", async () => {
    const { sent, f } = fake()
    await relayVisit(req(BODY), {}, { city: "São Paulo" + "x".repeat(300) }, f)
    expect(sent[0]!.init.headers["x-dpdp-client-city"]!.length).toBeLessThanOrEqual(120)
    expect(sent[0]!.init.headers["x-dpdp-client-city"]).toContain("S%C3%A3o")
  })
})
