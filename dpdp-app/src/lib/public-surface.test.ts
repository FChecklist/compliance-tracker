/// <reference types="bun-types" />
// WO-DPDP-012 drift guard for the static host (same pattern as
// src/lib/dpdp-public-surface.test.ts on the Next.js side): robots.txt,
// _headers, llms.txt, the sitemap renderer and the page sources must all
// agree with src/lib/public-surface.mjs, the one list of public and
// private paths. No DB, no network, no build -- this reads the committed
// source files only. scripts/check-public-surface.mjs is the post-build
// twin that checks dist/ the same way.
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  FACTS,
  FOOTER_LINKS,
  NAV_AI,
  NAV_PARTNER,
  NAV_SIGN_IN,
  OG_IMAGE,
  REF_SCRIPT,
  PRIVATE_PAGES,
  PUBLIC_ORIGIN,
  PUBLIC_PAGES,
  REQUIRED_BOTS,
  SITE_ORIGIN,
  LEGACY_APP_ORIGIN,
  pageUrl,
  parseHeadersFile,
  parseRobots,
  renderSitemap,
  resolveHeaders,
} from "./public-surface.mjs"
// The Next.js side's own public/private split for veridian-aios.com. The two
// hosts are different, but the edition landings are public on both -- WO-012
// §2 landed there first and this app must not quietly disagree with it.
import { DPDP_PUBLIC_ALLOW } from "../../../src/lib/dpdp-public-surface"

const root = join(import.meta.dir, "..", "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")

describe("public-surface.mjs: the one list", () => {
  test("every public page is a slashed directory URL whose source file exists", () => {
    for (const p of PUBLIC_PAGES) {
      expect(p.path.startsWith("/")).toBe(true)
      expect(p.path.endsWith("/")).toBe(true)
      expect(existsSync(join(root, p.source))).toBe(true)
      expect(p.title.length).toBeGreaterThan(0)
      expect(p.h1.length).toBeGreaterThan(0)
      expect(p.mustContain.length).toBeGreaterThan(0)
      expect(p.jsonLd).toContain("Organization")
      expect(p.jsonLd).toContain("WebSite")
    }
    expect(new Set(PUBLIC_PAGES.map((p) => p.path)).size).toBe(PUBLIC_PAGES.length)
  })

  test("no public page sits under a private prefix, and every private source exists", () => {
    for (const priv of PRIVATE_PAGES) {
      expect(priv.prefix.endsWith("/")).toBe(true)
      // A null source is a Pages Function: its handler must exist instead.
      if (priv.source === null) expect(existsSync(join(root, "functions", priv.prefix.replace(/^\/|\/$/g, "")))).toBe(true)
      else expect(existsSync(join(root, priv.source))).toBe(true)
      for (const pub of PUBLIC_PAGES) expect(pub.path.startsWith(priv.prefix)).toBe(false)
    }
  })

  test("the edition landings are public on the Next.js host too (src/lib/dpdp-public-surface.ts)", () => {
    const nextJsAllow: readonly string[] = DPDP_PUBLIC_ALLOW
    // Only the edition landings exist on both hosts. /about/
    // (WO-DPDP-013 v2) is generated on this static host only.
    const landings = PUBLIC_PAGES.filter((p) => p.path.startsWith("/dpdp-"))
    expect(landings.map((p) => p.path)).toEqual(["/dpdp-firm/", "/dpdp-institution/"])
    for (const pub of landings) expect(nextJsAllow).toContain(pub.path.replace(/\/$/, ""))
  })
})

describe("public/robots.txt (WO-012 §3: explicit, not left to defaults)", () => {
  const { groups, sitemaps } = parseRobots(read("public/robots.txt"))

  test("every named bot is allowed on public paths and disallowed on every private prefix", () => {
    for (const bot of REQUIRED_BOTS) {
      const group = groups.find((g) => g.agents.includes(bot))
      expect(group, `${bot} is not named`).toBeDefined()
      expect(group!.allow).toContain("/")
      for (const priv of PRIVATE_PAGES) expect(group!.disallow).toContain(priv.prefix)
    }
  })

  test("User-agent: * disallows every private prefix", () => {
    const star = groups.find((g) => g.agents.includes("*"))
    expect(star).toBeDefined()
    for (const priv of PRIVATE_PAGES) expect(star!.disallow).toContain(priv.prefix)
  })

  test("no group disallows a public page", () => {
    for (const g of groups) for (const d of g.disallow) for (const pub of PUBLIC_PAGES) expect(d && pub.path.startsWith(d)).toBe(false)
  })

  // SEO (2026-10-01): the public pages are indexed under the apex. The
  // sitemap the robots file announces is the apex's, never the app host's.
  test("lists exactly the public host's sitemap (the apex, not the app host)", () => {
    expect(sitemaps).toEqual([`${PUBLIC_ORIGIN}/sitemap.xml`])
    expect(PUBLIC_ORIGIN).toBe("https://veridian-aios.com")
    expect(sitemaps[0]).not.toContain(new URL(SITE_ORIGIN).host)
  })
})

describe("two origins, one bundle (SEO canonical host)", () => {
  test("pageUrl() is on the apex; SITE_ORIGIN is the app host (dpdp., since 2026-10-01), which api.ts needs for AI-link URLs; app. is only the legacy host", () => {
    expect(SITE_ORIGIN).toBe("https://dpdp.veridian-aios.com")
    expect(LEGACY_APP_ORIGIN).toBe("https://app.veridian-aios.com")
    for (const p of PUBLIC_PAGES) expect(pageUrl(p.path)).toBe(`${PUBLIC_ORIGIN}${p.path}`)
    expect(pageUrl("/")).toBe("https://veridian-aios.com/")
  })

  // The owner-approved product sentence ("dpdp.veridian-aios.com is Indian
  // software ...") names the dpdp. host as a plain word on every page, so the
  // rule for that host is "never as an address": no `//host`, no `host/`. The
  // legacy app. host is named nowhere at all.
  test("no public page source, llms file or robots.txt links to the app host or names the legacy host", () => {
    const current = new URL(SITE_ORIGIN).host
    const legacy = new URL(LEGACY_APP_ORIGIN).host
    for (const rel of [...PUBLIC_PAGES.map((p) => p.source), "public/llms.txt", "public/llms-full.txt", "public/robots.txt"]) {
      const body = read(rel)
      expect(body, `${rel} links to ${current}`).not.toContain(`//${current}`)
      expect(body, `${rel} links to ${current}/`).not.toContain(`${current}/`)
      expect(body, `${rel} names ${legacy}`).not.toContain(legacy)
    }
  })

  test("the sitemap renderer emits apex URLs only", () => {
    const xml = renderSitemap(PUBLIC_PAGES.map((p) => ({ path: p.path, lastmod: "2026-10-01T10:00:00+05:30" })))
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    expect(locs.length).toBe(PUBLIC_PAGES.length)
    for (const l of locs) expect(l.startsWith(`${PUBLIC_ORIGIN}/`), l).toBe(true)
  })
})

describe("public/_headers (WO-012 §2 over HTTP, on Cloudflare Pages)", () => {
  const rules = parseHeadersFile(read("public/_headers"))

  test("a rule exists for each private prefix's splat", () => {
    for (const priv of PRIVATE_PAGES) expect(rules.some((r) => r.path === `${priv.prefix}*`)).toBe(true)
  })

  test("private paths get noindex, exactly no-referrer, no-store, nosniff", () => {
    for (const priv of PRIVATE_PAGES) {
      for (const path of [priv.prefix, `${priv.prefix}index.html`, `${priv.prefix}anything`]) {
        const h = resolveHeaders(rules, path)
        expect(h["x-robots-tag"]).toBe("noindex, nofollow")
        // Exactly, not comma-joined with the site-wide value: Cloudflare merges
        // every matching rule, so the private rule must detach first.
        expect(h["referrer-policy"]).toBe("no-referrer")
        expect(h["cache-control"]).toBe("no-store")
        expect(h["x-content-type-options"]).toBe("nosniff")
      }
    }
  })

  test("public pages get no X-Robots-Tag and the site-wide policies", () => {
    for (const pub of PUBLIC_PAGES) {
      const h = resolveHeaders(rules, pub.path)
      expect(h["x-robots-tag"]).toBeUndefined()
      expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin")
      expect(h["x-content-type-options"]).toBe("nosniff")
    }
  })
})

describe("public/_headers: caching (speed) without breaking the private prefixes", () => {
  const rules = parseHeadersFile(read("public/_headers"))

  test("hashed build output and the frozen fonts are cached for a year, immutable", () => {
    for (const path of ["/assets/site-BN48JZUe.css", "/assets/app-C9wmjQ_q.js", "/fonts/sora-latin-wght.woff2", "/fonts/instrument-sans-latin-wght.woff2", "/original/fonts/x.woff2"]) {
      expect(resolveHeaders(rules, path)["cache-control"], path).toBe("public, max-age=31536000, immutable")
    }
  })

  test("the brand images get a day, not a year (their names never change)", () => {
    for (const path of [OG_IMAGE.path, "/logo.png", "/favicon-48.png"]) expect(resolveHeaders(rules, path)["cache-control"], path).toBe("public, max-age=86400")
  })

  test("public HTML pages stay on the Pages default (revalidate): no Cache-Control rule matches them", () => {
    for (const pub of PUBLIC_PAGES) expect(resolveHeaders(rules, pub.path)["cache-control"], pub.path).toBeUndefined()
  })

  test("no Cache-Control rule can reach a private prefix except the private rule itself (a broad rule would comma-join with no-store)", () => {
    for (const rule of rules) {
      if (!rule.set.some(([n]) => n.toLowerCase() === "cache-control")) continue
      for (const priv of PRIVATE_PAGES) {
        for (const path of [priv.prefix, `${priv.prefix}index.html`, `${priv.prefix}x`]) {
          const hit = new RegExp("^" + rule.path.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$").test(path)
          if (hit) expect(rule.path, `${path} is matched by ${rule.path}`).toBe(`${priv.prefix}*`)
        }
      }
    }
  })
})

describe("sitemap renderer (WO-012 §1: public pages only, real lastmod)", () => {
  const all = PUBLIC_PAGES.map((p) => ({ path: p.path, lastmod: "2026-09-22T10:00:00+05:30" }))

  test("lists exactly the public pages, each with its lastmod", () => {
    const xml = renderSitemap(all)
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    expect(locs).toEqual(PUBLIC_PAGES.map((p) => pageUrl(p.path)))
    expect(xml.match(/<lastmod>/g)?.length).toBe(PUBLIC_PAGES.length)
  })

  test("refuses a private path, a missing page, a duplicate and a bad lastmod", () => {
    expect(() => renderSitemap([...all, { path: PRIVATE_PAGES[0].prefix, lastmod: "2026-09-22" }])).toThrow(/not a public page/)
    expect(() => renderSitemap(all.slice(1))).toThrow(/missing/)
    expect(() => renderSitemap([...all, all[0]])).toThrow(/twice/)
    expect(() => renderSitemap(all.map((e) => ({ ...e, lastmod: "22/09/2026" })))).toThrow(/W3C datetime/)
  })
})

describe("public/llms.txt and llms-full.txt (WO-012 §3: honest, existing pages only)", () => {
  for (const file of ["public/llms.txt", "public/llms-full.txt"]) {
    test(`${file} lists every public page, links no private page, and carries no crawl-policy essay`, () => {
      const text = read(file)
      for (const pub of PUBLIC_PAGES) expect(text).toContain(pageUrl(pub.path))
      for (const priv of PRIVATE_PAGES) expect(text).not.toContain(pageUrl(priv.prefix))
      // Owner, 2026-10-01: nothing about what search engines have or have not confirmed.
      expect(text).not.toMatch(/no major search engine has confirmed/i)
      expect(text).not.toMatch(/\bhonest|plain note\b/i)
    })
  }

  test("public/llms.txt is short: the home page's own facts, the list of pages, the contact, nothing internal", () => {
    const text = read("public/llms.txt")
    expect(text.split("\n").length).toBeLessThan(60)
    expect(text).toContain(FACTS.one_line)
    for (const banned of [/facts file/i, /approved/i, /version \d/i, /\bowner\b/i, /library/i, /reviewer/i, /signed-in app/i, /No prices are published/i]) expect(text, String(banned)).not.toMatch(banned)
  })
})

// Owner decision 2026-10-01: the public fact sheet for AI systems, its plain
// text twin and facts.json published internal detail, so they are gone, and no
// public surface names them.
describe("withdrawn surfaces: /for-ai/, /for-ai.md, /facts.json", () => {
  test("the files do not exist and are not in the page lists", () => {
    for (const rel of ["for-ai/index.html", "public/for-ai.md", "public/facts.json"]) expect(existsSync(join(root, rel)), rel).toBe(false)
    expect(PUBLIC_PAGES.some((p) => p.path === "/for-ai/")).toBe(false)
    expect(FOOTER_LINKS).toEqual([["/about/", "About VERIDIAN"]])
  })

  test("no public page, llms file, robots.txt, _headers or sitemap names them", () => {
    const sitemap = renderSitemap(PUBLIC_PAGES.map((p) => ({ path: p.path, lastmod: "2026-10-01T10:00:00+05:30" })))
    const surfaces: Array<[string, string]> = [...PUBLIC_PAGES.map((p) => [p.source, read(p.source)] as [string, string]), ["public/llms.txt", read("public/llms.txt")], ["public/llms-full.txt", read("public/llms-full.txt")], ["public/robots.txt", read("public/robots.txt")], ["sitemap.xml", sitemap]]
    for (const [rel, body] of surfaces) {
      expect(body, `${rel} names /for-ai`).not.toMatch(/for-ai/i)
      expect(body, `${rel} names facts.json`).not.toMatch(/facts\.json/i)
      expect(body, `${rel} names the fact sheet for AI systems`).not.toMatch(/fact sheet for ai/i)
    }
  })
})

describe("the home page offers exactly two ways in (owner, 2026-10-01)", () => {
  const html = read("index.html")
  const main = /<main class="chooser">([\s\S]*?)<\/main>/.exec(html)![1]
  const choices = [...main.matchAll(/<a class="choice" href="([^"]*)">([\s\S]*?)<\/a>/g)].map((m) => ({ href: m[1], text: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() }))

  test("two big choice cards, with exactly these labels and targets", () => {
    expect(choices).toEqual([
      { href: "/dpdp-firm/", text: "🧑‍⚖️ I AM A CA / CS / LEGAL / AUDIT FIRM — DOING FOR MY CLIENTS" },
      { href: "/dpdp-institution/", text: "🏭 I AM A COMPANY / INSTITUTION / SCHOOL / NGO — DOING FOR OURSELVES" },
    ])
  })

  test("no third option or secondary chooser link: the only other links in the page body are the free AI assistant highlight (its button and its page), the sign-in and About", () => {
    const hrefs = [...main.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((m) => m[1])
    // "/app/" twice: the AI assistant highlight's button and "Already have an account? Sign in".
    expect(hrefs.sort()).toEqual(["/about/", "/ai-assistant/", "/app/", "/app/", "/dpdp-firm/", "/dpdp-institution/"].sort())
    expect(main).not.toMatch(/school instead/i)
    expect(main).not.toContain("?for=")
  })
})

// Owner, 2026-10-01 (edited the same day): the home page shows THREE numbered points.
describe("the home page's three points (owner, 2026-10-01)", () => {
  const html = read("index.html")
  const main = /<main class="chooser">([\s\S]*?)<\/main>/.exec(html)![1]

  test("the h1 and an ordered list of exactly three, 1 to 3, in the owner's words", () => {
    expect(main).toContain("<h1 class=\"chooser-title\">Three things to know about DPDP compliance</h1>")
    const list = /<ol class="lead-list">([\s\S]*?)<\/ol>/.exec(main)![1]
    const items = [...list.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1])
    expect(items).toEqual(["People change. When they leave, what they knew about your data leaves with them.", "Know what data you hold, and who else holds it for you.", "Prove it — with a record that outlasts the person who set it up."])
    expect(items).toEqual([...FACTS.three_things])
  })

  test("the old four-things and three-things-plus-a-proof wording is gone from every public surface", () => {
    for (const rel of [...PUBLIC_PAGES.map((p) => p.source), "public/llms.txt", "public/llms-full.txt"]) {
      const body = read(rel)
      expect(body, `${rel} still says "Prove all three"`).not.toContain("Prove all three")
      expect(body, `${rel} still has the three things on one line`).not.toContain("Know what data you hold. Tell people about it. Keep it safe.")
      expect(body, `${rel} still has the old four things`).not.toContain("Tell people about it.")
    }
    expect(read("public/llms-full.txt")).toContain("1. People change. When they leave, what they knew about your data leaves with them.\n2. Know what data you hold, and who else holds it for you.\n3. Prove it — with a record that outlasts the person who set it up.")
  })
})

// Owner, 2026-10-01: a "Sales Partner" link in the TOP RIGHT of the header of every public page, next to Sign in.
describe("the header of every public page: Sales Partner next to Sign in, top right", () => {
  const headerOf = (html: string) => /<header class="nav">([\s\S]*?)<\/header>/.exec(html)?.[1] ?? ""

  test("every public page has a header whose last two links are Sales Partner (/partner/) then Sign in (/app/)", () => {
    for (const p of PUBLIC_PAGES) {
      const header = headerOf(read(p.source))
      expect(header, `${p.path} has no <header class="nav">`).not.toBe("")
      const links = [...header.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({ attrs: m[1], href: /href="([^"]*)"/.exec(m[1])![1], text: m[2].replace(/<[^>]+>/g, "").trim() }))
      const last2 = links.slice(-2)
      expect(last2.map((l) => [l.href, l.text]), p.path).toEqual([
        [NAV_PARTNER.href, "Sales Partner"],
        [NAV_SIGN_IN.href, "Sign in"],
      ])
      expect(last2[0].attrs, p.path).toContain('class="nav-partner"')
      expect(last2[1].attrs, p.path).toContain('class="nav-signin"')
    }
    expect(NAV_PARTNER).toEqual({ href: "/partner/", label: "Sales Partner" })
  })

  test("both links sit inside the right-hand .nav-actions group, which is the last child of the header row", () => {
    for (const p of PUBLIC_PAGES) {
      const header = headerOf(read(p.source))
      const row = /<div class="nav-inner">([\s\S]*)<\/div>\s*$/.exec(header)![1]
      const actions = /<div class="nav-actions">([\s\S]*?)<\/div>\s*$/.exec(row.trimEnd())
      expect(actions, `${p.path}: .nav-actions is not the last thing in the header row`).not.toBeNull()
      expect(actions![1]).toContain('href="/partner/"')
      expect(actions![1]).toContain('href="/app/">Sign in</a>')
    }
  })

  // Owner, 2026-10-01: ONE feature highlighted separately, on the upper right: the free AI assistant. A filled pill, first in the same
  // group, so it is visibly different from the two text links beside it, and always on screen (no menu to open on a phone).
  test("the free AI assistant pill is the FIRST item of the top-right group on every public page, a link to /ai-assistant/", () => {
    expect(NAV_AI).toEqual({ href: "/ai-assistant/", label: "Free AI assistant" })
    for (const p of PUBLIC_PAGES) {
      const header = headerOf(read(p.source))
      const actions = /<div class="nav-actions">([\s\S]*?)<\/div>\s*<\/div>\s*$/.exec(header)?.[1] ?? ""
      const links = [...actions.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({ attrs: m[1], href: /href="([^"]*)"/.exec(m[1])![1], text: m[2].replace(/<[^>]+>/g, "").trim() }))
      const pill = links.find((l) => l.attrs.includes('class="nav-ai"'))
      expect(pill, `${p.path}: no free AI assistant pill in the top-right group`).toBeDefined()
      expect([pill!.href, pill!.text], p.path).toEqual([NAV_AI.href, NAV_AI.label])
      // nothing but the AI pill, Sales Partner and Sign in is allowed to sit between the pill and the right edge
      const after = links.slice(links.indexOf(pill!) + 1).map((l) => l.href)
      expect(after, p.path).toEqual([NAV_PARTNER.href, NAV_SIGN_IN.href])
      // it is a real link in the always-visible group: not hidden, not in a menu, not behind a button
      expect(actions, p.path).not.toMatch(/hidden|aria-hidden|<button|<details|display\s*:\s*none/i)
    }
  })

  test("the pill is styled as a filled accent pill (not a text link), AA contrast, never hidden on a phone", () => {
    const css = read("src/site.css")
    const rule = /\.nav-ai\s*\{([^}]*)\}/.exec(css)![1]
    expect(rule).toMatch(/background:\s*var\(--violet\)/)
    expect(rule).toMatch(/color:\s*#fff/)
    expect(rule).toMatch(/border-radius:\s*9999px/)
    // no rule anywhere hides it, at any width
    expect(css).not.toMatch(/\.nav-ai[^{]*\{[^}]*display\s*:\s*none/)
    // the group wraps and stays right-aligned when the row is too narrow for four items
    const group = [...css.matchAll(/\.nav-actions\s*\{([^}]*)\}/g)].map((m) => m[1]).join("\n")
    expect(group).toMatch(/flex-wrap:\s*wrap/)
    expect(group).toMatch(/margin-left:\s*auto/)
    // white on --violet (#6d28d9): relative luminance contrast, computed here
    const lin = (h: string) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number]
    const lum = (h: string) => { const [r, g, b] = lin(h); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
    expect(/--violet:\s*#6d28d9/.test(css)).toBe(true)
    expect((1 + 0.05) / (lum("6d28d9") + 0.05)).toBeGreaterThanOrEqual(4.5)
  })

  test("the stylesheet keeps the group on the right (space-between row, flex group)", () => {
    const css = read("src/site.css")
    expect(css).toMatch(/\.nav-inner \{[^}]*justify-content: space-between/)
    expect(css).toMatch(/\.nav-actions \{[^}]*display: flex/)
  })
})

// Owner, 2026-10-01: /partner/ is public and indexable; everything private stays private. The lists are pinned
// EXACTLY, so adding a public page or opening a private one is a deliberate edit of this test, not a side effect.
describe("what is public and what is private, pinned exactly (with /partner/ public)", () => {
  test("the public pages are exactly these (+ /proof/ only if the owner switched it on)", () => {
    const expected = ["/", "/dpdp-firm/", "/dpdp-institution/", "/about/", "/partner/", "/ai-assistant/"].concat(FACTS.proof.enabled ? ["/proof/"] : [])
    expect(PUBLIC_PAGES.map((p) => p.path)).toEqual(expected)
  })

  test("the private prefixes are exactly these six; /partner/ is not under any of them", () => {
    expect(PRIVATE_PAGES.map((p) => p.prefix)).toEqual(["/app/", "/act/", "/unsubscribe/", "/copy/", "/p/", "/ai/"])
    for (const priv of PRIVATE_PAGES) expect("/partner/".startsWith(priv.prefix), `/partner/ is under ${priv.prefix}`).toBe(false)
  })

  test("/partner/ is indexable everywhere: in the sitemap, allowed by every robots group, no X-Robots-Tag, listed in llms.txt", () => {
    const rules = parseHeadersFile(read("public/_headers"))
    const h = resolveHeaders(rules, "/partner/")
    expect(h["x-robots-tag"]).toBeUndefined()
    expect(h["cache-control"]).toBeUndefined()
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin")
    for (const sub of ["/partner/index.html"]) expect(resolveHeaders(rules, sub)["x-robots-tag"]).toBeUndefined()
    const { groups } = parseRobots(read("public/robots.txt"))
    for (const g of groups) {
      expect(g.allow).toContain("/")
      for (const d of g.disallow) expect("/partner/".startsWith(d), `Disallow: ${d} would block /partner/`).toBe(false)
    }
    const sitemap = renderSitemap(PUBLIC_PAGES.map((p) => ({ path: p.path, lastmod: "2026-10-01T10:00:00+05:30" })))
    expect(sitemap).toContain("<loc>https://veridian-aios.com/partner/</loc>")
    expect(read("public/llms.txt")).toContain("](https://veridian-aios.com/partner/)")
    expect(read("public/llms-full.txt")).toContain("https://veridian-aios.com/partner/")
  })

  test("the private paths stay noindex, no-store, no-referrer; nothing a /partner/ page links to is a new private prefix", () => {
    const rules = parseHeadersFile(read("public/_headers"))
    for (const path of ["/app/", "/act/", "/unsubscribe/", "/copy/", "/p/", "/ai/", "/app/x", "/p/anything"]) {
      const h = resolveHeaders(rules, path)
      expect(h["x-robots-tag"], path).toBe("noindex, nofollow")
      expect(h["cache-control"], path).toBe("no-store")
    }
    // "/partner/..." must never match the /p/ rule: the splat is "/p/*", not "/p*".
    expect(rules.some((r) => r.path === "/p*" || r.path === "/pa*")).toBe(false)
  })

  test("the live smoke script checks /partner/ as a public page", () => {
    expect(read("scripts/live-smoke.mjs")).toContain('"/partner/"')
  })

  // Owner, 2026-10-01: /ai-assistant/ is public and indexable. Its name starts with "/ai", so it must never be mistaken for the private
  // "/ai/" prefix (the AI work link's own address): not by robots.txt, not by _headers, not by the Pages Function that serves /ai/<token>.
  test("/ai-assistant/ is indexable everywhere and is NOT under the private /ai/ prefix", () => {
    const rules = parseHeadersFile(read("public/_headers"))
    for (const path of ["/ai-assistant/", "/ai-assistant/index.html"]) {
      const h = resolveHeaders(rules, path)
      expect(h["x-robots-tag"], path).toBeUndefined()
      expect(h["cache-control"], path).toBeUndefined()
    }
    expect("/ai-assistant/".startsWith("/ai/")).toBe(false)
    const { groups } = parseRobots(read("public/robots.txt"))
    for (const g of groups) {
      expect(g.allow).toContain("/")
      for (const d of g.disallow) expect("/ai-assistant/".startsWith(d), `Disallow: ${d} would block /ai-assistant/`).toBe(false)
    }
    // the rule that fences the private prefix is the slashed "/ai/*", never "/ai*"
    expect(rules.some((r) => r.path === "/ai*" || r.path === "/ai-*")).toBe(false)
    const sitemap = renderSitemap(PUBLIC_PAGES.map((p) => ({ path: p.path, lastmod: "2026-10-01T10:00:00+05:30" })))
    expect(sitemap).toContain("<loc>https://veridian-aios.com/ai-assistant/</loc>")
    expect(read("public/llms.txt")).toContain("](https://veridian-aios.com/ai-assistant/)")
    expect(read("public/llms-full.txt")).toContain("https://veridian-aios.com/ai-assistant/")
    // the Pages Function only answers /ai/<token>: its folder is "ai", not "ai-assistant"
    expect(existsSync(join(root, "functions", "ai-assistant"))).toBe(false)
  })

  test("the live smoke script checks /ai-assistant/ as a public page, indexable, with the free-AI pill on the home page", () => {
    const smoke = read("scripts/live-smoke.mjs")
    expect(smoke).toContain('"/ai-assistant/"')
    expect(smoke).toContain("Get your free AI assistant")
    expect(smoke).toContain("nav-ai")
  })
})

describe("page sources", () => {
  test("public: lang en-IN, canonical = the apex URL, no noindex, no script but JSON-LD", () => {
    for (const pub of PUBLIC_PAGES) {
      const html = read(pub.source)
      expect(html).toContain(`<link rel="canonical" href="${PUBLIC_ORIGIN}${pub.path}" />`)
      expect(html).toContain(`<meta property="og:url" content="${PUBLIC_ORIGIN}${pub.path}" />`)
      expect(html).toMatch(/<html[^>]*\slang="en-IN"/)
      expect(html).toContain(`<link rel="canonical" href="${pageUrl(pub.path)}" />`)
      expect(html).not.toMatch(/<meta\s+name="robots"[^>]*no(index|follow)/i)
      const scripts = html.match(/<script\b[^>]*>/g) ?? []
      for (const s of scripts) expect(s === REF_SCRIPT.open || s.includes('type="application/ld+json"'), `${pub.path}: unexpected ${s}`).toBe(true)
      expect(html).not.toMatch(/https?:\/\/fonts\.(googleapis|gstatic)\.com/)
    }
  })

  test("public: Open Graph image + Twitter card + icon on every page, the image a real 1200x630 PNG", () => {
    const image = `${PUBLIC_ORIGIN}${OG_IMAGE.path}`
    for (const pub of PUBLIC_PAGES) {
      const html = read(pub.source)
      expect(html, pub.source).toContain(`<meta property="og:image" content="${image}" />`)
      expect(html, pub.source).toContain(`<meta property="og:image:width" content="${OG_IMAGE.width}" />`)
      expect(html, pub.source).toContain(`<meta property="og:image:height" content="${OG_IMAGE.height}" />`)
      expect(html, pub.source).toContain('<meta name="twitter:card" content="summary_large_image" />')
      expect(html, pub.source).toContain(`<meta name="twitter:image" content="${image}" />`)
      expect(html, pub.source).toContain('<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48.png" />')
    }
    const png = readFileSync(join(root, "public", OG_IMAGE.path.slice(1)))
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG")
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([OG_IMAGE.width, OG_IMAGE.height])
  })

  test("public: JSON-LD ids and urls are on the apex; non-root pages carry Home > page breadcrumbs; FAQPage only on the landings that show it", () => {
    for (const pub of PUBLIC_PAGES) {
      const block = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(read(pub.source))![1]
      const graph = JSON.parse(block)["@graph"] as Array<Record<string, unknown>>
      const types = graph.map((n) => n["@type"])
      expect(types, pub.path).toEqual(pub.jsonLd.filter((t) => t !== "FAQPage").concat(pub.jsonLd.includes("FAQPage") ? ["FAQPage"] : []))
      for (const n of graph) for (const k of ["@id", "url", "logo"]) if (typeof n[k] === "string") expect(n[k] as string, `${pub.path} ${n["@type"]}.${k}`).toStartWith(`${PUBLIC_ORIGIN}/`)
      const crumbs = graph.find((n) => n["@type"] === "BreadcrumbList") as { itemListElement: Array<{ position: number; item: string }> } | undefined
      if (pub.path === "/") expect(crumbs).toBeUndefined()
      else expect(crumbs!.itemListElement.map((i) => [i.position, i.item])).toEqual([[1, pageUrl("/")], [2, pageUrl(pub.path)]])
    }
  })

  test("public: every page's footer links the fact surfaces", () => {
    for (const pub of PUBLIC_PAGES) {
      const footer = /<footer[\s\S]*<\/footer>/.exec(read(pub.source))![0]
      for (const [href, label] of FOOTER_LINKS) expect(footer, `${pub.path} footer`).toContain(`<a href="${href}">${label}</a>`)
    }
  })

  test("private: noindex + no-referrer meta, no canonical", () => {
    for (const priv of PRIVATE_PAGES) {
      if (priv.source === null) continue
      const html = read(priv.source)
      expect(html).toContain('<meta name="robots" content="noindex, nofollow" />')
      expect(html).toContain('<meta name="referrer" content="no-referrer" />')
      expect(html).not.toContain('rel="canonical"')
      expect(html).toMatch(/<html[^>]*\slang="en-IN"/)
    }
  })

  test("vite.config.ts builds every page from this same list, as an MPA", () => {
    const cfg = read("vite.config.ts")
    expect(cfg).toContain("PUBLIC_PAGES")
    expect(cfg).toContain("PRIVATE_PAGES")
    expect(cfg).toContain('appType: "mpa"')
  })
})
