/// <reference types="bun-types" />
// WO-DPDP-012 §1 + WO-DPDP-014 §2: the public pages must pass Lighthouse's
// accessibility color-contrast audit (WCAG 2 AA, 4.5:1 for normal text),
// and the brand line's text must also clear that bar at >= 12px. A live
// Lighthouse 12 run on 2026-09-22 scored a11y 89-90 on all three pages
// with exactly one failing audit: `.wordmark-sub` (--ink3 on white, 3.2:1)
// and `.card-badge` (--green on --green-bg, 3.4:1). This test parses
// site.css itself -- no browser -- and pins the fixed pairs plus the new
// brand-line/fact-page pairs, so a token change that quietly drops below
// AA fails CI instead of the next Lighthouse run.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const css = readFileSync(join(import.meta.dir, "..", "site.css"), "utf8")

function rootVars(): Record<string, string> {
  const root = /:root\s*\{([^}]*)\}/.exec(css)
  if (!root) throw new Error("site.css has no :root block")
  const body = root[1].replace(/\/\*[\s\S]*?\*\//g, "")
  const vars: Record<string, string> = {}
  for (const m of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim()
  return vars
}

function ruleProp(selector: string, prop: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const block = new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`).exec(css)
  if (!block) throw new Error(`site.css has no rule for ${selector}`)
  const body = block[1].replace(/\/\*[\s\S]*?\*\//g, "")
  const m = new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+);`).exec(body)
  if (!m) throw new Error(`${selector} has no ${prop}`)
  return m[1].trim()
}

function resolve(value: string, vars: Record<string, string>): string {
  const v = /^var\(--([a-z0-9-]+)\)$/.exec(value)
  if (!v) return value
  const resolved = vars[v[1]]
  if (!resolved) throw new Error(`--${v[1]} is not defined in :root`)
  return resolved
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "")
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`not a hex colour: ${hex}`)
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)]
}

/** WCAG 2 relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(fg: string, bg: string): number {
  const l1 = luminance(fg)
  const l2 = luminance(bg)
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

const AA = 4.5

describe("WO-DPDP-012 §1: public-page text meets WCAG AA contrast (Lighthouse color-contrast)", () => {
  const vars = rootVars()

  test("the contrast function agrees with the WCAG reference (black on white = 21:1, white on white = 1:1)", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1)
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1)
  })

  test(".wordmark-sub (the 8px 'DPDP' under the wordmark) on the white nav/chooser card is >= 4.5:1", () => {
    const fg = resolve(ruleProp(".wordmark-sub", "color"), vars)
    expect(contrastRatio(fg, "#ffffff")).toBeGreaterThanOrEqual(AA)
    // and on the page background too, in case the card ever goes transparent
    expect(contrastRatio(fg, vars.bg)).toBeGreaterThanOrEqual(AA)
  })

  test(".card-badge text on its own badge background is >= 4.5:1", () => {
    const fg = resolve(ruleProp(".card-badge", "color"), vars)
    const bg = resolve(ruleProp(".card-badge", "background"), vars)
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA)
  })

  test("the tokens Lighthouse flagged stay documented as NOT AA on their old backgrounds (so nobody 'restores' them by accident)", () => {
    // If either of these starts passing, the token itself changed -- fine, but
    // then the two rules above no longer need their own colours; revisit.
    expect(contrastRatio(vars.ink3, "#ffffff")).toBeLessThan(AA)
    expect(contrastRatio(vars.green, vars["green-bg"])).toBeLessThan(AA)
  })
})

describe("WO-DPDP-014 §2: the brand line meets WCAG AA contrast and the 12px floor", () => {
  const vars = rootVars()

  test("the contrast function agrees with the WCAG reference (black on white = 21:1, white on white = 1:1)", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1)
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1)
  })

  test(".brand-line: white text on the --ink background is >= 4.5:1, at >= 12px, in normal flow, ~28px tall", () => {
    const fg = resolve(ruleProp(".brand-line", "color"), vars)
    const bg = resolve(ruleProp(".brand-line", "background"), vars)
    expect(bg).toBe(vars.ink)
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA)
    expect(parseFloat(ruleProp(".brand-line", "font-size"))).toBeGreaterThanOrEqual(12)
    expect(ruleProp(".brand-line", "min-height")).toBe("28px")
    expect(() => ruleProp(".brand-line", "position")).toThrow(/has no position/)
  })

  test(".brand-line-share: the --a accent on --ink is >= 4.5:1 (the one small accent, WO-014 §2)", () => {
    const fg = resolve(ruleProp(".brand-line-share", "color"), vars)
    expect(fg).toBe(vars.a)
    expect(contrastRatio(fg, vars.ink)).toBeGreaterThanOrEqual(AA)
  })

  test("--green on --ink would NOT pass AA, which is why the accent is --a and not --green", () => {
    expect(contrastRatio(vars.green, vars.ink)).toBeLessThan(AA)
  })

  test("the fact block and fact pages: --ink2 body text on white and on --bg is >= 4.5:1", () => {
    for (const sel of [".facts-list", ".facts-not", ".facts-for", ".facts-meta"]) {
      const fg = resolve(ruleProp(sel, "color"), vars)
      expect(contrastRatio(fg, "#ffffff"), sel).toBeGreaterThanOrEqual(AA)
      expect(contrastRatio(fg, vars.bg), sel).toBeGreaterThanOrEqual(AA)
    }
  })
})
