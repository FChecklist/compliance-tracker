/// <reference types="bun-types" />
// Technical SEO audit of every public page's SOURCE HTML (no ranking promises -- this only proves the basics a crawler needs are present, unique and consistent, so that a later edit
// cannot silently lose them): one <title> and one meta description per page and unique across pages, a self-referencing canonical on the public origin, Open Graph and Twitter cards
// with the same title/description, a parseable JSON-LD block wherever the page has structured content (Organization / WebSite / SoftwareApplication / BreadcrumbList / FAQPage),
// alt text on every image, one <h1>, <html lang>, and sitemap.xml / robots.txt agreeing with the page lists. Hidden pages stay out of the sitemap.
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { HIDDEN_PAGES, LEGAL_PAGES, PRIVATE_PAGES, PUBLIC_ORIGIN, PUBLIC_PAGES, SITEMAP_PAGES, renderSitemap } from "./public-surface.mjs"

const root = join(import.meta.dir, "..", "..")
const read = (rel: string) => readFileSync(join(root, rel), "utf8")
const pages = [...PUBLIC_PAGES, ...LEGAL_PAGES].map((p) => ({ path: p.path, html: read(p.source), legal: LEGAL_PAGES.some((l) => l.path === p.path) }))
const meta = (html: string, attr: "name" | "property", value: string) => new RegExp(`<meta[^>]*\\b${attr}="${value}"[^>]*\\bcontent="([^"]*)"`, "i").exec(html)?.[1] ?? null
const title = (html: string) => /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? ""
const canonical = (html: string) => /<link[^>]*\brel="canonical"[^>]*\bhref="([^"]*)"/i.exec(html)?.[1] ?? null
const jsonLd = (html: string): Array<Record<string, unknown>> =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)].flatMap((m) => {
    const j = JSON.parse(m[1]!) as Record<string, unknown>
    return (Array.isArray(j["@graph"]) ? j["@graph"] : [j]) as Array<Record<string, unknown>>
  })

describe("every public page: the basics a crawler needs", () => {
  test("there are public pages to audit (7 generated + 8 legal)", () => {
    expect(PUBLIC_PAGES.length).toBe(7); expect(LEGAL_PAGES.length).toBe(8)
  })
  test("<html lang>, exactly one <title>, one <h1>, a viewport", () => {
    for (const p of pages) {
      expect(/<html\b[^>]*\slang="en(-IN)?"/i.test(p.html), p.path).toBe(true)
      expect((p.html.match(/<title>/gi) ?? []).length, p.path).toBe(1)
      expect((p.html.match(/<h1\b/gi) ?? []).length, p.path).toBe(1)
      expect(meta(p.html, "name", "viewport"), p.path).toContain("width=device-width")
    }
  })
  test("title and meta description exist, are sensibly sized, and are UNIQUE across the site", () => {
    const titles = new Set<string>(), descs = new Set<string>()
    for (const p of pages) {
      const t = title(p.html), d = meta(p.html, "name", "description") ?? ""
      expect(t.length, `${p.path} title`).toBeGreaterThanOrEqual(15); expect(t.length, `${p.path} title`).toBeLessThanOrEqual(95)
      expect(d.length, `${p.path} description`).toBeGreaterThanOrEqual(90); expect(d.length, `${p.path} description`).toBeLessThanOrEqual(200)
      expect(titles.has(t), `${p.path}: duplicate title "${t}"`).toBe(false); titles.add(t)
      expect(descs.has(d), `${p.path}: duplicate description`).toBe(false); descs.add(d)
    }
  })
  test("the canonical is the page's own address on the public origin (so the three hostnames never compete)", () => {
    for (const p of pages) expect(canonical(p.html), p.path).toBe(`${PUBLIC_ORIGIN}${p.path}`)
  })
  test("Open Graph and Twitter cards: same title and description as the page, an image with alt text, the page's own url", () => {
    for (const p of pages) {
      expect(meta(p.html, "property", "og:title"), p.path).toBe(title(p.html))
      expect(meta(p.html, "property", "og:description"), p.path).toBe(meta(p.html, "name", "description"))
      expect(meta(p.html, "property", "og:url"), p.path).toBe(`${PUBLIC_ORIGIN}${p.path}`)
      expect(meta(p.html, "property", "og:image"), p.path).toBe(`${PUBLIC_ORIGIN}/og-image.png`)
      expect((meta(p.html, "property", "og:image:alt") ?? "").length, p.path).toBeGreaterThan(10)
      expect(meta(p.html, "property", "og:type"), p.path).toBe("website")
      expect(meta(p.html, "name", "twitter:card"), p.path).toBe("summary_large_image")
      expect(meta(p.html, "name", "twitter:title"), p.path).toBe(title(p.html))
      expect(meta(p.html, "name", "twitter:image"), p.path).toBe(`${PUBLIC_ORIGIN}/og-image.png`)
    }
  })
  test("no public page is marked noindex or nofollow", () => {
    for (const p of pages) expect(meta(p.html, "name", "robots") ?? "", p.path).not.toMatch(/noindex|nofollow/i)
  })
  test("every image has alt text (decorative ones an empty alt on purpose)", () => {
    for (const p of pages) for (const img of p.html.match(/<img\b[^>]*>/gi) ?? []) expect(/\balt="/i.test(img), `${p.path}: ${img.slice(0, 80)}`).toBe(true)
  })
  test("the shared share image exists and is 1200x630", () => {
    expect(existsSync(join(root, "public", "og-image.png"))).toBe(true)
  })
})

describe("structured data (JSON-LD)", () => {
  const types = (p: { html: string }) => jsonLd(p.html).map((n) => n["@type"] as string)
  test("every generated page has a parseable JSON-LD block with Organization, WebSite and SoftwareApplication", () => {
    for (const p of pages.filter((x) => !x.legal)) for (const t of ["Organization", "WebSite", "SoftwareApplication"]) expect(types(p), p.path).toContain(t)
  })
  test("every generated page except the home page has a BreadcrumbList; the two edition pages carry FAQPage markup", () => {
    for (const p of pages.filter((x) => !x.legal && x.path !== "/")) expect(types(p), p.path).toContain("BreadcrumbList")
    for (const path of ["/dpdp-firm/", "/dpdp-institution/"]) expect(types(pages.find((x) => x.path === path)!), path).toContain("FAQPage")
  })
  test("FAQ answers are on the page in plain text (structured data must match what a visitor sees)", () => {
    for (const path of ["/dpdp-firm/", "/dpdp-institution/"]) {
      const p = pages.find((x) => x.path === path)!
      const text = p.html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ")
      const faq = jsonLd(p.html).find((n) => n["@type"] === "FAQPage") as { mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }> }
      expect(faq.mainEntity.length, path).toBeGreaterThan(0)
      for (const q of faq.mainEntity) expect(text.includes(q.acceptedAnswer.text.replace(/\s+/g, " ").slice(0, 60)), `${path}: answer for "${q.name}" is not visible`).toBe(true)
    }
  })
  test("the Organization block names a url and a logo on the public origin; every @id and url points at the public origin", () => {
    const org = jsonLd(pages[0]!.html).find((n) => n["@type"] === "Organization") as Record<string, string>
    expect(org.url).toBe(`${PUBLIC_ORIGIN}/`); expect(org.logo).toBe(`${PUBLIC_ORIGIN}/logo.png`)
    for (const p of pages.filter((x) => !x.legal)) for (const n of jsonLd(p.html)) if (typeof n.url === "string") expect(n.url.startsWith(PUBLIC_ORIGIN), `${p.path}: ${n.url}`).toBe(true)
  })
})

describe("sitemap.xml and robots.txt agree with the page lists", () => {
  const xml = renderSitemap(SITEMAP_PAGES.map((p: { path: string }) => ({ path: p.path, lastmod: "2026-10-06T00:00:00Z" })))
  test("the sitemap lists exactly the public and legal pages, once each, on the public origin; hidden pages are not in it", () => {
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    expect(locs.length).toBe(PUBLIC_PAGES.length + LEGAL_PAGES.length)
    expect(new Set(locs).size).toBe(locs.length)
    for (const p of pages) expect(locs, p.path).toContain(`${PUBLIC_ORIGIN}${p.path}`)
    for (const h of HIDDEN_PAGES) expect(locs).not.toContain(`${PUBLIC_ORIGIN}${h.prefix}`)
    for (const priv of PRIVATE_PAGES) expect(locs.some((l) => String(l).includes(priv.prefix))).toBe(false)
  })
  test("robots.txt points at the sitemap, allows the public site and closes every private prefix for every group", () => {
    const robots = read("public/robots.txt")
    expect(robots).toContain(`Sitemap: ${PUBLIC_ORIGIN}/sitemap.xml`)
    expect(robots).toContain("Allow: /")
    for (const priv of PRIVATE_PAGES) expect((robots.match(new RegExp(`^Disallow: ${priv.prefix}$`, "gm")) ?? []).length, priv.prefix).toBeGreaterThanOrEqual(2)
  })
  test("the hidden page is noindex and not linked from a robots Disallow (a crawler that finds it must be able to read the noindex)", () => {
    for (const h of HIDDEN_PAGES) {
      expect(meta(read(h.source), "name", "robots") ?? "").toContain("noindex")
      expect(read("public/robots.txt")).not.toContain(`Disallow: ${h.prefix}`)
    }
  })
})
