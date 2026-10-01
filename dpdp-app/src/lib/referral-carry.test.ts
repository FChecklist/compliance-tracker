/// <reference types="bun-types" />
// The share link's ?ref=<code> must survive the click from a script-free
// public page to the sign-up form (functions/_referral.ts + _middleware.ts).
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { CARRY_PAGES, carryRef, refFromUrl, shouldRewrite } from "../../functions/_referral"
import { PRIVATE_PAGES, PUBLIC_PAGES } from "./public-surface.mjs"

const root = join(import.meta.dir, "..", "..")
const u = (s: string) => new URL(`https://veridian-aios.com${s}`)

describe("which requests are rewritten", () => {
  test("a valid ref on a public page, GET only", () => {
    expect(shouldRewrite("GET", u("/?ref=ABCD2345"))).toBe("ABCD2345")
    expect(shouldRewrite("GET", u("/dpdp-firm/?ref=abcd"))).toBe("abcd")
    expect(shouldRewrite("POST", u("/?ref=ABCD2345"))).toBeNull()
    expect(shouldRewrite("HEAD", u("/?ref=ABCD2345"))).toBeNull()
  })
  test("no ref, or a ref that is not shaped like a code, changes nothing", () => {
    for (const q of ["", "?ref=", "?ref=abc", "?ref=" + "A".repeat(17), "?ref=AB%20CD12", "?ref=AB-CD12", "?ref=<script>", "?other=ABCD2345"]) {
      expect(refFromUrl(u("/" + q)), q).toBeNull()
      expect(shouldRewrite("GET", u("/" + q)), q).toBeNull()
    }
  })
  test("private prefixes, assets and unknown paths are never rewritten, even with a valid ref", () => {
    for (const p of ["/app/", "/act/", "/unsubscribe/", "/p/", "/copy/", "/ai/" + "a".repeat(64), "/original/", "/assets/x.js", "/fonts/a.woff2", "/robots.txt", "/llms.txt", "/nope/"]) {
      expect(shouldRewrite("GET", u(`${p}?ref=ABCD2345`)), p).toBeNull()
    }
  })
})

describe("carryRef on one href", () => {
  const C = "ABCD2345"
  test("adds the code to the next steps and keeps their own query", () => {
    expect(carryRef("/dpdp-firm/", C)).toBe(`/dpdp-firm/?ref=${C}`)
    expect(carryRef("/dpdp-institution/", C)).toBe(`/dpdp-institution/?ref=${C}`)
    expect(carryRef("/app/", C)).toBe(`/app/?ref=${C}`)
    expect(carryRef("/app/?edition=firm", C)).toBe(`/app/?edition=firm&ref=${C}`)
    expect(carryRef("/app/?edition=institution", C)).toBe(`/app/?edition=institution&ref=${C}`)
  })
  test("keeps the #fragment last", () => {
    expect(carryRef("/about/#how", C)).toBe(`/about/?ref=${C}#how`)
    expect(carryRef("/app/?edition=firm#x", C)).toBe(`/app/?edition=firm&ref=${C}#x`)
  })
  test("never overwrites a ref already on the link", () => {
    expect(carryRef("/app/?ref=OTHER123", C)).toBeNull()
  })
  test("leaves every other link alone", () => {
    for (const h of [
      "#top", "", "https://veridian-aios.com/", "http://x/", "//evil.example/app/", "/" + String.fromCharCode(92) + "evil.example", "mailto:a@b.c", "tel:+911",
      "/fonts/sora-latin-wght.woff2", "/favicon-48.png", "/src/site.css", "/ai/" + "a".repeat(64), "/act/", "/p/", "/original/", "/unknown/", "dpdp-firm/", "/app", "/dpdp-firm",
    ]) expect(carryRef(h, C), JSON.stringify(h)).toBeNull()
  })
  test("refuses a code that is not a code, so nothing injectable reaches an href", () => {
    for (const bad of ["", "abc", '"><script>', "A B C D", "a".repeat(17)]) expect(carryRef("/app/", bad)).toBeNull()
  })
})

describe("coverage stays in step with the site", () => {
  test("every public page can carry the code, and no private prefix can", () => {
    for (const p of PUBLIC_PAGES) expect(CARRY_PAGES).toContain(p.path)
    for (const priv of PRIVATE_PAGES) for (const c of CARRY_PAGES) expect(c.startsWith(priv.prefix)).toBe(false)
  })
  test("public/_routes.json invokes the function for exactly the carry pages and /ai/*", () => {
    const routes = JSON.parse(readFileSync(join(root, "public", "_routes.json"), "utf8"))
    expect(routes.version).toBe(1)
    expect([...routes.include].sort()).toEqual([...CARRY_PAGES, "/ai/*"].sort())
    expect(routes.include).not.toContain("/app/")
  })
  test("each carry page exists as a static file", () => {
    for (const c of CARRY_PAGES) {
      if (c === "/proof/") continue // built and hidden until facts.proof.enabled
      const f = c === "/" ? "index.html" : `${c.slice(1)}index.html`
      expect(existsSync(join(root, f)) || existsSync(join(root, "public", f)), c).toBe(true)
    }
  })
  test("the pages still hand a bare, script-free link to the next step (what this fix compensates for)", () => {
    const home = readFileSync(join(root, "index.html"), "utf8")
    expect(home).toContain('href="/dpdp-firm/"')
    expect(home).not.toContain("?ref=")
  })
})

// Bun ships the same lol-html HTMLRewriter Cloudflare Workers does, so the
// middleware itself runs here against the real built-from-source pages.
describe("functions/_middleware.ts end to end", () => {
  const page = (rel: string) => readFileSync(join(root, rel), "utf8")
  async function run(path: string, html: string, init: { method?: string; status?: number; type?: string } = {}) {
    const { onRequest } = await import("../../functions/_middleware")
    const res = new Response(html, { status: init.status ?? 200, headers: { "content-type": init.type ?? "text/html; charset=utf-8", etag: '"abc"' } })
    return onRequest({ request: new Request(`https://veridian-aios.com${path}`, { method: init.method ?? "GET" }), next: async () => res })
  }
  const hrefs = (html: string) => [...html.matchAll(/<a\b[^>]*\shref="([^"]*)"/g)].map((m) => m[1])

  test("home: the two doors and Sign in carry the code; the rest is unchanged", async () => {
    const src = page("index.html")
    const out = await (await run("/?ref=ABCD2345", src)).text()
    const h = hrefs(out)
    expect(h).toContain("/dpdp-firm/?ref=ABCD2345")
    expect(h).toContain("/dpdp-institution/?ref=ABCD2345")
    expect(h).toContain("/app/?ref=ABCD2345")
    expect(h).toContain("https://veridian-aios.com/") // absolute share link untouched
    // Exactly the internal hrefs to carry pages changed, nothing else in the document.
    expect(out.replaceAll("?ref=ABCD2345", "")).toBe(src)
    expect(out).not.toContain("<script>")
  })

  test("edition page: the Start free link keeps ?edition= and gains the code", async () => {
    const out = await (await run("/dpdp-firm/?ref=ABCD2345", page("dpdp-firm/index.html"))).text()
    expect(hrefs(out)).toContain("/app/?edition=firm&ref=ABCD2345")
    expect(hrefs(out)).not.toContain("/app/?edition=firm")
  })

  test("served privately, and without a stale validator", async () => {
    const res = await run("/?ref=ABCD2345", page("index.html"))
    expect(res.headers.get("cache-control")).toBe("private, no-store")
    expect(res.headers.get("etag")).toBeNull()
  })

  test("no ref: the response is the static one, byte for byte and header for header", async () => {
    const src = page("index.html")
    const res = await run("/", src)
    expect(await res.text()).toBe(src)
    expect(res.headers.get("etag")).toBe('"abc"')
    expect(res.headers.get("cache-control")).toBeNull()
  })

  test("an invalid ref, a non-GET, a non-HTML body or a non-200 is passed through untouched", async () => {
    const src = page("index.html")
    expect(await (await run("/?ref=no", src)).text()).toBe(src)
    expect(await (await run("/?ref=ABCD2345", src, { method: "HEAD" })).text()).toBe(src)
    expect(await (await run("/?ref=ABCD2345", "x", { type: "text/plain" })).text()).toBe("x")
    expect(await (await run("/?ref=ABCD2345", src, { status: 404 })).text()).toBe(src)
  })
})
