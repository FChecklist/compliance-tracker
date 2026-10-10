/// <reference types="bun-types" />
// 2026-10-02: the home page's three colour themes (violet = the default, studio blue, emerald), switched by three
// dots at the top centre. Pinned here: every text pair meets WCAG AA (4.5:1) in ALL THREE themes (read straight from
// src/site.css + src/home.css, no browser), public/theme.js behaves (applies the saved theme before first paint, falls
// back to violet when storage is blocked or holds rubbish, saves a choice, marks aria-pressed, no cookie, no network),
// and the page carries three real, keyboard-focusable buttons with names.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..", "..")
const read = (rel: string) => readFileSync(join(root, rel), "utf8")
const siteCss = read("src/site.css")
const homeCss = read("src/home.css")

function vars(css: string, selector: RegExp): Record<string, string> {
  const m = selector.exec(css)
  if (!m) throw new Error(`no block for ${selector}`)
  const out: Record<string, string> = {}
  for (const v of m[1]!.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) out[v[1]!] = v[2]!.trim()
  return out
}
const base = { ...vars(siteCss, /:root\s*\{([^}]*)\}/), ...vars(homeCss, /:root\s*\{([^}]*)\}/) }
const THEMES: Record<string, Record<string, string>> = {
  violet: base,
  studio: { ...base, ...vars(homeCss, /html\[data-theme="studio"\]\s*\{([^}]*)\}/) },
  emerald: { ...base, ...vars(homeCss, /html\[data-theme="emerald"\]\s*\{([^}]*)\}/) },
}

function hex(v: string): [number, number, number] {
  const h = v.replace("#", "")
  const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h
  if (!/^[0-9a-f]{6}$/i.test(f)) throw new Error(`not a hex colour: ${v}`)
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)]
}
function lum(v: string): number {
  const [r, g, b] = hex(v).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)]
  return (hi + 0.05) / (lo + 0.05)
}
const AA = 4.5

describe("three themes, each meeting WCAG AA for every text pair on the home page", () => {
  test("the contrast function agrees with the WCAG reference", () => {
    expect(ratio("#000000", "#ffffff")).toBeCloseTo(21, 1)
  })

  test("there are exactly three themes, violet is the default (no html[data-theme] needed), and the others override the shared tokens", () => {
    expect(Object.keys(THEMES)).toEqual(["violet", "studio", "emerald"])
    expect(THEMES.violet!.violet).toBe("#6d28d9")
    expect(homeCss.match(/html\[data-theme="[a-z]+"\]\s*\{/g)).toEqual(['html[data-theme="studio"] {', 'html[data-theme="emerald"] {'])
    for (const t of ["studio", "emerald"]) for (const token of ["bg", "ink", "ink2", "line", "violet", "pink", "dark", "dark-muted", "grad", "hero1", "hero2", "glow", "soft"]) expect(THEMES[t]![token], `${t} --${token}`).not.toBe(THEMES.violet![token])
  })

  for (const [name, t] of Object.entries(THEMES)) {
    describe(name, () => {
      const hexOf = (k: string) => t[k]!
      const pairs: Array<[string, string, string]> = [
        ["body text --ink on --bg", hexOf("ink"), hexOf("bg")],
        ["muted text --ink2 on --bg", hexOf("ink2"), hexOf("bg")],
        ["muted text --ink2 on white cards", hexOf("ink2"), "#ffffff"],
        ["text --ink on white cards", hexOf("ink"), "#ffffff"],
        ["muted text --ink2 on --soft (steps, strip, sample card)", hexOf("ink2"), hexOf("soft")],
        ["kicker / links --violet on --bg", hexOf("violet"), hexOf("bg")],
        ["--violet on white (the nav pill, the chat Confirm)", hexOf("violet"), "#ffffff"],
        ["--violet on --soft (sample seal number)", hexOf("violet"), hexOf("soft")],
        ["white on --violet (button, numbered dots)", "#ffffff", hexOf("violet")],
        ["white on the button gradient's far end --pink", "#ffffff", hexOf("pink")],
        ["brand line: white on --ink", "#ffffff", hexOf("ink")],
        ["brand line share ask: --a accent on --ink", t.a!, hexOf("ink")],
        ["hero lead --hero-text on --hero1", t["hero-text"]!, hexOf("hero1")],
        ["hero lead --hero-text on --hero2", t["hero-text"]!, hexOf("hero2")],
        ["hero white text on --hero2", "#ffffff", hexOf("hero2")],
        ["hero small caps #ffd9a8 on --hero1", "#ffd9a8", hexOf("hero1")],
        ["hero small caps #ffd9a8 on --hero2", "#ffd9a8", hexOf("hero2")],
        ["hero eyebrow --a on --hero1", t.a!, hexOf("hero1")],
        ["hero eyebrow --a on --hero2", t.a!, hexOf("hero2")],
        ["footer --dark-muted on --dark", hexOf("dark-muted"), hexOf("dark")],
        ["footer company line --dark-muted on --dark", hexOf("dark-muted"), hexOf("dark")],
        ["float badge #1b1000 on --a", "#1b1000", t.a!],
      ]
      for (const [label, fg, bg] of pairs) {
        test(`${label} >= 4.5:1`, () => {
          expect(ratio(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(AA)
        })
      }
      test("the button gradient's two ends are the theme's own --violet and --pink", () => {
        const g = hexOf("grad")
        expect(g.toLowerCase()).toContain(hexOf("violet").toLowerCase().replace("#", ""))
        expect(g.toLowerCase()).toContain(hexOf("pink").toLowerCase().replace("#", ""))
      })
    })
  }
})

class El {
  attrs: Record<string, string> = {}
  children: El[] = []
  className = ""
  type = ""
  listeners: Record<string, Array<() => void>> = {}
  setAttribute(k: string, v: string) { this.attrs[k] = String(v) }
  getAttribute(k: string) { return this.attrs[k] ?? null }
  addEventListener(type: string, cb: () => void) { (this.listeners[type] ||= []).push(cb) }
  appendChild(c: El) { this.children.push(c); return c }
  insertBefore(c: El) { this.children.unshift(c); return c }
  click() { (this.listeners.click ?? []).forEach((cb) => cb()) }
}

describe("public/theme.js", () => {
  const source = read("public/theme.js")

  function run(opts: { stored?: string | null; storageThrows?: boolean; readyState?: string } = {}) {
    const html = new El()
    const host = new El()
    const written: Array<[string, string]> = []
    const doc = {
      readyState: opts.readyState ?? "complete",
      documentElement: html,
      body: host,
      createElement: () => new El(),
      querySelector: () => host,
      addEventListener: () => {},
    }
    const storage = {
      getItem: () => { if (opts.storageThrows) throw new Error("blocked"); return opts.stored ?? null },
      setItem: (k: string, v: string) => { if (opts.storageThrows) throw new Error("blocked"); written.push([k, v]) },
    }
    new Function("document", "window", source)(doc, { localStorage: storage })
    const group = host.children[0]!
    return { html, written, group, buttons: group.children }
  }

  test("applies the saved theme straight away, before any paint (it runs in <head>, synchronously)", () => {
    expect(run({ stored: "emerald" }).html.getAttribute("data-theme")).toBe("emerald")
    expect(run({ stored: "studio" }).html.getAttribute("data-theme")).toBe("studio")
  })

  test("nothing saved, rubbish saved, or storage blocked: violet, and no error", () => {
    expect(run().html.getAttribute("data-theme")).toBe("violet")
    expect(run({ stored: "<script>" }).html.getAttribute("data-theme")).toBe("violet")
    expect(run({ storageThrows: true }).html.getAttribute("data-theme")).toBe("violet")
  })

  test("it builds a labelled group of exactly three real buttons, named, keyboard-focusable (button elements), aria-pressed on the current one", () => {
    const r = run({ stored: "studio" })
    expect(r.group.className).toBe("tdots")
    expect(r.group.getAttribute("role")).toBe("group")
    expect(r.group.getAttribute("aria-label")).toBe("Colour theme")
    expect(r.buttons.map((b) => b.getAttribute("data-theme"))).toEqual(["violet", "studio", "emerald"])
    expect(r.buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Violet theme", "Studio blue theme", "Emerald theme"])
    expect(r.buttons.map((b) => b.getAttribute("type"))).toEqual(["button", "button", "button"])
    expect(r.buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"])
  })

  test("a click sets the theme, saves it under one key, and flips aria-pressed on exactly that dot", () => {
    const r = run()
    expect(r.buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"])
    r.buttons[1]!.click()
    expect(r.html.getAttribute("data-theme")).toBe("studio")
    expect(r.written).toEqual([["veridian-theme", "studio"]])
    expect(r.buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"])
    r.buttons[2]!.click()
    expect(r.buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "true"])
  })

  test("a click still works when storage is blocked (it lasts until the page is closed)", () => {
    const r = run({ storageThrows: true })
    r.buttons[2]!.click()
    expect(r.html.getAttribute("data-theme")).toBe("emerald")
  })

  test("the three dot colours match the themes' own --violet tokens", () => {
    const r = run()
    expect(r.buttons.map((b) => /--dot: (#[0-9a-f]{6})/.exec(b.getAttribute("style")!)![1])).toEqual([THEMES.violet!.violet, THEMES.studio!.violet, THEMES.emerald!.violet])
  })

  test("no cookie, no network, no third party: localStorage only", () => {
    for (const bad of ["document.cookie", "fetch(", "XMLHttpRequest", "sendBeacon", "http://", "https://", "sessionStorage", "indexedDB"]) expect(source, bad).not.toContain(bad)
    expect(source).toContain("localStorage")
    expect((source.match(/localStorage/g) ?? []).length).toBeLessThanOrEqual(3)
  })
})

describe("the dots in the page", () => {
  const html = read("index.html")

  test("theme.js is loaded by the home page only, synchronously in the head, before the stylesheet; the dots are built by it, not written into the HTML", () => {
    const head = html.slice(0, html.indexOf("</head>"))
    expect(head.indexOf('<script src="/theme.js"></script>')).toBeGreaterThan(-1)
    expect(head.indexOf('<script src="/theme.js"></script>')).toBeLessThan(head.indexOf('<link rel="stylesheet"'))
    expect(html).not.toContain("tdots")
    expect(html).toContain('<div class="hm-page">')
    for (const rel of ["about/index.html", "dpdp-firm/index.html", "dpdp-institution/index.html", "partner/index.html", "ai-assistant/index.html", "public/privacy/index.html"]) expect(read(rel), rel).not.toContain("theme.js")
  })

  test("the dots sit at the top centre, clear of the nav on phones (the nav drops below them), and are 28px hit targets", () => {
    expect(homeCss).toMatch(/\.tdots\s*\{[^}]*left:\s*50%/)
    expect(homeCss).toMatch(/\.tdots button\s*\{[^}]*width:\s*28px;[^}]*height:\s*28px/)
    // under 1000px the nav row starts 40px down, so the dot bar above it (8px + 32px) never overlaps it
    expect(homeCss).toMatch(/\.hm \.nav\s*\{[^}]*padding:\s*40px 20px 0/)
  })
})
