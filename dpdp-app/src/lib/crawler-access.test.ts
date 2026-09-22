/// <reference types="bun-types" />
// WO-DPDP-012 §3: the outside-verification script must (1) probe every
// named crawler agent against every public and private path, (2) fail on
// any 403, (3) fail when a public page is served noindex, and (4) fail when
// the private path is NOT noindex. Exercised against a real in-process HTTP
// server so the verdict logic is proven, not assumed; the live run against
// the real host is the go-live checklist line.
import { describe, expect, test } from "bun:test"
import { CRAWLER_AGENTS, PRIVATE_PATHS, PUBLIC_PATHS, checkCrawlerAccess, formatTable } from "../../scripts/check-crawler-access.mjs"

type Behaviour = (path: string, ua: string) => Response
function serve(behaviour: Behaviour) {
  const server = Bun.serve({ port: 0, fetch: (req) => behaviour(new URL(req.url).pathname, req.headers.get("user-agent") ?? "") })
  return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) }
}
const html = (extra: Record<string, string> = {}) => new Response("<h1>ok</h1>", { status: 200, headers: { "content-type": "text/html", ...extra } })

describe("WO-DPDP-012 §3 crawler access check", () => {
  test("names all nine required agents from the work order", () => {
    const names = CRAWLER_AGENTS.map(([n]) => n)
    for (const required of ["Googlebot", "Bingbot", "Applebot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "PerplexityBot", "Perplexity-User"]) {
      expect(names).toContain(required)
    }
  })

  test("PASS: every public path 200 for every agent, private path noindex for every agent", async () => {
    const s = serve((path) => (PRIVATE_PATHS.includes(path) ? html({ "x-robots-tag": "noindex, nofollow" }) : html()))
    try {
      const r = await checkCrawlerAccess(s.url)
      expect(r.rows).toHaveLength(CRAWLER_AGENTS.length * (PUBLIC_PATHS.length + PRIVATE_PATHS.length))
      expect(r.any403).toBe(false)
      expect(r.ok).toBe(true)
      expect(formatTable(r.rows)).toContain("Googlebot")
    } finally { s.stop() }
  })

  test("FAIL: one agent blocked with 403 on one public page", async () => {
    const s = serve((path, ua) => {
      if (PRIVATE_PATHS.includes(path)) return html({ "x-robots-tag": "noindex, nofollow" })
      if (path === "/dpdp-firm/" && /ClaudeBot/.test(ua)) return new Response("blocked", { status: 403 })
      return html()
    })
    try {
      const r = await checkCrawlerAccess(s.url)
      expect(r.any403).toBe(true)
      expect(r.ok).toBe(false)
      const bad = r.rows.filter((x) => !x.ok)
      expect(bad).toHaveLength(1)
      expect(bad[0]).toMatchObject({ agent: "ClaudeBot", path: "/dpdp-firm/", status: 403 })
    } finally { s.stop() }
  })

  test("FAIL: a public page served with noindex is a failure even though it is 200", async () => {
    const s = serve((path) => (path === "/" ? html({ "x-robots-tag": "noindex" }) : PRIVATE_PATHS.includes(path) ? html({ "x-robots-tag": "noindex, nofollow" }) : html()))
    try {
      const r = await checkCrawlerAccess(s.url)
      expect(r.ok).toBe(false)
      expect(r.rows.filter((x) => !x.ok).every((x) => x.path === "/")).toBe(true)
    } finally { s.stop() }
  })

  test("FAIL: the private app path without X-Robots-Tag noindex is a failure", async () => {
    const s = serve(() => html())
    try {
      const r = await checkCrawlerAccess(s.url)
      expect(r.ok).toBe(false)
      expect(r.rows.filter((x) => !x.ok).every((x) => x.kind === "private")).toBe(true)
    } finally { s.stop() }
  })

  test("an unreachable host is reported as status 0, never as a pass", async () => {
    const r = await checkCrawlerAccess("http://127.0.0.1:9", { timeoutMs: 2000 })
    expect(r.ok).toBe(false)
    expect(r.rows.every((x) => x.status === 0)).toBe(true)
  }, 60_000)
})
