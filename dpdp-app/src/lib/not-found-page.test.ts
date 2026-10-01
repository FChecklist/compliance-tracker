/// <reference types="bun-types" />
// Unknown public URLs must be a real HTTP 404, not the home page with a 200.
// Cloudflare Pages falls back to index.html (SPA mode) for any path it cannot
// find UNLESS the build ships a root 404.html -- so the file's presence is the
// switch, and a catch-all rule in _redirects/_headers would defeat it.
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { PRIVATE_PAGES, PUBLIC_PAGES } from "./public-surface.mjs"
import { parseRedirects } from "./redirects.test"

const APP = resolve(import.meta.dir, "../..")
const file = join(APP, "public", "404.html")

describe("404 page", () => {
  test("public/404.html exists (its presence switches Pages out of SPA fallback)", () => {
    expect(existsSync(file)).toBe(true)
  })
  const html = existsSync(file) ? readFileSync(file, "utf8") : ""
  test("noindex, no canonical, no script, English-India", () => {
    expect(html).toMatch(/<html\b[^>]*\slang="en-IN"/)
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">')
    expect(html).not.toMatch(/rel="canonical"/)
    expect(html).not.toMatch(/<script\b/i)
  })
  test("says plainly that the page does not exist and links home, firm, institution, sign in", () => {
    expect(html).toContain("This page does not exist")
    for (const href of ["/", "/dpdp-firm/", "/dpdp-institution/", "/app/", "/contact/"]) expect(html).toContain(`href="${href}"`)
  })
  test("every internal link on it is a real page or file", () => {
    const real = new Set([...PUBLIC_PAGES.map((p) => p.path), ...PRIVATE_PAGES.map((p) => p.prefix), "/contact/"])
    for (const m of html.matchAll(/href="(\/[^"]*)"/g)) {
      if (m[1] === "/legal/legal.css" || m[1] === "/favicon-48.png") expect(existsSync(join(APP, "public", m[1].slice(1)))).toBe(true)
      else expect(real.has(m[1])).toBe(true)
    }
  })
  test("no catch-all in _redirects (a /* rule would hide the 404)", () => {
    const rules = parseRedirects(readFileSync(join(APP, "public", "_redirects"), "utf8"))
    for (const r of rules) expect(r.from.includes("*")).toBe(false)
  })
})
