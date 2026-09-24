/// <reference types="bun-types" />
// WO-DPDP-013 v2 §2.4, the addresses: /dpdp-institutions -> 301 ->
// /dpdp-institution (singular, owner decision 18 Sep) and /home -> 301 -> /.
// public/_redirects is Cloudflare Pages' redirect file ("<source>
// <destination> <status>", one rule per line, # comments). This parses the
// committed file and pins both rules, with and without the trailing slash,
// and that no rule ever points at a private or hidden path.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { HIDDEN_PAGES, PRIVATE_PAGES, PUBLIC_PAGES } from "./public-surface.mjs"

const APP = resolve(import.meta.dir, "../..")

export interface Redirect {
  from: string
  to: string
  status: number
}

export function parseRedirects(text: string): Redirect[] {
  const out: Redirect[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim()
    if (!line) continue
    const parts = line.split(/\s+/)
    if (parts.length < 2) throw new Error(`_redirects: bad line "${raw}"`)
    const status = parts[2] ? Number(parts[2]) : 302
    if (!Number.isInteger(status)) throw new Error(`_redirects: bad status in "${raw}"`)
    out.push({ from: parts[0], to: parts[1], status })
  }
  return out
}

describe("public/_redirects (WO-013 §2.4)", () => {
  const rules = parseRedirects(readFileSync(join(APP, "public", "_redirects"), "utf8"))
  const rule = (from: string) => rules.find((r) => r.from === from)

  test("/dpdp-institutions and /dpdp-institutions/ -> 301 -> /dpdp-institution/", () => {
    expect(rule("/dpdp-institutions")).toEqual({ from: "/dpdp-institutions", to: "/dpdp-institution/", status: 301 })
    expect(rule("/dpdp-institutions/")).toEqual({ from: "/dpdp-institutions/", to: "/dpdp-institution/", status: 301 })
  })

  test("/home and /home/ -> 301 -> /", () => {
    expect(rule("/home")).toEqual({ from: "/home", to: "/", status: 301 })
    expect(rule("/home/")).toEqual({ from: "/home/", to: "/", status: 301 })
  })

  test("exactly these four rules, every one permanent, every destination a public page", () => {
    expect(rules).toHaveLength(4)
    for (const r of rules) {
      expect(r.status).toBe(301)
      expect(PUBLIC_PAGES.some((p) => p.path === r.to), `${r.to} is not a public page`).toBe(true)
      for (const priv of PRIVATE_PAGES) expect(r.to.startsWith(priv.prefix)).toBe(false)
      for (const h of HIDDEN_PAGES) expect(r.to.startsWith(h.prefix)).toBe(false)
    }
  })

  test("the parser reads the documented format and rejects a malformed line", () => {
    expect(parseRedirects("# c\n/a /b 301\n/c /d\n")).toEqual([
      { from: "/a", to: "/b", status: 301 },
      { from: "/c", to: "/d", status: 302 },
    ])
    expect(() => parseRedirects("/only-source")).toThrow(/bad line/)
  })
})
