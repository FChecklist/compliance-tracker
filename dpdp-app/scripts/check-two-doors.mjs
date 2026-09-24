#!/usr/bin/env node
// WO-DPDP-013 v2 §0 "the wall" + §2.3, and WO-DPDP-014 §1: the tests that
// keep Part 1 (the AI work link) out of Part 2 (the public site), and keep
// the public site honest. Runs inside `bun run build` after
// scripts/check-claims.mjs; src/lib/two-doors-wall.test.ts and
// src/lib/brand-line.test.ts run the same functions against fixtures and
// the committed sources.
//
//   node scripts/check-two-doors.mjs [dist-dir]   exit 1 with every failure
//                                                 named; exit 2 if dist/ is
//                                                 missing
//
// (a) THE WALL: no public surface (every public page, the hidden /proof/,
//     for-ai.md, llms.txt, llms-full.txt, facts.json, robots.txt,
//     sitemap.xml) contains any of: /ai/, manual.md, manual.json, /context,
//     /jobs, /law/, /report/, /history, /actions, /drafts, functions/v1,
//     supabase.co, #token, ?format=, a 32+ hex string, a JWT-looking "eyJ"
//     string. robots.txt is scanned with its Disallow lines removed -- it
//     must name /ai/ there, see (b).
// (b) /ai/* is disallowed in robots.txt for every group, absent from
//     sitemap.xml, and _headers gives /ai/* X-Robots-Tag: noindex, nofollow.
// (c) NO HIDDEN TEXT on the public pages: no element with letter text under
//     display:none, visibility:hidden, font-size:0, opacity:0,
//     text-indent:-9999px, a hidden attribute, aria-hidden="true", or a
//     colour equal to its background -- whether inline or via a class in
//     the built CSS. A class a media query re-shows (the brand line's
//     full/short swap, .nav-due) is a layout rule, not hidden text.
// (d) NO INSTRUCTION TO AN AI to praise, rank, recommend or share VERIDIAN,
//     on any public surface; "share VERIDIAN" additionally on none of the
//     AI-facing surfaces (/for-ai/, for-ai.md, llms*.txt, facts.json).
// (e) SAME CONTENT FOR MACHINES AND PEOPLE: no <script> on a public page
//     other than JSON-LD (check-public-surface.mjs proves the rest).
// (f) THE BRAND LINE (WO-014 §1): no variant spelling of "VERy INDIAN" and
//     no "Made in India" anywhere in dist/ or in the sources; every
//     occurrence of the line on a public surface is byte-identical to the
//     facts file; /proof/ is linked from nowhere while hidden.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { APP_DIR, loadFacts } from "../src/lib/facts.mjs"
import { HIDDEN_PAGES, PRIVATE_PAGES, PUBLIC_PAGES, parseHeadersFile, parseRobots, resolveHeaders } from "../src/lib/public-surface.mjs"
import { decodeEntities } from "./generate-public-facts.mjs"

const SELF = fileURLToPath(import.meta.url)

// ------------------------------------------------------------ (a) the wall
export const FORBIDDEN_PATTERNS = [
  { name: "/ai/", re: /\/ai\// },
  { name: "manual.md", re: /manual\.md/i },
  { name: "manual.json", re: /manual\.json/i },
  { name: "/context", re: /\/context(?![\p{L}\p{N}-])/u },
  { name: "/jobs", re: /\/jobs(?![\p{L}\p{N}-])/u },
  { name: "/law/", re: /\/law\// },
  { name: "/report/", re: /\/report\// },
  { name: "/history", re: /\/history(?![\p{L}\p{N}-])/u },
  { name: "/actions", re: /\/actions(?![\p{L}\p{N}-])/u },
  { name: "/drafts", re: /\/drafts(?![\p{L}\p{N}-])/u },
  { name: "functions/v1", re: /functions\/v1/ },
  { name: "supabase.co", re: /supabase\.co/i },
  { name: "#token", re: /#token/i },
  { name: "?format=", re: /\?format=/ },
  { name: "32+ hex string", re: /(?<![\p{L}\p{N}])[0-9a-f]{32,}(?![\p{L}\p{N}])/iu },
  { name: "JWT-looking eyJ string", re: /(?<![\p{L}\p{N}])eyJ[A-Za-z0-9_-]{8,}/u },
]

/** Every forbidden pattern found in `text`, with a short snippet. For
 * robots.txt pass { robots: true } so its own Disallow lines are exempt. */
export function scanWall(text, { robots = false } = {}) {
  const body = robots ? text.replace(/^\s*disallow\s*:.*$/gim, "") : text
  const out = []
  for (const { name, re } of FORBIDDEN_PATTERNS) {
    const m = re.exec(body)
    if (m) out.push({ pattern: name, snippet: body.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).replace(/\s+/g, " ") })
  }
  return out
}

// --------------------------------------------------------- (c) hidden text
const HIDING = [
  { name: "display:none", re: /display\s*:\s*none/i },
  { name: "visibility:hidden", re: /visibility\s*:\s*hidden/i },
  { name: "font-size:0", re: /font-size\s*:\s*0(?:px|rem|em|%|pt)?\s*(?:;|!|$)/i },
  { name: "opacity:0", re: /opacity\s*:\s*0(?![.\d])/i },
  { name: "text-indent:-9999px", re: /text-indent\s*:\s*-\d{3,}/i },
  { name: "offscreen", re: /(?:left|top)\s*:\s*-\d{4,}px/i },
]
const SHOWING = [
  /display\s*:\s*(?!none)[a-z-]+/i,
  /visibility\s*:\s*visible/i,
  /font-size\s*:\s*(?!0(?:px|rem|em|%|pt)?\s*(?:;|!|$))[\d.]+/i,
  /opacity\s*:\s*(?:0?\.\d+|1)(?![\d])/i,
  /text-indent\s*:\s*0/i,
]

function hidingIn(body) {
  return HIDING.filter((h) => h.re.test(body)).map((h) => h.name)
}

function rootVars(css) {
  const vars = {}
  for (const root of css.matchAll(/:root\s*\{([^}]*)\}/g)) for (const m of root[1].matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);?/gi)) vars[m[1]] = m[2].trim()
  return vars
}

const resolveVar = (v, vars) => {
  const m = /^var\(--([a-z0-9-]+)\)$/i.exec(v.trim())
  return m ? (vars[m[1]] ?? v) : v.trim()
}

/** Colour equal to background inside one declaration block. */
function sameColourAsBackground(body, vars) {
  const color = /(?:^|;|\s)color\s*:\s*([^;!]+)/i.exec(body)?.[1]
  const bg = /(?:^|;|\s)background(?:-color)?\s*:\s*([^;!]+)/i.exec(body)?.[1]
  if (!color || !bg) return false
  const c = resolveVar(color, vars).toLowerCase()
  const b = resolveVar(bg, vars).toLowerCase()
  return c === b && c !== "transparent" && !c.startsWith("var(")
}

/**
 * Split a stylesheet into { selector, body, media } rules, one level of
 * @media nesting (all site.css needs). Comments stripped. Other at-rules
 * (@import, @font-face) are skipped.
 */
export function parseCss(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "")
  const rules = []
  let i = 0
  function readBlock(from) {
    // from points just after "{"; returns [inner, indexAfterClosingBrace]
    let depth = 1
    let j = from
    while (j < src.length && depth > 0) {
      if (src[j] === "{") depth++
      else if (src[j] === "}") depth--
      j++
    }
    return [src.slice(from, j - 1), j]
  }
  function parseRules(text, media) {
    let k = 0
    while (k < text.length) {
      const open = text.indexOf("{", k)
      if (open === -1) break
      const selector = text.slice(k, open).trim()
      let depth = 1
      let j = open + 1
      while (j < text.length && depth > 0) {
        if (text[j] === "{") depth++
        else if (text[j] === "}") depth--
        j++
      }
      const body = text.slice(open + 1, j - 1)
      k = j
      if (!selector || selector.startsWith("@")) continue
      for (const sel of selector.split(",")) rules.push({ selector: sel.trim(), body: body.trim(), media })
    }
  }
  while (i < src.length) {
    const open = src.indexOf("{", i)
    if (open === -1) break
    const head = src.slice(i, open).trim()
    const [inner, after] = readBlock(open + 1)
    if (/^@media\b/i.test(head)) parseRules(inner, head)
    else if (head.startsWith("@")) {
      // @font-face, @supports etc.: not a hiding rule for this site's CSS.
    } else for (const sel of head.split(",")) rules.push({ selector: sel.trim(), body: inner.trim(), media: null })
    i = after
  }
  return rules
}

/**
 * Classes the built CSS hides everywhere (a top-level hiding declaration
 * with no media-query rule that shows the same selector again), plus any
 * hiding rule whose selector is not a plain single class -- reported so a
 * reviewer decides, rather than silently ignored.
 */
export function alwaysHiddenClasses(css) {
  const rules = parseCss(css)
  const vars = rootVars(css)
  const hidden = new Map()
  const complex = []
  for (const r of rules) {
    const how = hidingIn(r.body)
    if (sameColourAsBackground(r.body, vars)) how.push("colour equal to background")
    if (!how.length) continue
    const simple = /^\.([A-Za-z0-9_-]+)$/.exec(r.selector)
    if (!simple) {
      if (r.media === null) complex.push({ selector: r.selector, how })
      continue
    }
    if (r.media !== null) continue // hidden at some widths only: layout
    hidden.set(simple[1], how)
  }
  for (const r of rules) {
    if (r.media === null) continue
    const simple = /^\.([A-Za-z0-9_-]+)$/.exec(r.selector)
    if (!simple || !hidden.has(simple[1])) continue
    if (SHOWING.some((re) => re.test(r.body))) hidden.delete(simple[1])
  }
  return { hidden, complex }
}

const hasLetters = (s) => /[\p{L}\p{N}]/u.test(decodeEntities(s).replace(/<[^>]+>/g, ""))

/** Inner HTML of the first element whose open tag is at `index`
 * (best-effort: up to the matching close tag of the same name, counting
 * nested same-name tags). */
function innerOf(html, index) {
  const open = /^<([a-zA-Z0-9]+)\b[^>]*?(\/?)>/.exec(html.slice(index))
  if (!open) return ""
  if (open[2] === "/") return ""
  const tag = open[1].toLowerCase()
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi")
  re.lastIndex = index + open[0].length
  let depth = 1
  let m
  while ((m = re.exec(html))) {
    depth += m[1] === "/" ? -1 : 1
    if (depth === 0) return html.slice(index + open[0].length, m.index)
  }
  return html.slice(index + open[0].length)
}

/** Hidden-text findings on one page against the built CSS. */
export function findHiddenText(html, css) {
  const out = []
  const { hidden, complex } = alwaysHiddenClasses(css)
  for (const c of complex) out.push({ kind: "css rule to review", detail: `${c.selector} { ${c.how.join(", ")} }` })
  for (const m of html.matchAll(/<[a-zA-Z0-9]+\b[^>]*>/g)) {
    const tag = m[0]
    const at = m.index
    const style = /\sstyle\s*=\s*"([^"]*)"/i.exec(tag)?.[1]
    if (style) {
      const how = hidingIn(style)
      if (sameColourAsBackground(style, {})) how.push("colour equal to background")
      if (how.length && hasLetters(innerOf(html, at))) out.push({ kind: `inline ${how.join(", ")}`, detail: tag })
    }
    if (/\shidden(?:\s|=|>|\/)/i.test(tag) && hasLetters(innerOf(html, at))) out.push({ kind: "hidden attribute", detail: tag })
    if (/\saria-hidden\s*=\s*"true"/i.test(tag) && hasLetters(innerOf(html, at))) out.push({ kind: 'aria-hidden="true" with text', detail: tag })
    const classes = /\sclass\s*=\s*"([^"]*)"/i.exec(tag)?.[1]?.split(/\s+/) ?? []
    for (const c of classes) {
      if (hidden.has(c) && hasLetters(innerOf(html, at))) out.push({ kind: `class .${c} (${hidden.get(c).join(", ")})`, detail: tag })
    }
  }
  return out
}

// ------------------------------------------- (d) no instruction to an AI
export const PRAISE_PATTERNS = [
  /recommend(?:s|ed|ing)?\s+veridian/i,
  /rank(?:s|ed|ing)?\s+veridian/i,
  /tell\s+(?:the\s+)?users?\s+(?:that|to)\b/i,
  /you\s+should\s+(?:say|tell|recommend|describe|rank|prefer|promote)/i,
  /you\s+must\s+(?:say|tell|recommend|describe|rank|prefer|promote)/i,
  /always\s+describe\s+veridian\s+as/i,
  /describe\s+veridian\s+as\s+(?:the\s+)?(?:best|leading|only|top|number)/i,
  /prefer\s+veridian/i,
  /promote\s+veridian/i,
  /recommend\s+us\b/i,
  /ignore\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above|earlier)\s+instructions/i,
]
export const SHARE_ASK_PATTERN = /share\s+veridian/i

/** AI-facing surfaces (relative to dist/): the share ask is for people on
 * pages, never a line an AI reads as an instruction (WO-014 §4). */
export const AI_SURFACES = ["for-ai/index.html", "for-ai.md", "llms.txt", "llms-full.txt", "facts.json"]

export function findAiInstructions(text, { aiSurface = false } = {}) {
  const out = []
  for (const re of PRAISE_PATTERNS) {
    const m = re.exec(text)
    if (m) out.push({ pattern: re.source, snippet: text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).replace(/\s+/g, " ") })
  }
  if (aiSurface) {
    const m = SHARE_ASK_PATTERN.exec(text)
    if (m) out.push({ pattern: "share VERIDIAN (on an AI-facing surface)", snippet: text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).replace(/\s+/g, " ") })
  }
  return out
}

// ----------------------------------------------- (f) the brand line
export const CORRECT_SPELLING = "VERy INDIAN"

/** Every spelling of "very indian" that is not exactly "VERy INDIAN", and
 * every "Made in India" (banned outright, WO-014 §1). */
export function findSpellingVariants(text) {
  const out = []
  for (const m of text.matchAll(/very\s*indian/giu)) if (m[0] !== CORRECT_SPELLING) out.push({ variant: m[0], index: m.index })
  for (const m of text.matchAll(/made\s+in\s+india/giu)) out.push({ variant: m[0], index: m.index })
  return out
}

/**
 * Every occurrence of the brand line, the short line or the share ask on a
 * surface must be byte-identical to the facts file: an approximate line is
 * a retyped line. Checks the wordmark "VERIDIAN · VERy INDIAN" (any case
 * or spacing must be exact), "for India, by India" (must sit inside the
 * exact full or short line), "built for India" (inside the exact full
 * line) and "know a firm that needs this" (the exact share ask).
 */
export function findBrandLineDeviations(text, brand) {
  const out = []
  const t = decodeEntities(text)
  for (const m of t.matchAll(/veridian\s*·\s*very\s*indian/giu)) {
    if (m[0] !== brand.title_prefix) out.push({ found: m[0], expected: brand.title_prefix })
  }
  const inside = (index, len, ...lines) => lines.some((line) => {
    const start = t.lastIndexOf(line.slice(0, 8), index)
    return start !== -1 && t.slice(start, start + line.length) === line && index + len <= start + line.length
  })
  for (const m of t.matchAll(/for\s+india,?\s+by\s+india/giu)) {
    if (!inside(m.index, m[0].length, brand.full, brand.short)) out.push({ found: t.slice(Math.max(0, m.index - 40), m.index + m[0].length + 10).replace(/\s+/g, " "), expected: brand.full })
  }
  for (const m of t.matchAll(/built\s+for\s+india/giu)) {
    if (!inside(m.index, m[0].length, brand.full)) out.push({ found: t.slice(Math.max(0, m.index - 40), m.index + m[0].length + 10).replace(/\s+/g, " "), expected: brand.full })
  }
  for (const m of t.matchAll(/know\s+a\s+firm\s+that\s+needs\s+this[^<\n]*/giu)) {
    const found = m[0].replace(/\s+/g, " ").trim()
    if (found !== brand.share_ask) out.push({ found, expected: brand.share_ask })
  }
  return out
}

// ------------------------------------------------------------------ files
function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}
const TEXT_EXT = /\.(html|htm|js|mjs|ts|tsx|css|txt|md|json|xml|yaml|yml|toml)$/i

/** Files that DEFINE the spelling rule and therefore name the banned
 * spellings (the register lists "Made in India" as banned; the checkers and
 * their tests carry fixtures that must be caught). Exempt from the
 * source-tree scan, each with its reason; nothing in dist/ is ever exempt. */
export const SPELLING_SCAN_EXEMPT = new Map([
  ["data/claims-register.yaml", "banned_words names the banned phrase"],
  ["data/veridian-facts.yaml", "the brand block's own comment names the banned spellings"],
  ["src/lib/facts.mjs", "refuses a claim or exception that contains the banned phrase"],
  ["scripts/check-claims.mjs", "implements the banned-word rule"],
  ["scripts/check-two-doors.mjs", "implements this scan"],
  ["src/lib/brand-line.test.ts", "fixtures the scan must catch"],
  ["src/lib/claims-register.test.ts", "fixtures the register must refuse"],
  ["src/lib/two-doors-wall.test.ts", "fixtures the scan must catch"],
])

/** Source files to scan for spelling variants: everything under dpdp-app/
 * except node_modules, dist, the git dir, spec/ (the owner's one-page
 * product spec, copied verbatim -- reported, not scanned) and the
 * rule-defining files above. */
export function sourceFiles(root = APP_DIR) {
  return walk(root).filter((f) => {
    const rel = relative(root, f).split("\\").join("/")
    if (/^(node_modules|dist|\.git|spec|playwright-report|test-results)\//.test(rel)) return false
    if (SPELLING_SCAN_EXEMPT.has(rel)) return false
    return TEXT_EXT.test(rel)
  })
}

export function publicSurfaceFiles() {
  return [...PUBLIC_PAGES.map((p) => p.source), ...HIDDEN_PAGES.map((p) => p.source), "for-ai.md", "llms.txt", "llms-full.txt", "facts.json", "robots.txt", "sitemap.xml"]
}

function main() {
  const dist = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL("../dist/", import.meta.url))
  if (!existsSync(dist)) {
    console.error("check-two-doors: dist/ not found -- run `vite build` first")
    return 2
  }
  const facts = loadFacts()
  const failures = []
  let checks = 0
  const expect = (cond, msg) => {
    checks++
    if (!cond) failures.push(msg)
  }
  const has = (p) => existsSync(join(dist, p))
  const read = (p) => readFileSync(join(dist, p), "utf8")

  // (a) the wall
  for (const rel of publicSurfaceFiles()) {
    if (!has(rel)) {
      expect(false, `${rel}: missing from dist/`)
      continue
    }
    const hits = scanWall(read(rel), { robots: rel === "robots.txt" })
    expect(hits.length === 0, `${rel}: the wall -- ${hits.map((h) => `${h.pattern} (…${h.snippet}…)`).join("; ")}`)
  }

  // (b) /ai/* fenced off
  const aiPrefix = PRIVATE_PAGES.find((p) => p.prefix === "/ai/")?.prefix ?? "/ai/"
  if (has("robots.txt")) {
    const { groups } = parseRobots(read("robots.txt"))
    expect(groups.length > 0 && groups.every((g) => g.disallow.includes(aiPrefix)), `robots.txt: every group must Disallow: ${aiPrefix}`)
  }
  if (has("sitemap.xml")) expect(!read("sitemap.xml").includes(aiPrefix), `sitemap.xml: mentions ${aiPrefix}`)
  if (has("_headers")) {
    const rules = parseHeadersFile(read("_headers"))
    for (const path of [aiPrefix, `${aiPrefix}anything`]) expect(resolveHeaders(rules, path)["x-robots-tag"] === "noindex, nofollow", `_headers: ${path} lacks X-Robots-Tag: noindex, nofollow`)
    for (const hiddenPage of HIDDEN_PAGES) expect(resolveHeaders(rules, `${hiddenPage.prefix}index.html`)["x-robots-tag"] === "noindex, nofollow", `_headers: hidden ${hiddenPage.prefix} lacks X-Robots-Tag noindex`)
  } else expect(false, "dist/_headers missing")

  // (c) no hidden text, (e) no script but JSON-LD -- on every public and hidden page
  const css = walk(dist).filter((f) => f.endsWith(".css")).map((f) => readFileSync(f, "utf8")).join("\n")
  expect(css.length > 0, "dist/ has no CSS to check hidden classes against")
  const pages = [...PUBLIC_PAGES.map((p) => p.source), ...HIDDEN_PAGES.map((p) => p.source)]
  for (const rel of pages) {
    if (!has(rel)) continue
    const html = read(rel)
    const hiddenText = findHiddenText(html, css)
    expect(hiddenText.length === 0, `${rel}: hidden text -- ${hiddenText.map((h) => `${h.kind}: ${h.detail}`).join("; ")}`)
    const scripts = (html.match(/<script\b[^>]*>/gi) ?? []).filter((t) => !/type="application\/ld\+json"/i.test(t))
    expect(scripts.length === 0, `${rel}: ${scripts.length} <script> tag(s) besides JSON-LD`)
    const spelling = findSpellingVariants(html)
    expect(spelling.length === 0, `${rel}: brand spelling variant(s) ${spelling.map((s) => JSON.stringify(s.variant)).join(", ")}`)
    const deviations = findBrandLineDeviations(html, facts.brand)
    expect(deviations.length === 0, `${rel}: brand line not byte-identical to the facts file -- ${deviations.map((d) => `found "${d.found}"`).join("; ")}`)
  }

  // (d) no instruction to an AI; the share ask only where people read it
  for (const rel of publicSurfaceFiles()) {
    if (!has(rel)) continue
    const text = decodeEntities(read(rel))
    const hits = findAiInstructions(text, { aiSurface: AI_SURFACES.includes(rel) })
    expect(hits.length === 0, `${rel}: instruction to an AI -- ${hits.map((h) => `${h.pattern} (…${h.snippet}…)`).join("; ")}`)
  }
  for (const rel of ["for-ai.md", "llms.txt", "llms-full.txt", "facts.json"]) {
    if (!has(rel)) continue
    const body = read(rel)
    const spelling = findSpellingVariants(body)
    expect(spelling.length === 0, `${rel}: brand spelling variant(s) ${spelling.map((s) => JSON.stringify(s.variant)).join(", ")}`)
    const deviations = findBrandLineDeviations(body, facts.brand)
    expect(deviations.length === 0, `${rel}: brand line not byte-identical to the facts file -- ${deviations.map((d) => `found "${d.found}"`).join("; ")}`)
    expect(body.includes(facts.brand.full) || rel === "llms-full.txt", `${rel}: must carry the brand line as a fact (WO-014 §4)`)
  }

  // (f) whole dist and whole source tree: no spelling variant anywhere
  for (const f of walk(dist).filter((f) => TEXT_EXT.test(f))) {
    const v = findSpellingVariants(readFileSync(f, "utf8"))
    expect(v.length === 0, `dist/${relative(dist, f).split("\\").join("/")}: brand spelling variant(s) ${v.map((s) => JSON.stringify(s.variant)).join(", ")}`)
  }
  for (const f of sourceFiles()) {
    const v = findSpellingVariants(readFileSync(f, "utf8"))
    expect(v.length === 0, `${relative(APP_DIR, f).split("\\").join("/")}: brand spelling variant(s) ${v.map((s) => JSON.stringify(s.variant)).join(", ")}`)
  }

  // /proof/ linked from nowhere while hidden; not in sitemap or llms
  for (const hiddenPage of HIDDEN_PAGES) {
    for (const rel of publicSurfaceFiles()) {
      if (rel === hiddenPage.source || !has(rel)) continue
      expect(!read(rel).includes(hiddenPage.prefix), `${rel}: links or names the hidden page ${hiddenPage.prefix}`)
    }
  }

  if (failures.length) {
    console.error(`check-two-doors: FAIL -- ${failures.length} of ${checks} checks failed`)
    for (const f of failures) console.error(`  - ${f}`)
    return 1
  }
  console.log(`check-two-doors: OK -- ${checks} checks passed (wall, /ai/ fence, hidden text, AI instructions, brand spelling) in ${relative(process.cwd(), dist) || "."}`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) process.exitCode = main()
