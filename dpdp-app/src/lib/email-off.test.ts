/// <reference types="bun-types" />
// Cloudflare Pages ("Email Address Obfuscation", a Scrape Shield default) rewrites every visible e-mail address in an HTML response to the words
// "[email protected]" and a link to /cdn-cgi/l/email-protection, decoded only by a script. A reader that runs no JavaScript -- a crawler, an AI
// fetcher, a locked-down browser -- is then told nothing about how to reach us; on /for-ai/, the page written for AIs, that is the one job the page
// has. Text between <!--email_off--> and <!--/email_off--> is left alone (Cloudflare drops the comments from what it serves). Found live on
// 2026-09-30 on /about/, /for-ai/, /dpdp-firm/, /dpdp-institution/ and /proof/; a string search for "[email protected]" in our own files can never
// find it, because the rewrite happens at the edge. So the rule is pinned here, against the SOURCE of every page and the /original/ page:
// an address in visible markup must sit inside an email_off region. (An address inside <script> -- the JSON-LD -- is not touched by Cloudflare.)
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { HIDDEN_PAGES, PRIVATE_PAGES, PUBLIC_PAGES } from "./public-surface.mjs"

const APP = resolve(import.meta.dir, "../..")
const read = (rel: string) => readFileSync(join(APP, rel), "utf8")

const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g

/** The addresses Cloudflare would rewrite: those left in the markup once scripts, styles and email_off regions are removed. */
export function exposedAddresses(html: string): string[] {
  const visible = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--email_off-->[\s\S]*?<!--\/email_off-->/g, " ")
  return visible.match(ADDRESS) ?? []
}

describe("no visible e-mail address is left for Cloudflare to hide", () => {
  test("the helper sees what Cloudflare would rewrite, and nothing it leaves alone", () => {
    expect(exposedAddresses(`<p>Write to <b>dpdp@veridian-aios.com</b></p>`)).toEqual(["dpdp@veridian-aios.com"])
    expect(exposedAddresses(`<a href="mailto:dpdp@veridian-aios.com?subject=x">Mail</a>`)).toEqual(["dpdp@veridian-aios.com"])
    expect(exposedAddresses(`<p><!--email_off-->Write to <b>dpdp@veridian-aios.com</b><!--/email_off--></p>`)).toEqual([])
    expect(exposedAddresses(`<script type="application/ld+json">{"email":"dpdp@veridian-aios.com"}</script>`)).toEqual([])
    // one protected line does not protect the next one
    expect(exposedAddresses(`<!--email_off-->dpdp@a.in<!--/email_off--> and dpdp@b.in`)).toEqual(["dpdp@b.in"])
  })

  test("every public and hidden page keeps its addresses inside email_off (or inside a script)", () => {
    const pages = [...PUBLIC_PAGES, ...HIDDEN_PAGES]
    expect(pages.length).toBeGreaterThan(4)
    for (const p of pages) expect(exposedAddresses(read(p.source)), p.source).toEqual([])
  })

  test("the private app shell pages carry no address either", () => {
    for (const p of PRIVATE_PAGES) {
      if (!p.source || !existsSync(join(APP, p.source))) continue // /ai/ has no HTML of its own: a function serves it (and wraps its own addresses)
      expect(exposedAddresses(read(p.source)), p.source).toEqual([])
    }
  })

  test("the frozen /original/ page (public/original/index.html, not a registered page) keeps its addresses inside email_off", () => {
    const rel = "public/original/index.html"
    if (!existsSync(join(APP, rel))) return // present once the /original/ page is on this branch
    const html = read(rel)
    expect(html).toContain("<!--email_off-->")
    expect(exposedAddresses(html), rel).toEqual([])
  })

  test("the generated pages really do carry the marker (guards the generator, not just today's files)", () => {
    for (const rel of ["about/index.html", "for-ai/index.html", "dpdp-firm/index.html", "dpdp-institution/index.html"]) {
      const html = read(rel)
      expect(html, rel).toContain("<!--email_off-->Write to")
      expect(html, rel).toContain("<!--email_off-->Grievance Officer:")
    }
  })
})
