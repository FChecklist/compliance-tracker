// Post-build proof for WO-DPDP-012 §1/§2/§3/§4 on the static host. Reads
// dist/ (or the directory given as argv[2]) and executes NO JavaScript: if a
// heading or a sentence is not in the raw HTML file, a crawler with scripts
// off would not see it either. Every expectation comes from
// src/lib/public-surface.mjs, the one list of public and private pages.
//
// Checks, per public page: exactly one <h1> with the listed text; headings
// in order; <title>, meta description, canonical, Open Graph; lang="en-IN";
// the listed body copy present verbatim in the raw file; parseable JSON-LD
// carrying exactly the listed schema.org types, SoftwareApplication with the
// §4 fields, no price/offer key anywhere, every FAQPage question and answer
// visible on the page; no <script> other than JSON-LD; nothing cross-origin;
// both fonts preloaded from this host. Per private page: the noindex and
// no-referrer metas, no canonical. Then robots.txt, sitemap.xml, _headers
// and llms*.txt against the same list, and a whole-dist scan for tracker
// hostnames and Google Fonts.
//
// Exit 1 with every failure named; exit 2 if dist/ is missing.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  PRIVATE_PAGES,
  PUBLIC_PAGES,
  REQUIRED_BOTS,
  SITE_ORIGIN,
  isW3cDatetime,
  pageUrl,
  parseHeadersFile,
  parseRobots,
  resolveHeaders,
} from "../src/lib/public-surface.mjs"

const dist = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL("../dist/", import.meta.url))
if (!existsSync(dist)) {
  console.error("check-public-surface: dist/ not found -- run `vite build` first")
  process.exit(2)
}

const failures = []
let checks = 0
function expect(condition, message) {
  checks++
  if (!condition) failures.push(message)
}
const has = (p) => existsSync(join(dist, p))
const read = (p) => readFileSync(join(dist, p), "utf8")

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

// The handful of entities these pages use. Anything else stays as written.
function decode(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rdquo;/g, "”")
    .replace(/&ldquo;/g, "“")
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

// Visible text of an HTML fragment: scripts and styles dropped, <br> and
// every other tag turned into whitespace, whitespace collapsed.
function textOf(html) {
  return decode(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim()
}

function attr(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag)
  return m ? m[1] : null
}
const tagsOf = (html, re) => html.match(re) ?? []
function meta(html, key, value) {
  for (const t of tagsOf(html, /<meta\b[^>]*>/gi)) if ((attr(t, key) ?? "").toLowerCase() === value.toLowerCase()) return attr(t, "content")
  return null
}
function linkHref(html, rel) {
  for (const t of tagsOf(html, /<link\b[^>]*>/gi)) if ((attr(t, "rel") ?? "").toLowerCase() === rel) return attr(t, "href")
  return null
}
const isSameOrigin = (url) => (url.startsWith("/") && !url.startsWith("//")) || url.startsWith("#") || url.startsWith("data:")

// Owner rule: no price on public pages -- so no price-shaped key anywhere in
// the structured data either, whatever it is nested under.
function priceKeys(value, path = "$", out = []) {
  if (Array.isArray(value)) value.forEach((v, i) => priceKeys(v, `${path}[${i}]`, out))
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (/^(offers?|price|priceCurrency|priceRange|priceSpecification|lowPrice|highPrice)$/i.test(k)) out.push(`${path}.${k}`)
      priceKeys(v, `${path}.${k}`, out)
    }
  }
  return out
}

// <link> rels that make the browser FETCH something (or open a connection);
// canonical/alternate merely name a URL and are absolute by design.
const LOADING_RELS = new Set(["stylesheet", "preload", "modulepreload", "prefetch", "preconnect", "dns-prefetch", "icon", "manifest"])

function checkCrossOrigin(label, html) {
  for (const t of tagsOf(html, /<(?:script|link|img|iframe|source|video|audio|object|embed)\b[^>]*>/gi)) {
    if (/^<link\b/i.test(t) && !LOADING_RELS.has((attr(t, "rel") ?? "").toLowerCase())) continue
    const url = attr(t, "src") ?? attr(t, "href")
    if (url) expect(isSameOrigin(url), `${label}: cross-origin URL ${url}`)
  }
}

// ---------------------------------------------------------------- public pages
for (const page of PUBLIC_PAGES) {
  const label = page.path
  if (!has(page.source)) {
    expect(false, `${label}: dist/${page.source} missing`)
    continue
  }
  const html = read(page.source)
  const text = textOf(html)

  expect(/<html\b[^>]*\slang="en-IN"/i.test(html), `${label}: <html lang="en-IN"> missing`)

  const h1s = tagsOf(html, /<h1\b[^>]*>[\s\S]*?<\/h1>/gi)
  expect(h1s.length === 1, `${label}: expected exactly one <h1>, found ${h1s.length}`)
  if (h1s.length === 1) expect(textOf(h1s[0]) === page.h1, `${label}: <h1> reads "${textOf(h1s[0])}", expected "${page.h1}"`)
  const levels = tagsOf(html, /<h[1-6]\b/gi).map((t) => Number(t[2]))
  expect(levels[0] === 1, `${label}: first heading is h${levels[0]}, not h1`)
  for (let i = 1; i < levels.length; i++) {
    expect(levels[i] <= levels[i - 1] + 1, `${label}: heading order jumps from h${levels[i - 1]} to h${levels[i]}`)
  }

  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? ""
  expect(title === page.title, `${label}: <title> is "${title}", expected "${page.title}"`)
  const description = meta(html, "name", "description")
  expect(!!description && description.length > 40, `${label}: meta description missing or too short`)
  const canonical = linkHref(html, "canonical")
  expect(canonical === pageUrl(page.path), `${label}: canonical is ${canonical}, expected ${pageUrl(page.path)}`)
  for (const p of ["og:title", "og:description", "og:url", "og:type", "og:site_name"]) expect(!!meta(html, "property", p), `${label}: ${p} missing`)
  expect(meta(html, "property", "og:url") === pageUrl(page.path), `${label}: og:url differs from the canonical`)
  expect(meta(html, "property", "og:title") === title, `${label}: og:title differs from <title>`)
  expect(meta(html, "property", "og:description") === description, `${label}: og:description differs from the meta description`)
  const robotsMeta = meta(html, "name", "robots")
  expect(!robotsMeta || !/noindex|nofollow/i.test(robotsMeta), `${label}: PUBLIC page carries <meta name="robots" content="${robotsMeta}">`)

  for (const s of page.mustContain) expect(html.includes(s), `${label}: raw HTML lacks the copy "${s.length > 70 ? s.slice(0, 70) + "…" : s}"`)

  // JSON-LD (WO-012 §4)
  const blocks = tagsOf(html, /<script\b[^>]*type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/gi)
  expect(blocks.length >= 1, `${label}: no JSON-LD block`)
  const nodes = []
  for (const block of blocks) {
    const body = block.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "")
    try {
      const parsed = JSON.parse(body)
      nodes.push(...(Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [parsed]))
    } catch (e) {
      expect(false, `${label}: JSON-LD does not parse: ${e.message}`)
    }
  }
  const types = nodes.flatMap((n) => [].concat(n["@type"] ?? []))
  for (const t of page.jsonLd) expect(types.includes(t), `${label}: JSON-LD lacks ${t}`)
  for (const t of types) expect(page.jsonLd.includes(t), `${label}: JSON-LD carries ${t}, which public-surface.mjs does not list for this page`)
  if (page.jsonLd.includes("SoftwareApplication")) {
    const app = nodes.find((n) => n["@type"] === "SoftwareApplication")
    expect(app?.applicationCategory === "BusinessApplication", `${label}: SoftwareApplication.applicationCategory is not "BusinessApplication"`)
    expect(app?.operatingSystem === "Web browser", `${label}: SoftwareApplication.operatingSystem is not "Web browser"`)
    expect(!!app?.audience, `${label}: SoftwareApplication.audience missing`)
  }
  const bad = priceKeys(nodes)
  expect(bad.length === 0, `${label}: JSON-LD carries price/offer keys (${bad.join(", ")}) -- owner rule: no price on public pages`)
  if (page.jsonLd.includes("FAQPage")) {
    const questions = nodes.find((n) => n["@type"] === "FAQPage")?.mainEntity ?? []
    expect(questions.length > 0, `${label}: FAQPage has no mainEntity`)
    for (const q of questions) {
      expect(typeof q.name === "string" && text.includes(q.name), `${label}: FAQ question is not visible on the page: "${q.name}"`)
      const answer = q.acceptedAnswer?.text
      expect(typeof answer === "string" && text.includes(answer), `${label}: FAQ answer is not visible on the page for "${q.name}"`)
    }
  }

  // Complete HTML on arrival: no script runs on a public page at all.
  const scripts = tagsOf(html, /<script\b[^>]*>/gi).filter((t) => !/type="application\/ld\+json"/i.test(t))
  expect(scripts.length === 0, `${label}: public page has ${scripts.length} <script> tag(s) besides JSON-LD`)
  checkCrossOrigin(label, html)

  // Fonts: both self-hosted files preloaded, with crossorigin (fonts fetch
  // in CORS mode; a preload without it is discarded and fetched twice).
  const preloads = tagsOf(html, /<link\b[^>]*rel="preload"[^>]*>/gi).filter((t) => attr(t, "as") === "font")
  expect(preloads.length === 2, `${label}: expected 2 font preloads, found ${preloads.length}`)
  for (const t of preloads) {
    const href = attr(t, "href") ?? ""
    expect(href.startsWith("/fonts/") && has(href.slice(1)), `${label}: preloaded font ${href} is not in dist/fonts/`)
    expect(/\scrossorigin\b/i.test(t), `${label}: font preload ${href} lacks crossorigin`)
  }
}

// --------------------------------------------------------------- private pages
for (const priv of PRIVATE_PAGES) {
  const label = priv.prefix
  if (!has(priv.source)) {
    expect(false, `${label}: dist/${priv.source} missing`)
    continue
  }
  const html = read(priv.source)
  expect(/<html\b[^>]*\slang="en-IN"/i.test(html), `${label}: <html lang="en-IN"> missing`)
  expect(meta(html, "name", "robots") === "noindex, nofollow", `${label}: <meta name="robots" content="noindex, nofollow"> missing`)
  expect(meta(html, "name", "referrer") === "no-referrer", `${label}: <meta name="referrer" content="no-referrer"> missing`)
  expect(linkHref(html, "canonical") === null, `${label}: a private page must not declare a canonical`)
  checkCrossOrigin(label, html)
}

// ------------------------------------------------ whole dist: no third parties
const TRACKER_HOSTS = [
  "googletagmanager.com",
  "google-analytics.com",
  "googlesyndication.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "connect.facebook.net",
  "hotjar.com",
  "clarity.ms",
  "plausible.io",
  "segment.com",
  "mixpanel.com",
  "posthog.com",
  "vercel-insights.com",
  "vercel-scripts.com",
  "vercel.live",
]
const textFiles = walk(dist).filter((f) => /\.(html|js|css|txt|xml)$/i.test(f))
for (const f of textFiles) {
  const body = readFileSync(f, "utf8").toLowerCase()
  for (const host of TRACKER_HOSTS) expect(!body.includes(host), `${relative(dist, f)}: mentions ${host}`)
}

const css = textFiles.filter((f) => f.endsWith(".css")).map((f) => readFileSync(f, "utf8")).join("\n")
expect(/font-display:\s*swap/.test(css), "built CSS has no @font-face with font-display: swap")
for (const font of ["sora-latin-wght", "instrument-sans-latin-wght"]) {
  expect(css.includes(`/fonts/${font}.woff2`), `built CSS does not reference /fonts/${font}.woff2`)
  expect(has(`fonts/${font}.woff2`), `dist/fonts/${font}.woff2 missing`)
}
for (const licence of ["fonts/OFL-Sora.txt", "fonts/OFL-InstrumentSans.txt"]) expect(has(licence), `dist/${licence} missing (SIL OFL requires the licence to travel with the font)`)

// ------------------------------------------------------------------ robots.txt
expect(has("robots.txt"), "dist/robots.txt missing")
if (has("robots.txt")) {
  const { groups, sitemaps } = parseRobots(read("robots.txt"))
  for (const bot of REQUIRED_BOTS) {
    const group = groups.find((g) => g.agents.includes(bot))
    expect(!!group, `robots.txt: ${bot} is not named`)
    if (!group) continue
    expect(group.allow.includes("/"), `robots.txt: ${bot}'s group does not Allow: /`)
    for (const priv of PRIVATE_PAGES) expect(group.disallow.includes(priv.prefix), `robots.txt: ${bot}'s group does not Disallow: ${priv.prefix}`)
  }
  const star = groups.find((g) => g.agents.includes("*"))
  expect(!!star, "robots.txt: no User-agent: * group")
  for (const priv of PRIVATE_PAGES) expect(!!star && star.disallow.includes(priv.prefix), `robots.txt: the * group does not Disallow: ${priv.prefix}`)
  for (const g of groups) {
    for (const d of g.disallow) {
      for (const pub of PUBLIC_PAGES) expect(!(d && pub.path.startsWith(d)), `robots.txt: Disallow: ${d} (${g.agents.join(", ")}) would block the public page ${pub.path}`)
    }
  }
  expect(sitemaps.length === 1 && sitemaps[0] === `${SITE_ORIGIN}/sitemap.xml`, `robots.txt: Sitemap is ${JSON.stringify(sitemaps)}, expected ["${SITE_ORIGIN}/sitemap.xml"]`)
}

// ----------------------------------------------------------------- sitemap.xml
expect(has("sitemap.xml"), "dist/sitemap.xml missing -- run scripts/build-sitemap.mjs after vite build")
if (has("sitemap.xml")) {
  const xml = read("sitemap.xml")
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  const want = PUBLIC_PAGES.map((p) => pageUrl(p.path))
  expect(locs.length === want.length && want.every((u) => locs.includes(u)), `sitemap.xml lists ${JSON.stringify(locs)}, expected exactly ${JSON.stringify(want)}`)
  const lastmods = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1])
  expect(lastmods.length === locs.length, "sitemap.xml: every <url> needs a <lastmod>")
  for (const m of lastmods) expect(isW3cDatetime(m), `sitemap.xml: lastmod "${m}" is not a W3C datetime`)
}

// -------------------------------------------------------------------- _headers
expect(has("_headers"), "dist/_headers missing (Cloudflare Pages reads it from the output directory)")
if (has("_headers")) {
  const rules = parseHeadersFile(read("_headers"))
  for (const priv of PRIVATE_PAGES) {
    expect(rules.some((r) => r.path === `${priv.prefix}*`), `_headers: no rule for ${priv.prefix}*`)
    for (const path of [priv.prefix, `${priv.prefix}index.html`, `${priv.prefix}anything`]) {
      const h = resolveHeaders(rules, path)
      expect(h["x-robots-tag"] === "noindex, nofollow", `_headers: ${path} gets X-Robots-Tag "${h["x-robots-tag"]}"`)
      expect(h["referrer-policy"] === "no-referrer", `_headers: ${path} gets Referrer-Policy "${h["referrer-policy"]}" -- must be exactly no-referrer (Cloudflare comma-joins a header set twice unless the broad one is detached first)`)
      expect(h["cache-control"] === "no-store", `_headers: ${path} gets Cache-Control "${h["cache-control"]}"`)
      expect(h["x-content-type-options"] === "nosniff", `_headers: ${path} lacks X-Content-Type-Options: nosniff`)
    }
  }
  for (const pub of PUBLIC_PAGES) {
    const h = resolveHeaders(rules, pub.path)
    expect(!h["x-robots-tag"], `_headers: PUBLIC ${pub.path} gets X-Robots-Tag "${h["x-robots-tag"]}"`)
    expect(h["referrer-policy"] === "strict-origin-when-cross-origin", `_headers: ${pub.path} gets Referrer-Policy "${h["referrer-policy"]}"`)
    expect(h["x-content-type-options"] === "nosniff", `_headers: ${pub.path} lacks X-Content-Type-Options: nosniff`)
  }
}

// ------------------------------------------------------------------- llms.txt
for (const f of ["llms.txt", "llms-full.txt"]) {
  expect(has(f), `dist/${f} missing`)
  if (!has(f)) continue
  const body = read(f)
  for (const pub of PUBLIC_PAGES) expect(body.includes(pageUrl(pub.path)), `${f}: does not list ${pageUrl(pub.path)}`)
  for (const priv of PRIVATE_PAGES) expect(!body.includes(pageUrl(priv.prefix)), `${f}: names the private URL ${pageUrl(priv.prefix)}`)
  expect(/no major search engine has confirmed/i.test(body), `${f}: lacks the honesty note WO-012 §3 asks for`)
}

// --------------------------------------------------------------------- summary
if (failures.length) {
  console.error(`check-public-surface: FAIL -- ${failures.length} of ${checks} checks failed`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`check-public-surface: OK -- ${checks} checks passed across ${PUBLIC_PAGES.length} public and ${PRIVATE_PAGES.length} private page(s) in ${relative(process.cwd(), dist) || "."}`)
