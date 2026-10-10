/// <reference types="bun-types" />
// WO-DPDP-014 §1: "Never retype the line. A test fails the build if any
// variant spelling appears." This is that test, for the private app and
// the Monday email:
//   (a) the constants are byte-identical to the owner-approved strings
//       (typed here exactly once more, as the check -- code points pinned
//       for the middle dot, the em dash and the plain apostrophe, so a
//       "smart" editor cannot quietly swap one);
//   (b) if the facts file (data/veridian-facts.yaml, WO-013) exists, its
//       brand.full / brand.short / brand.share_ask equal the constants;
//   (c) a source scan of dpdp-app/src and supabase/functions/dpdp-monday-
//       email finds no variant spelling and not the public-procurement
//       phrase WO-014 §1 forbids (which this file therefore never spells
//       out either -- the regexes below are the only place it exists);
//   (d) the share action's source never reads the page address; and
//   (e) the top bar's colours: white on the app's own ink token at 4.5:1
//       or better (WO-014 §2), read from the real CSS files.
import { describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { BRAND_LINE_FULL, BRAND_LINE_SHORT, PUBLIC_SITE, SHARE_ASK } from "./brand"

const APP_ROOT = join(import.meta.dir, "..", "..") // dpdp-app/
const REPO_ROOT = join(APP_ROOT, "..")
const EMAIL_FN = join(REPO_ROOT, "supabase", "functions", "dpdp-monday-email")

describe("WO-DPDP-014 §1 -- the line, byte-exact", () => {
  test("the three constants are the owner-approved strings", () => {
    expect(BRAND_LINE_FULL).toBe("VERIDIAN · VERy INDIAN — Built for India's DPDP Act. For India, by India.")
    expect(BRAND_LINE_SHORT).toBe("VERIDIAN · VERy INDIAN · For India, by India")
    expect(SHARE_ASK).toBe("Know a firm that needs this? Share VERIDIAN")
    expect(PUBLIC_SITE).toBe("https://veridian-aios.com/")
  })

  test("the punctuation is the exact code point, not a look-alike", () => {
    // U+00B7 MIDDLE DOT between VERIDIAN and VERy INDIAN, in both lines.
    expect(BRAND_LINE_FULL.codePointAt("VERIDIAN ".length)).toBe(0x00b7)
    expect(BRAND_LINE_SHORT.codePointAt("VERIDIAN ".length)).toBe(0x00b7)
    // U+2014 EM DASH in the full line; U+0027 APOSTROPHE in "India's".
    expect(BRAND_LINE_FULL.codePointAt(BRAND_LINE_FULL.indexOf("—"))).toBe(0x2014)
    expect(BRAND_LINE_FULL.codePointAt(BRAND_LINE_FULL.indexOf("India's") + "India".length)).toBe(0x27)
    expect(BRAND_LINE_FULL).not.toMatch(/[‘’“”–]/) // no curly quotes, no en dash
    expect(BRAND_LINE_SHORT).not.toMatch(/[‘’“”–—]/)
  })

  test("VERy INDIAN is spelled exactly so, in both lines", () => {
    for (const line of [BRAND_LINE_FULL, BRAND_LINE_SHORT]) {
      expect(line).toContain("VERy INDIAN")
      expect(line.split("VERy INDIAN")).toHaveLength(2)
    }
  })
})

// A deliberately tiny reader for the facts file's `brand:` block -- the
// dpdp-app toolchain has no YAML package (and must not gain one for this),
// and the block is three flat scalar lines under one key. Anything more
// exotic than `key: value` / `key: "value"` / `key: 'value'` is a test
// failure, not a silent skip.
function readBrandBlock(yaml: string): Record<string, string> {
  const lines = yaml.split(/\r?\n/)
  const start = lines.findIndex((l) => /^brand:\s*(#.*)?$/.test(l))
  if (start === -1) throw new Error("veridian-facts.yaml has no top-level `brand:` block")
  const out: Record<string, string> = {}
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (/^\S/.test(line)) break // next top-level key
    if (!line.trim() || /^\s*#/.test(line)) continue
    const m = /^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line)
    if (!m) throw new Error(`unreadable line in brand block: ${JSON.stringify(line)}`)
    let value = m[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      const q = value[0]
      value = value.slice(1, -1)
      value = q === '"' ? value.replace(/\\"/g, '"').replace(/\\\\/g, "\\") : value.replace(/''/g, "'")
    }
    out[m[1]] = value
  }
  return out
}

describe("WO-DPDP-014 §1 -- the facts file agrees (WO-013), when it is present", () => {
  const factsPath = join(APP_ROOT, "data", "veridian-facts.yaml")
  const has = existsSync(factsPath)
  const t = has ? test : test.skip
  t("brand.full / brand.short / brand.share_ask equal the constants", () => {
    const brand = readBrandBlock(readFileSync(factsPath, "utf8"))
    expect(brand.full).toBe(BRAND_LINE_FULL)
    expect(brand.short).toBe(BRAND_LINE_SHORT)
    expect(brand.share_ask).toBe(SHARE_ASK)
  })
})

// Skipped, not silently: a *.test.* file's own fixtures must contain the
// banned spellings to prove a detector catches them (claims-register.test.ts,
// brand-line.test.ts), and facts.mjs (WO-DPDP-013) is that detector itself --
// its own banned-word regex necessarily spells the phrase out in source, the
// same reason this file's own regexes below are the only place IT spells it
// out. Both are already proven by their own dedicated tests; scanning them
// here would flag the enforcement code for doing its job, not a real leak.
const SKIP_FILES = new Set(["facts.mjs"])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue
    if (SKIP_FILES.has(name) || /\.test\.(ts|tsx|mts|mjs|js)$/.test(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|mts|mjs|js|css|html|md|txt|json|yaml|yml)$/.test(name)) out.push(p)
  }
  return out
}

describe("WO-DPDP-014 §1 -- no variant spelling anywhere it could be read", () => {
  const files = [...walk(join(APP_ROOT, "src")), ...(existsSync(EMAIL_FN) ? walk(EMAIL_FN) : [])]

  test("scans real files", () => {
    expect(files.length).toBeGreaterThan(10)
    expect(files.some((f) => f.endsWith("render.ts"))).toBe(true)
  })

  test('every "ver… indian" is exactly "VERy INDIAN"; the forbidden procurement phrase never appears', () => {
    const bad: string[] = []
    for (const f of files) {
      const text = readFileSync(f, "utf8")
      for (const m of text.matchAll(/\bver[a-z]*\s+indian\b/gi)) {
        if (m[0] !== "VERy INDIAN") bad.push(`${f}: ${JSON.stringify(m[0])}`)
      }
      for (const m of text.matchAll(/\bmade\s+in\s+india\b/gi)) bad.push(`${f}: ${JSON.stringify(m[0])}`)
    }
    expect(bad).toEqual([])
  })
})

describe("WO-DPDP-014 §3 -- the share action cannot see the page address", () => {
  test("ShareVeridian.tsx and brand.ts never mention location, document.URL, history or the hash", () => {
    for (const rel of ["src/components/ShareVeridian.tsx", "src/lib/brand.ts"]) {
      const src = readFileSync(join(APP_ROOT, rel), "utf8")
      expect(src, rel).not.toMatch(/\blocation\b/)
      expect(src, rel).not.toMatch(/document\.(URL|baseURI|referrer)/)
      expect(src, rel).not.toMatch(/\bhistory\b/)
      expect(src, rel).not.toMatch(/\.hash\b/)
      expect(src, rel).not.toMatch(/readFragmentToken|readDraftFragment|aiLinkUrl|SITE_ORIGIN/)
    }
    const share = readFileSync(join(APP_ROOT, "src/components/ShareVeridian.tsx"), "utf8")
    expect(share).toContain("PUBLIC_SITE")
  })
})

// WCAG 2.x relative luminance / contrast ratio, on the hex pair the bar
// actually uses (read from the CSS, not retyped here).
function luminance(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16)
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
function contrastRatio(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}

describe("WO-DPDP-014 §2 -- the look: ink, white, one accent, at least 4.5:1", () => {
  const tokens = readFileSync(join(APP_ROOT, "src/components/onepage/dpdp-onepage-tokens.css"), "utf8")
  const bar = readFileSync(join(APP_ROOT, "src/components/BrandLine.css"), "utf8")
  const token = (name: string): string => {
    const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(tokens)
    if (!m) throw new Error(`token --${name} not found`)
    return m[1]
  }

  test("background is the ink token, text is white, and the pair passes 4.5:1", () => {
    expect(bar).toMatch(/\.dpdp-brandline\s*{[^}]*background:\s*var\(--dpdp-ink\)/)
    expect(bar).toMatch(/\.dpdp-brandline\s*{[^}]*color:\s*#fff\b/i)
    const ratio = contrastRatio("#ffffff", token("dpdp-ink"))
    expect(ratio).toBeGreaterThanOrEqual(4.5)
    // Reported in the PR body (WO-014 §9 "LOOK: ... contrast <ratio>").
    expect(Number(ratio.toFixed(2))).toBeGreaterThan(10)
  })

  test("the accent is an existing token (marigold --dpdp-a or green --dpdp-g); no flag colours", () => {
    expect(bar).toMatch(/\.dpdp-brandline__accent\s*{[^}]*background:\s*var\(--dpdp-(a|g)\)/)
    // The Indian flag's saffron / green / navy-chakra hexes, in any case.
    expect(bar).not.toMatch(/#(ff9933|138808|000080|ff671f|046a38|06038d)/i)
    expect(bar).not.toMatch(/linear-gradient/)
  })

  test("the bar is at least 12 px text, about 28 px tall, in flow (never fixed or sticky), short line under 480 px", () => {
    expect(bar).toMatch(/\.dpdp-brandline\s*{[^}]*font-size:\s*1[2-9](\.\d+)?px/)
    expect(bar).toMatch(/\.dpdp-brandline\s*{[^}]*min-height:\s*28px/)
    expect(bar).toMatch(/\.dpdp-brandline\s*{[^}]*position:\s*static/)
    expect(bar).not.toMatch(/position:\s*(fixed|sticky)/)
    expect(bar).toMatch(/@media\s*\(max-width:\s*479(\.98)?px\)/)
  })
})
