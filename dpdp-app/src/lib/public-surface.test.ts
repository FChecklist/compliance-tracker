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
  FOOTER_LINKS,
  OG_IMAGE,
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
    // Only the edition landings exist on both hosts. /about/ and /for-ai/
    // (WO-DPDP-013 v2) are generated on this static host only.
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

  test("no public page source, llms file, facts.json or for-ai.md names the app host", () => {
    for (const host of [new URL(SITE_ORIGIN).host, new URL(LEGACY_APP_ORIGIN).host]) {
      for (const rel of [...PUBLIC_PAGES.map((p) => p.source), "public/llms.txt", "public/llms-full.txt", "public/facts.json", "public/for-ai.md", "public/robots.txt"]) {
        expect(read(rel), `${rel} names ${host}`).not.toContain(host)
      }
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
    test(`${file} lists every public page, links no private page, and says nobody has confirmed reading it`, () => {
      const text = read(file)
      for (const pub of PUBLIC_PAGES) expect(text).toContain(pageUrl(pub.path))
      for (const priv of PRIVATE_PAGES) expect(text).not.toContain(pageUrl(priv.prefix))
      expect(text).toMatch(/no major search engine has confirmed/i)
    })
  }
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
      for (const s of scripts) expect(s).toContain('type="application/ld+json"')
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
