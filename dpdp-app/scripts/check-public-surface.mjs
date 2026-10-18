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
// Owner decision 2026-10-01: /for-ai/, /for-ai.md and /facts.json are not built;
// llms*.txt carry no crawl-policy note.
//
// Exit 1 with every failure named; exit 2 if dist/ is missing.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  COMPANY_FOOTER_COPY,
  FAMILY_BLOCK,
  FAMILY_LINKS,
  HIDDEN_PAGES,
  LEGAL_PAGES,
  OG_IMAGE,
  PRIVATE_PAGES,
  PUBLIC_ORIGIN,
  PUBLIC_PAGES,
  PAYTEST_URL,
  PUBLIC_SCRIPT_OPENS,
  PWA,
  PWA_SCRIPT,
  scriptOpensFor,
  THEME_SCRIPT,
  REF_SCRIPT,
  REQUIRED_BOTS,
  RUM_SCRIPT,
  VISIT_SCRIPT,
  LEGAL_SCRIPT_OPENS,
  SITEMAP_PAGES,
  SITE_ORIGIN,
  LEGACY_APP_ORIGIN,
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
// the structured data either, whatever it is nested under. WO-DPDP-013 v2
// §2.1 adds "no ratings": no aggregateRating/review/ratingValue either.
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
function ratingKeys(value, path = "$", out = []) {
  if (Array.isArray(value)) value.forEach((v, i) => ratingKeys(v, `${path}[${i}]`, out))
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (/^(aggregateRating|review|reviews|ratingValue|ratingCount|reviewCount|bestRating|worstRating)$/i.test(k)) out.push(`${path}.${k}`)
      ratingKeys(v, `${path}.${k}`, out)
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

// ------------------------------------------------- installable app + the family footer
// Every public, hidden and legal page links the manifest and carries the theme colour; every one of them has a footer with class "uf"
// that holds working Terms / Privacy / Refund / Contact links and the ONE shared family block (byte-identical apart from indentation), with
// the company ownership line still the very last thing before </footer>. (2026-10-18: the family web-quality check C04/C07/C08/C14.)
const trimLines = (s) => s.split("\n").map((l) => l.trim()).filter(Boolean).join("\n")
function checkInstallable(label, html) {
  const manifest = linkHref(html, "manifest")
  expect(manifest === PWA.manifestPath, `${label}: <link rel="manifest" href="${PWA.manifestPath}"> missing (found ${manifest})`)
  expect(meta(html, "name", "theme-color") === PWA.themeColor, `${label}: <meta name="theme-color" content="${PWA.themeColor}"> missing`)
}
function checkFamilyFooter(label, html) {
  const footerTag = /<footer\b[^>]*>/i.exec(html)?.[0] ?? ""
  const footerHtml = /<footer\b[\s\S]*<\/footer>/i.exec(html)?.[0] ?? ""
  expect(/\sclass="[^"]*\buf\b[^"]*"/.test(footerTag), `${label}: the <footer> lacks class "uf" (${footerTag})`)
  expect(tagsOf(html, /<footer\b/gi).length === 1, `${label}: expected exactly one <footer>`)
  for (const [word, href] of [["Terms", "/terms/"], ["Privacy", "/privacy/"], ["Refund", "/refund/"], ["Contact", "/contact/"]]) {
    expect(new RegExp(`<a href="${href}">[^<]*${word}[^<]*</a>`, "i").test(footerHtml), `${label}: footer lacks a working ${word} link to ${href}`)
  }
  const block = /<div class="uf-family">[\s\S]*?<\/ul>\s*<\/div>/.exec(footerHtml)?.[0]
  expect(!!block && trimLines(block) === trimLines(FAMILY_BLOCK), `${label}: footer's family block is missing or differs from the one in public-surface.mjs`)
  expect(footerHtml.includes(`href="${PAYTEST_URL}"`) && /Test a payment/i.test(footerHtml), `${label}: footer lacks the "Test a payment" link to ${PAYTEST_URL}`)
  for (const [, href] of FAMILY_LINKS) expect(footerHtml.includes(`href="${href}"`), `${label}: footer lacks the family link ${href}`)
  // The company ownership line is the last line before </footer>, and the family block sits before it.
  const lines = footerHtml.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("<!--") && l !== "</footer>")
  const last = lines[lines.length - 1] ?? ""
  for (const part of COMPANY_FOOTER_COPY) expect(last.includes(part), `${label}: the company ownership line is not the last line of the footer (lacks "${part.slice(0, 50)}")`)
  expect(footerHtml.indexOf("uf-family") < footerHtml.indexOf(lines[lines.length - 1] ?? "\u0000"), `${label}: the family block must sit before the company line`)
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

  // One host: every public page is indexed under PUBLIC_ORIGIN and never
  // mentions the signed-in app's host (SITE_ORIGIN) -- not in a canonical, an
  // og:url, the JSON-LD, a link, or the copy.
  // The owner-approved product sentence names the dpdp. host as a plain word (no link); an address is refused.
  const appHost = new URL(SITE_ORIGIN).host
  expect(!html.includes("//" + appHost) && !html.includes(appHost + "/"), `${label}: links to the app host ${appHost} -- public pages are indexed under ${PUBLIC_ORIGIN}`)
  expect(!html.includes(new URL(LEGACY_APP_ORIGIN).host), `${label}: mentions the legacy app host ${new URL(LEGACY_APP_ORIGIN).host}`)

  // Social card: Open Graph image + Twitter card (SEO). The image is a real file in dist/.
  const ogImage = `${PUBLIC_ORIGIN}${OG_IMAGE.path}`
  expect(meta(html, "property", "og:image") === ogImage, `${label}: og:image is ${meta(html, "property", "og:image")}, expected ${ogImage}`)
  expect(meta(html, "property", "og:image:width") === String(OG_IMAGE.width), `${label}: og:image:width is not ${OG_IMAGE.width}`)
  expect(meta(html, "property", "og:image:height") === String(OG_IMAGE.height), `${label}: og:image:height is not ${OG_IMAGE.height}`)
  expect(!!meta(html, "property", "og:image:alt"), `${label}: og:image:alt missing`)
  expect(meta(html, "name", "twitter:card") === "summary_large_image", `${label}: twitter:card is not summary_large_image`)
  expect(meta(html, "name", "twitter:title") === title, `${label}: twitter:title differs from <title>`)
  expect(meta(html, "name", "twitter:description") === description, `${label}: twitter:description differs from the meta description`)
  expect(meta(html, "name", "twitter:image") === ogImage, `${label}: twitter:image is not ${ogImage}`)
  const icon = linkHref(html, "icon")
  expect(!!icon && icon.startsWith("/") && has(icon.slice(1)), `${label}: <link rel="icon"> ${icon} is not a file in dist/`)

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
  for (const n of nodes) {
    for (const key of ["@id", "url", "item", "logo"]) {
      if (typeof n[key] === "string") expect(n[key].startsWith(PUBLIC_ORIGIN + "/"), `${label}: JSON-LD ${n["@type"]}.${key} is ${n[key]}, not under ${PUBLIC_ORIGIN}`)
    }
  }
  const orgNode = nodes.find((n) => n["@type"] === "Organization")
  expect(typeof orgNode?.logo === "string" && has(new URL(orgNode.logo).pathname.slice(1)), `${label}: Organization.logo is not a file in dist/`)
  if (page.jsonLd.includes("BreadcrumbList")) {
    const items = nodes.find((n) => n["@type"] === "BreadcrumbList")?.itemListElement ?? []
    expect(items.length === 2, `${label}: BreadcrumbList should be Home > this page, found ${items.length} item(s)`)
    items.forEach((it, i) => expect(it.position === i + 1 && typeof it.name === "string" && it.name.length > 0, `${label}: BreadcrumbList item ${i + 1} has the wrong position or no name`))
    expect(items[0]?.item === pageUrl("/") && items[items.length - 1]?.item === pageUrl(page.path), `${label}: BreadcrumbList does not run from ${pageUrl("/")} to ${pageUrl(page.path)}`)
  }
  const bad = priceKeys(nodes)
  expect(bad.length === 0, `${label}: JSON-LD carries price/offer keys (${bad.join(", ")}) -- owner rule: no price on public pages`)
  const rated = ratingKeys(nodes)
  expect(rated.length === 0, `${label}: JSON-LD carries rating/review keys (${rated.join(", ")}) -- WO-DPDP-013 v2 §2.1: no ratings`)
  if (page.jsonLd.includes("FAQPage")) {
    const questions = nodes.find((n) => n["@type"] === "FAQPage")?.mainEntity ?? []
    expect(questions.length > 0, `${label}: FAQPage has no mainEntity`)
    for (const q of questions) {
      expect(typeof q.name === "string" && text.includes(q.name), `${label}: FAQ question is not visible on the page: "${q.name}"`)
      const answer = q.acceptedAnswer?.text
      expect(typeof answer === "string" && text.includes(answer), `${label}: FAQ answer is not visible on the page for "${q.name}"`)
    }
  }

  // Complete HTML on arrival: the content never depends on a script. The only scripts allowed besides
  // JSON-LD are /ref.js (the partner-code keeper) then /rum.js (first-party monitoring), same origin,
  // deferred, each exactly once, in that order.
  const scripts = tagsOf(html, /<script\b[^>]*>/gi).filter((t) => !/type="application\/ld\+json"/i.test(t))
  expect(JSON.stringify(scripts) === JSON.stringify(scriptOpensFor(page.path)), `${label}: public page must have exactly the scripts ${JSON.stringify(scriptOpensFor(page.path))} besides JSON-LD, found ${JSON.stringify(scripts)}`)
  expect(has(REF_SCRIPT.src.slice(1)), `dist${REF_SCRIPT.src} missing`)
  expect(has(RUM_SCRIPT.src.slice(1)), `dist${RUM_SCRIPT.src} missing`)
  expect(has(VISIT_SCRIPT.src.slice(1)), `dist${VISIT_SCRIPT.src} missing`)
  expect(has(PWA_SCRIPT.src.slice(1)), `dist${PWA_SCRIPT.src} missing`)
  checkInstallable(label, html)
  checkFamilyFooter(label, html)
  if (page.path === "/") expect(has(THEME_SCRIPT.src.slice(1)), `dist${THEME_SCRIPT.src} missing`)
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
  // Served by a Pages Function (functions/<prefix>/*): no HTML in dist/ to
  // read; robots.txt / _headers / llms.txt below still cover the prefix.
  if (priv.source === null) continue
  if (!has(priv.source)) {
    expect(false, `${label}: dist/${priv.source} missing`)
    continue
  }
  const html = read(priv.source)
  expect(/<html\b[^>]*\slang="en-IN"/i.test(html), `${label}: <html lang="en-IN"> missing`)
  expect(meta(html, "name", "robots") === "noindex, nofollow", `${label}: <meta name="robots" content="noindex, nofollow"> missing`)
  expect(meta(html, "name", "referrer") === "no-referrer", `${label}: <meta name="referrer" content="no-referrer"> missing`)
  expect(linkHref(html, "canonical") === null, `${label}: a private page must not declare a canonical`)
  expect(!html.includes(RUM_SCRIPT.src), `${label}: a private page must never load ${RUM_SCRIPT.src} -- private pages are not measured`)
  expect(!html.includes(VISIT_SCRIPT.src), `${label}: a private page must never load ${VISIT_SCRIPT.src} -- the signed-in and private pages carry no visit tracking`)
  expect(!html.includes(PWA_SCRIPT.src), `${label}: a private page must never load ${PWA_SCRIPT.src} -- the public site's service worker is not for private pages`)
  expect(!html.includes(`href="${PWA.manifestPath}"`) && linkHref(html, "manifest") !== PWA.manifestPath, `${label}: a private page must not link the public manifest`)
  checkCrossOrigin(label, html)
}

// ----------------------------------------------------------------- legal pages
// The hand-kept legal pages in public/ (terms, privacy, ...): public, indexable, in the sitemap, measured
// by /rum.js, and carrying the company ownership line. Smaller rules than the generated pages.
for (const page of LEGAL_PAGES) {
  const label = page.path
  const out = page.source.replace(/^public\//, "")
  if (!has(out)) {
    expect(false, `${label}: dist/${out} missing`)
    continue
  }
  const html = read(out)
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? ""
  const description = meta(html, "name", "description")
  expect(/<html\b[^>]*\slang="en"/i.test(html), `${label}: <html lang> missing`)
  expect(title.length > 10 && title.length <= 70, `${label}: <title> "${title}" is empty or longer than 70 characters`)
  expect(!!description && description.length >= 60 && description.length <= 200, `${label}: meta description missing or not 60-200 characters`)
  expect(linkHref(html, "canonical") === pageUrl(page.path), `${label}: canonical is ${linkHref(html, "canonical")}, expected ${pageUrl(page.path)}`)
  expect(meta(html, "property", "og:url") === pageUrl(page.path), `${label}: og:url differs from the canonical`)
  expect(meta(html, "property", "og:title") === title && meta(html, "property", "og:description") === description, `${label}: og:title/og:description differ from the page's own`)
  expect(meta(html, "property", "og:image") === `${PUBLIC_ORIGIN}${OG_IMAGE.path}` && meta(html, "name", "twitter:card") === "summary_large_image", `${label}: Open Graph image / Twitter card missing`)
  const robotsMeta = meta(html, "name", "robots")
  expect(!robotsMeta || !/noindex|nofollow/i.test(robotsMeta), `${label}: PUBLIC legal page carries <meta name="robots" content="${robotsMeta}">`)
  const h1s = tagsOf(html, /<h1\b[^>]*>[\s\S]*?<\/h1>/gi)
  expect(h1s.length === 1 && textOf(h1s[0]) === page.h1, `${label}: expected exactly one <h1> reading "${page.h1}"`)
  const scripts = tagsOf(html, /<script\b[^>]*>/gi)
  expect(JSON.stringify(scripts) === JSON.stringify(LEGAL_SCRIPT_OPENS), `${label}: legal page must have exactly the scripts ${RUM_SCRIPT.tag} ${VISIT_SCRIPT.tag} ${PWA_SCRIPT.tag}, found ${JSON.stringify(scripts)}`)
  checkInstallable(label, html)
  checkFamilyFooter(label, html)
  const icon = linkHref(html, "icon")
  expect(!!icon && has(icon.slice(1)), `${label}: <link rel="icon"> ${icon} is not a file in dist/`)
  const footerHtml = /<footer[\s\S]*<\/footer>/i.exec(html)?.[0] ?? ""
  for (const s of COMPANY_FOOTER_COPY) expect(footerHtml.includes(s), `${label}: footer lacks the company line part "${s.slice(0, 60)}"`)
  checkCrossOrigin(label, html)
}

// ---------------------------------------------------------------- hidden pages
// WO-DPDP-013 v2 §2.1: built but hidden (/proof/ until the owner switches
// it on). Not a private prefix: noindex meta + X-Robots-Tag, no canonical,
// absent from the sitemap and llms*.txt (checked below), and still a
// complete no-script page like the public ones.
for (const hidden of HIDDEN_PAGES) {
  const label = `${hidden.prefix} (hidden)`
  if (!has(hidden.source)) {
    expect(false, `${label}: dist/${hidden.source} missing -- "built and hidden", not "not built"`)
    continue
  }
  const html = read(hidden.source)
  expect(/<html\b[^>]*\slang="en-IN"/i.test(html), `${label}: <html lang="en-IN"> missing`)
  expect(meta(html, "name", "robots") === "noindex, nofollow", `${label}: <meta name="robots" content="noindex, nofollow"> missing`)
  expect(linkHref(html, "canonical") === null, `${label}: a hidden page must not declare a canonical`)
  expect(meta(html, "property", "og:url") === null, `${label}: a hidden page must not carry Open Graph tags`)
  const scripts = tagsOf(html, /<script\b[^>]*>/gi).filter((t) => !/type="application\/ld\+json"/i.test(t))
  expect(JSON.stringify(scripts) === JSON.stringify(PUBLIC_SCRIPT_OPENS), `${label}: hidden page must have exactly the scripts ${REF_SCRIPT.tag} ${RUM_SCRIPT.tag} ${VISIT_SCRIPT.tag} ${PWA_SCRIPT.tag} besides JSON-LD, found ${JSON.stringify(scripts)}`)
  checkInstallable(label, html)
  checkFamilyFooter(label, html)
  checkCrossOrigin(label, html)
}

// ------------------------------------------------------------------ 404 page
// Cloudflare Pages answers an unknown address with 200 + the home page unless
// the build ships a root 404.html. Prove the file is in dist/, is noindex, has
// no canonical and no script, and that every internal link on it is a page
// that exists in dist/.
expect(has("404.html"), "dist/404.html missing -- unknown addresses would answer 200 with the home page instead of a real 404")
if (has("404.html")) {
  const html = read("404.html")
  expect(/<html\b[^>]*\slang="en-IN"/i.test(html), "404.html: <html lang=\"en-IN\"> missing")
  expect(meta(html, "name", "robots") === "noindex, nofollow", "404.html: <meta name=\"robots\" content=\"noindex, nofollow\"> missing")
  expect(linkHref(html, "canonical") === null, "404.html: a 404 page must not declare a canonical")
  expect(tagsOf(html, /<script\b[^>]*>/gi).length === 0, "404.html: must carry no script")
  checkCrossOrigin("404.html", html)
  for (const m of html.matchAll(/href="(\/[^"#?]*)"/g)) {
    const target = m[1]
    if (target === "/legal/legal.css" || target === "/favicon-48.png") { expect(has(target.slice(1)), `404.html: ${target} missing from dist/`); continue }
    expect(has(target === "/" ? "index.html" : target.replace(/^\//, "") + (target.endsWith("/") ? "index.html" : "")), `404.html links to ${target}, which is not in dist/`)
  }
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

// ------------------------------------------------------------ brand images
// The Open Graph card must really be a 1200x630 PNG (a wrong-sized or missing
// image makes a link preview fall back to nothing). PNG IHDR: width/height are
// the big-endian words at byte 16 and 20.
expect(has(OG_IMAGE.path.slice(1)), `dist${OG_IMAGE.path} missing`)
if (has(OG_IMAGE.path.slice(1))) {
  const png = readFileSync(join(dist, OG_IMAGE.path.slice(1)))
  const isPng = png.length > 24 && png.subarray(1, 4).toString("latin1") === "PNG"
  expect(isPng, `dist${OG_IMAGE.path} is not a PNG`)
  if (isPng) expect(png.readUInt32BE(16) === OG_IMAGE.width && png.readUInt32BE(20) === OG_IMAGE.height, `dist${OG_IMAGE.path} is ${png.readUInt32BE(16)}x${png.readUInt32BE(20)}, expected ${OG_IMAGE.width}x${OG_IMAGE.height}`)
}

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
      for (const pub of SITEMAP_PAGES) expect(!(d && pub.path.startsWith(d)), `robots.txt: Disallow: ${d} (${g.agents.join(", ")}) would block the public page ${pub.path}`)
    }
  }
  expect(sitemaps.length === 1 && sitemaps[0] === `${PUBLIC_ORIGIN}/sitemap.xml`, `robots.txt: Sitemap is ${JSON.stringify(sitemaps)}, expected ["${PUBLIC_ORIGIN}/sitemap.xml"]`)
}

// ----------------------------------------------------------------- sitemap.xml
expect(has("sitemap.xml"), "dist/sitemap.xml missing -- run scripts/build-sitemap.mjs after vite build")
if (has("sitemap.xml")) {
  const xml = read("sitemap.xml")
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  const want = SITEMAP_PAGES.map((p) => pageUrl(p.path))
  expect(locs.length === want.length && want.every((u) => locs.includes(u)), `sitemap.xml lists ${JSON.stringify(locs)}, expected exactly ${JSON.stringify(want)}`)
  for (const hidden of HIDDEN_PAGES) expect(!xml.includes(hidden.prefix), `sitemap.xml: names the hidden page ${hidden.prefix}`)
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
  for (const pub of SITEMAP_PAGES) {
    const h = resolveHeaders(rules, pub.path)
    expect(!h["x-robots-tag"], `_headers: PUBLIC ${pub.path} gets X-Robots-Tag "${h["x-robots-tag"]}"`)
    expect(h["referrer-policy"] === "strict-origin-when-cross-origin", `_headers: ${pub.path} gets Referrer-Policy "${h["referrer-policy"]}"`)
    expect(h["x-content-type-options"] === "nosniff", `_headers: ${pub.path} lacks X-Content-Type-Options: nosniff`)
    expect(h["x-frame-options"] === "DENY", `_headers: ${pub.path} lacks X-Frame-Options: DENY`)
    expect(h["content-security-policy"] === "frame-ancestors 'none'", `_headers: ${pub.path} gets Content-Security-Policy "${h["content-security-policy"]}" -- must be exactly frame-ancestors 'none'`)
    expect(h["permissions-policy"] === "camera=(), microphone=(), geolocation=()", `_headers: ${pub.path} lacks the Permissions-Policy that switches off camera, microphone and location`)
    expect(h["strict-transport-security"] === "max-age=31536000", `_headers: ${pub.path} lacks Strict-Transport-Security: max-age=31536000`)
    // HTML stays on the Pages default (revalidate); a public page must never be sent no-store or cached hard.
    expect(!h["cache-control"], `_headers: PUBLIC ${pub.path} gets Cache-Control "${h["cache-control"]}" -- public HTML is left on the default on purpose`)
  }
  // Hashed build output and the frozen fonts: cached for a year, immutable.
  for (const path of ["/assets/index-abc123.js", "/fonts/sora-latin-wght.woff2", "/original/fonts/x.woff2"]) {
    expect(resolveHeaders(rules, path)["cache-control"] === "public, max-age=31536000, immutable", `_headers: ${path} gets Cache-Control "${resolveHeaders(rules, path)["cache-control"]}"`)
  }
  for (const hidden of HIDDEN_PAGES) {
    for (const path of [hidden.prefix, `${hidden.prefix}index.html`]) {
      const h = resolveHeaders(rules, path)
      expect(h["x-robots-tag"] === "noindex, nofollow", `_headers: hidden ${path} gets X-Robots-Tag "${h["x-robots-tag"]}", expected "noindex, nofollow"`)
    }
  }
}

// ------------------------------------------------------------------- llms.txt
for (const f of ["llms.txt", "llms-full.txt"]) {
  expect(has(f), `dist/${f} missing`)
  if (!has(f)) continue
  const body = read(f)
  for (const pub of PUBLIC_PAGES) expect(body.includes(pageUrl(pub.path)), `${f}: does not list ${pageUrl(pub.path)}`)
  for (const priv of PRIVATE_PAGES) expect(!body.includes(pageUrl(priv.prefix)), `${f}: names the private URL ${pageUrl(priv.prefix)}`)
  for (const hidden of HIDDEN_PAGES) expect(!body.includes(hidden.prefix), `${f}: names the hidden page ${hidden.prefix}`)
  // Owner, 2026-10-01: no crawl-policy essay and no internal-process wording in the llms files.
  expect(!/no major search engine has confirmed/i.test(body), `${f}: still carries the crawl-policy note the owner removed`)
}
// Owner, 2026-10-01: the AI-only surfaces are withdrawn, not merely unlinked.
for (const gone of ["for-ai/index.html", "for-ai.md", "facts.json"]) expect(!has(gone), `dist/${gone} is a withdrawn surface (owner, 2026-10-01) but was built`)

// ----------------------------------------------------- IndexNow + monitoring
// The IndexNow key file (https://www.indexnow.org/documentation): a .txt named after the key whose body is the key.
const keyFiles = readdirSync(dist).filter((f) => /^[0-9a-f]{32}\.txt$/.test(f))
expect(keyFiles.length === 1, `dist/ should carry exactly one IndexNow key file (<32 hex>.txt), found ${JSON.stringify(keyFiles)}`)
for (const f of keyFiles) {
  expect(read(f).trim() === f.replace(/\.txt$/, ""), `${f}: the IndexNow key file body must equal its own name`)
  expect(!read("sitemap.xml").includes(f), `sitemap.xml names the IndexNow key file ${f}`)
}
// rum.js: the monitoring script must stay first-party, cookieless and query-string-free.
if (has("rum.js")) {
  const rum = read("rum.js")
  for (const bad of ["document.cookie", "localStorage", "sessionStorage", "indexedDB", "location.search", "location.hash", "XMLHttpRequest", "http://", "https://"]) {
    expect(!rum.includes(bad), `rum.js uses ${bad} -- the monitoring script must stay first-party, cookieless and query-string-free`)
  }
  expect(rum.includes('"/api/telemetry"'), "rum.js does not post to /api/telemetry")
  expect((rum.match(/sendBeacon\(/g) ?? []).length === 1, "rum.js must send through exactly one navigator.sendBeacon call")
  for (const prefix of PRIVATE_PAGES) expect(rum.includes(`"${prefix.prefix}"`), `rum.js does not refuse the private prefix ${prefix.prefix}`)
}

// visit.js: the visit-journey script must stay first-party and honour the privacy signal.
expect(has("visit.js"), "dist/visit.js missing")
if (has("visit.js")) {
  const v = read("visit.js")
  for (const bad of ["XMLHttpRequest", "fetch(", "http://", "https://", "sendImage", "new Image", "location.hash"]) {
    expect(!v.includes(bad), `visit.js uses ${bad} -- the visit script must stay first-party and send only through sendBeacon`)
  }
  expect(v.includes('"/api/visit"'), "visit.js does not post to /api/visit")
  expect((v.match(/sendBeacon\(/g) ?? []).length === 1, "visit.js must send through exactly one navigator.sendBeacon call")
  expect(v.includes("globalPrivacyControl") && v.includes("doNotTrack"), "visit.js does not check Global Privacy Control / Do Not Track")
  for (const prefix of PRIVATE_PAGES) expect(v.includes(`"${prefix.prefix}"`), `visit.js does not refuse the private prefix ${prefix.prefix}`)
}
// ------------------------------------------------------- installable app (2026-10-18)
// The public site's manifest, service worker, offline page and registration script. The signed-in /app/ keeps its own manifest and its own /app/sw.js.
expect(has("manifest.webmanifest"), "dist/manifest.webmanifest missing")
if (has("manifest.webmanifest")) {
  let man = null
  try { man = JSON.parse(read("manifest.webmanifest")) } catch (e) { expect(false, `manifest.webmanifest does not parse: ${e.message}`) }
  if (man) {
    expect(man.name === "VERIDIAN DPDP" && man.short_name === "VERIDIAN", "manifest.webmanifest: name / short_name wrong")
    expect(man.start_url === "/" && man.scope === "/" && man.id === "/", "manifest.webmanifest: id, start_url and scope must all be /")
    expect(man.display === "standalone" && man.theme_color === PWA.themeColor && man.lang === "en-IN" && !!man.background_color, "manifest.webmanifest: display / theme_color / lang / background_color wrong")
    const icons = Array.isArray(man.icons) ? man.icons : []
    for (const size of ["192x192", "512x512"]) {
      expect(icons.some((i) => i.sizes === size && i.type === "image/png" && (i.purpose ?? "any").includes("any")), `manifest.webmanifest: no ${size} PNG icon`)
      expect(icons.some((i) => i.sizes === size && i.purpose === "maskable"), `manifest.webmanifest: no ${size} maskable icon`)
    }
    for (const i of icons) {
      expect(typeof i.src === "string" && i.src.startsWith("/") && has(i.src.replace(/^\//, "").split("?")[0]), `manifest.webmanifest: icon ${i.src} is not a file in dist/`)
      const f = i.src.replace(/^\//, "").split("?")[0]
      if (has(f)) {
        const png = readFileSync(join(dist, f))
        const [w, h] = i.sizes.split("x").map(Number)
        expect(png.length > 24 && png.subarray(1, 4).toString("latin1") === "PNG" && png.readUInt32BE(16) === w && png.readUInt32BE(20) === h, `manifest.webmanifest: ${i.src} is not a real ${i.sizes} PNG`)
      }
    }
  }
}
expect(has("sw.js"), "dist/sw.js missing")
if (has("sw.js")) {
  const sw = read("sw.js")
  for (const priv of PRIVATE_PAGES) expect(sw.includes(`"${priv.prefix}"`), `sw.js does not name the private prefix ${priv.prefix} (it must pass it through untouched)`)
  expect(sw.includes("isPrivate(url.pathname)") && /if \(isPrivate\(url\.pathname\)\) return/.test(sw), "sw.js must return before respondWith for a private path")
  expect((sw.match(/cache\.add\(/g) ?? []).length === 1 && sw.includes('const OFFLINE = "/offline.html"'), "sw.js must precache exactly one file, /offline.html")
  for (const bad of ["addAll(", "cache.put(", ".put(", "XMLHttpRequest", "sendBeacon", "indexedDB", "localStorage", "document.cookie", "http://", "https://"]) {
    expect(!sw.includes(bad), `sw.js uses ${bad} -- the public worker keeps only the offline page and stores nothing else`)
  }
  expect(!/respondWith\(\s*caches\.match\(\s*req/.test(sw), "sw.js must not answer a request from the cache (offline page only, after a failed fetch)")
}
expect(has("offline.html"), "dist/offline.html missing")
if (has("offline.html")) {
  const html = read("offline.html")
  expect(meta(html, "name", "robots") === "noindex, nofollow", "offline.html: <meta name=\"robots\" content=\"noindex, nofollow\"> missing")
  expect(linkHref(html, "canonical") === null, "offline.html: must not declare a canonical")
  expect(tagsOf(html, /<script\b[^>]*>/gi).length === 0, "offline.html: must carry no script")
  expect(!/(?:src|href)="(?!\/favicon-48\.png|https:\/\/itservices-rajat-agarwal\.pages\.dev\/|\/")[^"]*"/.test(html.replace(/<link rel="icon"[^>]*>/, "")), "offline.html: must not depend on any file or address other than the icon, the home link and the seller link (it is shown with no network)")
  expect(!/<link\b[^>]*rel="stylesheet"/i.test(html), "offline.html: must use inline styles only (it is shown with no network)")
  const footerHtml = /<footer\b[\s\S]*<\/footer>/i.exec(html)?.[0] ?? ""
  for (const part of COMPANY_FOOTER_COPY) expect(footerHtml.includes(part), `offline.html: footer lacks the company line part "${part.slice(0, 60)}"`)
  expect(!read("sitemap.xml").includes("offline"), "sitemap.xml names the offline page")
}
expect(has("pwa.js"), "dist/pwa.js missing")
if (has("pwa.js")) {
  const p = read("pwa.js")
  for (const bad of ["document.cookie", "localStorage", "sessionStorage", "indexedDB", "fetch(", "XMLHttpRequest", "sendBeacon", "new Image", "http://", "https://"]) {
    expect(!p.includes(bad), `pwa.js uses ${bad} -- the registration script must stay first-party, with no network call, cookie or storage`)
  }
  expect(p.includes('register("/sw.js", { scope: "/" })'), "pwa.js must register /sw.js with scope /")
  expect(p.includes('"serviceWorker" in navigator'), "pwa.js must check for service-worker support")
  for (const prefix of PRIVATE_PAGES) expect(p.includes(`"${prefix.prefix}"`), `pwa.js does not refuse the private prefix ${prefix.prefix}`)
}
if (has("_headers")) {
  const rules = parseHeadersFile(read("_headers"))
  expect(resolveHeaders(rules, "/sw.js")["cache-control"] === "no-cache", `_headers: /sw.js gets Cache-Control "${resolveHeaders(rules, "/sw.js")["cache-control"]}", expected no-cache`)
  expect(/^public, max-age=\d{1,5}$/.test(resolveHeaders(rules, "/manifest.webmanifest")["cache-control"] ?? "") && Number((resolveHeaders(rules, "/manifest.webmanifest")["cache-control"] ?? "").split("=")[1]) <= 86400, "_headers: /manifest.webmanifest must get a short public Cache-Control (one day at most)")
  expect(resolveHeaders(rules, "/offline.html")["x-robots-tag"] === "noindex, nofollow", "_headers: /offline.html must be noindex")
  for (const path of ["/sw.js", "/manifest.webmanifest", "/pwa.js", "/offline.html"]) {
    expect(!PRIVATE_PAGES.some((p) => path.startsWith(p.prefix)), `${path} must not sit under a private prefix`)
  }
}

// --------------------------------------------------------------------- summary
if (failures.length) {
  console.error(`check-public-surface: FAIL -- ${failures.length} of ${checks} checks failed`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`check-public-surface: OK -- ${checks} checks passed across ${PUBLIC_PAGES.length} public, ${HIDDEN_PAGES.length} hidden and ${PRIVATE_PAGES.length} private page(s) in ${relative(process.cwd(), dist) || "."}`)
