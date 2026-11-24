/// <reference types="bun-types" />
// The organisation-direct switch (owner order, 24 Nov 2026): ONE constant, default false, hides the path without deleting any of it.
// Both values are exercised: the pure helpers, the sign-up screen, the redirects file and the home page.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { OpenOrganisation } from "../components/Screens"
import { PUBLIC_PAGES, SITEMAP_PAGES, listedPages } from "./public-surface.mjs"
import { PUBLIC_PATHS } from "../../scripts/check-crawler-access.mjs"
import { ORG_DIRECT_ENABLED, ORG_DIRECT_REDIRECTS, editionAllowed, institutionsPluralTarget, editionsOffered, sendToPartnerDoor } from "./org-direct.mjs"

const APP = resolve(import.meta.dir, "../..")
const read = (rel: string) => readFileSync(join(APP, rel), "utf8")
const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(OpenOrganisation, { email: "a@b.test", initialEdition: null, busy: false, error: null, onCreate: () => {}, onSignOut: () => {}, onOpenPartner: () => {}, ...props }))

describe("ORG_DIRECT_ENABLED", () => {
  test("is a boolean and ships OFF", () => {
    expect(ORG_DIRECT_ENABLED).toBe(false)
  })

  test("off: only a Firm may be opened, and an organisation link is sent to the Partner door", () => {
    expect(editionsOffered(false)).toEqual(["firm"])
    expect(editionAllowed("firm", false)).toBe(true)
    expect(editionAllowed("institution", false)).toBe(false)
    expect(editionAllowed(null, false)).toBe(false)
    expect(sendToPartnerDoor("institution", false)).toBe(true)
    expect(sendToPartnerDoor("firm", false)).toBe(false)
    expect(sendToPartnerDoor(null, false)).toBe(false)
  })

  test("on: everything is back exactly as it was", () => {
    expect(editionsOffered(true)).toEqual(["firm", "institution"])
    expect(editionAllowed("institution", true)).toBe(true)
    expect(sendToPartnerDoor("institution", true)).toBe(false)
  })
})

describe("the sign-up screen under both switch values", () => {
  test("off: no organisation door, no 'I am an organisation' link; a visitor with no edition lands on the Firm form", () => {
    const out = render({ orgDirect: false })
    expect(out).not.toContain("For organisations")
    expect(out).not.toContain("Open my organisation")
    expect(out).not.toContain("I am an organisation")
    expect(out).toContain("Open my firm account")
    expect(out).not.toContain('data-testid="partner-door"')
  })

  test("off: an organisation link (?edition=institution) shows the Partner door note and the Firm form, never the organisation form", () => {
    const out = render({ orgDirect: false, initialEdition: "institution" })
    expect(out).toContain('data-testid="partner-door"')
    expect(out).toContain("Become a Partner")
    expect(out).toContain("Open my firm account")
    expect(out).not.toContain("Open my organisation")
  })

  test("on: the two doors are back, and the organisation form opens for an organisation link", () => {
    const chooser = render({ orgDirect: true })
    expect(chooser).toContain("For professionals")
    expect(chooser).toContain("For organisations")
    const form = render({ orgDirect: true, initialEdition: "institution" })
    expect(form).toContain("Open my organisation")
    expect(form).not.toContain('data-testid="partner-door"')
  })
})

describe("nothing is deleted", () => {
  test("the organisation-direct landing page, its sign-up route and the RPC call all still exist", () => {
    expect(read("dpdp-institution/index.html")).toContain('href="/app/?edition=institution"')
    expect(read("src/lib/landing.ts")).toContain('"institution"')
    expect(read("src/lib/api.ts")).toContain("export async function openAccount")
    expect(read("src/components/Screens.tsx")).toContain("Open my organisation")
  })

  test("public/_redirects carries the two org-direct lines exactly when the switch is off", () => {
    const file = read("public/_redirects")
    for (const line of ORG_DIRECT_REDIRECTS) {
      const present = file.split(/\r?\n/).some((l) => l.trim() === line)
      expect(present, line).toBe(!ORG_DIRECT_ENABLED)
    }
  })

  test("the switch and _redirects agree, line by line, in both switch states (a planted wrong state is caught)", () => {
    const has = (file: string, line: string) => file.split(/\r?\n/).some((l) => l.trim() === line)
    const agrees = (file: string, enabled: boolean) => ORG_DIRECT_REDIRECTS.every((line) => has(file, line) === !enabled)
    const withLines = ORG_DIRECT_REDIRECTS.join("\n")
    expect(agrees(withLines, true)).toBe(false)
    expect(agrees(withLines, false)).toBe(true)
    expect(agrees("", true)).toBe(true)
    expect(agrees("", false)).toBe(false)
    expect(agrees(read("public/_redirects"), ORG_DIRECT_ENABLED)).toBe(true)
  })

  test("/dpdp-institutions goes where the switch says", () => {
    expect(institutionsPluralTarget(false)).toBe("/partner/")
    expect(institutionsPluralTarget(true)).toBe("/dpdp-institution/")
  })

  test("the sitemap, llms files and crawler list leave the organisation page out exactly while the switch is off", () => {
    for (const on of [true, false]) expect(listedPages(on).some((p: { path: string }) => p.path === "/dpdp-institution/")).toBe(on)
    const has = (s: string) => s.includes("/dpdp-institution/")
    expect(has(read("public/llms.txt"))).toBe(ORG_DIRECT_ENABLED)
    expect(has(read("public/llms-full.txt"))).toBe(ORG_DIRECT_ENABLED)
    expect(PUBLIC_PATHS.includes("/dpdp-institution/")).toBe(ORG_DIRECT_ENABLED)
    expect(SITEMAP_PAGES.some((p: { path: string }) => p.path === "/dpdp-institution/")).toBe(ORG_DIRECT_ENABLED)
    expect(PUBLIC_PAGES.some((p: { path: string }) => p.path === "/dpdp-institution/")).toBe(true) // the page itself still builds
  })

  test("App.tsx refuses a hidden edition even if the screen were bypassed", () => {
    const app = read("src/App.tsx")
    // the refusal must sit inside openMyOrg, before any account is opened (not just mention the helper somewhere)
    const body = app.slice(app.indexOf("async function openMyOrg("))
    const guard = body.indexOf("if (!editionAllowed(product))")
    const call = body.indexOf("await openAccount(")
    expect(guard).toBeGreaterThan(-1)
    expect(call).toBeGreaterThan(guard)
    expect(body.slice(guard, call)).toContain("return")
  })

  test("the plural /dpdp-institutions lines in _redirects point exactly where institutionsPluralTarget says (a planted wrong target is caught)", () => {
    const pluralLines = (file: string) => file.split(/\r?\n/).map((l) => l.trim().split(/\s+/)).filter((p) => p[0] === "/dpdp-institutions" || p[0] === "/dpdp-institutions/")
    const agrees = (file: string, enabled: boolean) => {
      const lines = pluralLines(file)
      return lines.length === 2 && lines.every((p) => p[1] === institutionsPluralTarget(enabled) && p[2] === "301")
    }
    expect(agrees(read("public/_redirects"), ORG_DIRECT_ENABLED)).toBe(true)
    const planted = read("public/_redirects").replace(/^(\/dpdp-institutions\s+)\S+/m, "$1/wrong/")
    expect(agrees(planted, ORG_DIRECT_ENABLED)).toBe(false)
  })

  test("while the switch is off, no listed page's visible text or llms text links to /dpdp-institution/ (either state is followed)", () => {
    const strip = (h: string) => h.replace(/<!--[\s\S]*?-->/g, " ").replace(/<script[\s\S]*?<\/script>/g, " ")
    const bad: string[] = []
    for (const p of listedPages(ORG_DIRECT_ENABLED)) {
      const rel = p.path === "/" ? "index.html" : `${p.path.slice(1)}index.html`
      if (strip(read(rel)).includes("/dpdp-institution/") !== ORG_DIRECT_ENABLED && p.path !== "/dpdp-institution/") bad.push(rel)
    }
    for (const f of ["public/llms.txt", "public/llms-full.txt"]) if (read(f).includes("/dpdp-institution/") !== ORG_DIRECT_ENABLED) bad.push(f)
    expect(bad).toEqual([])
  })
})

describe("noindex on the organisation page follows the switch", () => {
  test("the tag is present exactly while ORG_DIRECT_ENABLED is false", () => {
    const page = readFileSync(join(APP, "dpdp-institution/index.html"), "utf8")
    expect(page.includes('<meta name="robots" content="noindex" />')).toBe(!ORG_DIRECT_ENABLED)
  })
})
