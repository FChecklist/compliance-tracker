/// <reference types="bun-types" />
// The organisation-direct switch (owner order, 24 Nov 2026): ONE constant, default false, hides the path without deleting any of it.
// Both values are exercised: the pure helpers, the sign-up screen, the redirects file and the home page.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { OpenOrganisation } from "../components/Screens"
import { ORG_DIRECT_ENABLED, ORG_DIRECT_REDIRECTS, editionAllowed, editionsOffered, sendToPartnerDoor } from "./org-direct.mjs"

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

  test("App.tsx refuses a hidden edition even if the screen were bypassed", () => {
    const app = read("src/App.tsx")
    expect(app).toContain("editionAllowed(product)")
  })
})
