// WO-DPDP-012 §0/§1/§3 for the STATIC host (dpdp.veridian-aios.com): the ONE
// list of what is public and what is private. robots.txt, _headers,
// llms.txt, the build-time sitemap, vite.config.ts's page inputs and the
// post-build check (scripts/check-public-surface.mjs) are all tested against
// this file, so none of them can drift from the others -- the same
// single-source pattern src/lib/dpdp-public-surface.ts uses on the Next.js
// side for veridian-aios.com's own /dpdp split. The two files are
// deliberately separate: they describe two different hosts.
//
// Plain ESM (.mjs), not .ts, on purpose: scripts/build-sitemap.mjs and
// scripts/check-public-surface.mjs run under plain `node` (like
// scan-bundle.mjs) and cannot import TypeScript. The sibling .d.mts carries
// the types for the bun test and tsc.
//
// Default is PRIVATE: a page is public only by being listed in PUBLIC_PAGES.
// WO-012 §0's own words on getting this wrong: it "is a DPDP breach by a
// DPDP product".
//
// WO-DPDP-013 v2 / WO-DPDP-014: the titles, the fact copy every public page
// must carry, and the /about/ page come from
// data/veridian-facts.yaml (via facts.mjs) -- never retyped here. A third
// category, HIDDEN_PAGES, is a page that is BUILT but not public yet
// (/proof/ until the owner switches facts.proof.enabled on): noindex, no
// canonical, X-Robots-Tag noindex, absent from the sitemap and llms*.txt,
// linked from nowhere -- but NOT a private prefix (no robots Disallow, so a
// crawler that finds it can still read the noindex).
import { loadFacts, pageTitle, subjectTopicsClause } from "./facts.mjs"

import { LEGACY_APP_ORIGIN, PUBLIC_ORIGIN, SITE_ORIGIN } from "./site-origin.mjs"
// SITE_ORIGIN is the signed-in app's host (kept for the /app/ bundle and the
// tests that pin it); PUBLIC_ORIGIN is the host every public page is
// indexed under -- canonical, og:url, sitemap, JSON-LD, llms.txt all use it.
export { LEGACY_APP_ORIGIN, PUBLIC_ORIGIN, SITE_ORIGIN }

export const FACTS = loadFacts()

/** The Open Graph / Twitter card image: a static branded PNG, 1200x630,
 * rendered from the brand wordmark + the brand line (scripts/make-og-image.html
 * is its source). Served from public/ at this path on the public origin. */
export const OG_IMAGE = {
  path: "/og-image.png",
  width: 1200,
  height: 630,
  alt: FACTS.brand.full,
}

/** The internal-link row every public page's footer carries. href -> link
 * text; the post-build check proves each href is in the raw HTML of each
 * public page. Owner decision 2026-10-01: About VERIDIAN alone -- the fact
 * sheet for AI systems, its plain-text copy and facts.json are withdrawn. */
export const FOOTER_LINKS = [["/about/", FACTS.pages["/about/"].name]]

// The copy generated from the facts file onto EVERY public page (the fact
// block, WO-013 §2.1; the brand line, WO-014 §2): the post-build check
// proves each string is in the raw HTML of each page.
const FACT_COPY = [
  FACTS.one_line,
  FACTS.fact_block_title,
  // "Who it is for" is two separate lines, an ordered list (owner, 2026-10-01).
  ...FACTS.who_for,
  ...FACTS.three_strongest_facts,
  FACTS.what_it_does_not_do,
  FACTS.brand.full,
  FACTS.brand.short,
  // The footer's internal links to the fact surfaces (SEO internal linking).
  ...FOOTER_LINKS.map(([href]) => `href="${href}"`),
]

/** The top-right of every public page's header (owner, 2026-10-01): "Sales
 * Partner" (the page that explains Refer & Earn) next to "Sign in". Both are
 * plain links with no script. The post-build check proves each string is in the
 * raw HTML of each page; src/lib/public-surface.test.ts proves they sit inside
 * the page's <header>, with Sales Partner immediately before Sign in. */
export const NAV_PARTNER = { href: "/partner/", label: FACTS.sales_partner.nav_label }
export const NAV_SIGN_IN = { href: "/app/", label: "Sign in" }
const HEADER_COPY = [`href="${NAV_PARTNER.href}">${NAV_PARTNER.label}</a>`, `class="nav-signin" href="${NAV_SIGN_IN.href}">${NAV_SIGN_IN.label}</a>`]
FACT_COPY.push(...HEADER_COPY)

/** Every crawler WO-012 §3 names. Each must appear as its own User-agent
 * line in robots.txt's public group. */
export const REQUIRED_BOTS = [
  "Googlebot",
  "Bingbot",
  "Applebot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
]

/** Private URL prefixes: never indexed, never crawled, no referrer, never
 * cached. `source` is the HTML entry (relative to dpdp-app/) that serves
 * the prefix, or null when a Cloudflare Pages Function serves it instead
 * (functions/<prefix>/*, no HTML of its own -- the function sets the same
 * headers itself, since _headers only applies to static assets). */
export const PRIVATE_PAGES = [
  { prefix: "/app/", source: "app/index.html" },
  // WO-DPDP-011 §2.3 / Step 5: the one-click confirmation page from the
  // Monday email (token in the #fragment), and the unsubscribe page.
  { prefix: "/act/", source: "act/index.html" },
  { prefix: "/unsubscribe/", source: "unsubscribe/index.html" },
  // The one-tap Copy page behind the "Copy" button in the Monday email's AI-prompt box (token in the #fragment): reads the person's
  // prompt from their own AI work link (GET /ai/<token>/prompt) and puts it on the clipboard.
  { prefix: "/copy/", source: "copy/index.html" },
  // WO-DPDP-011 §4: the parent consent page (consent token in the #fragment).
  { prefix: "/p/", source: "p/index.html" },
  // WO-DPDP-012 §7: the AI link's human-readable page, proxied from the
  // Edge Function by functions/ai/[token].ts so it is served with a real
  // text/html content-type from this host.
  { prefix: "/ai/", source: null },
]

// Copy on BOTH edition landing pages (rewritten 2026-10-01: plain English,
// short sentences, one call to action). The post-build check proves each
// string is in the RAW html file -- WO-012 §1: "readable with JavaScript
// switched off ... prove it".
const LANDING_COPY = [
  "Compliance due 13 May 2027",
  "How it works",
  "What you get",
  "What we do, and where we stop",
  "Turn the Act into jobs · Give each job to a person · Chase the answers · Keep a dated record",
  "Touch your systems · Keep your documents · Give legal advice · Certify you as compliant · Promise that nobody will be fined",
  "Questions people ask",
  "One email. No card. Fifteen minutes.",
  "Jobs with names and dates",
  "A record nobody can edit",
  "We keep no documents",
  "People answer by email",
  "Do you touch our systems?",
  "Do you keep our documents?",
  "Can you certify us as compliant?",
  "Has anyone been fined yet?",
  "No penalty order has been issued in India to date.",
  "Sign in",
  // The one published address and the ask to name the topic in the subject
  // line. Since 2026-09-29 (owner decision) there is no separate
  // grievance@ / partners@ address; both landings' hand-kept footers carry
  // these strings, built from the facts file so they cannot drift from it.
  FACTS.contact.contact_email,
  subjectTopicsClause(FACTS),
  FACTS.storage.stored_in_india_wording,
  "We are not a law firm and this is not legal advice. No DPDP certification exists in India and we do not offer one.",
]

/**
 * Every public page. `path` is the URL path WITH a trailing slash (Cloudflare
 * Pages serves dir/index.html at dir/ and 308-redirects the slash-less form,
 * so the canonical is the slashed one). `source` is the HTML file relative
 * to dpdp-app/ -- Vite keeps that relative path in dist/, and the sitemap's
 * lastmod is that file's last git commit. `title`/`h1` are exact;
 * `mustContain` is copy that must be present in the raw file; `jsonLd` is
 * the exact set of schema.org types the page's JSON-LD must carry (WO-012
 * §4: Organization + WebSite everywhere, SoftwareApplication on the
 * landings, FAQPage only where the page has a real FAQ block).
 */
export const PUBLIC_PAGES = [
  {
    path: "/",
    source: "index.html",
    title: pageTitle(FACTS, "/"),
    h1: "The DPDP Act asks every organisation for four things",
    jsonLd: ["Organization", "WebSite", "SoftwareApplication"],
    mustContain: [
      "VERy INDIAN",
      // The four things, numbered 1-4 (owner, 2026-10-01): exactly the facts file's list.
      ...FACTS.four_things,
      // Exactly two ways in, with exactly these labels (owner, 2026-10-01).
      "I AM A CA / CS / LEGAL / AUDIT FIRM — DOING FOR MY CLIENTS",
      "I AM A COMPANY / INSTITUTION / SCHOOL / NGO — DOING FOR OURSELVES",
      'href="/dpdp-firm/"',
      'href="/dpdp-institution/"',
      "Already have an account? Sign in",
      FACTS.brand.share_ask,
      ...FACT_COPY,
    ],
  },
  {
    path: "/dpdp-firm/",
    source: "dpdp-firm/index.html",
    title: pageTitle(FACTS, "/dpdp-firm/"),
    h1: "DPDP compliance for all your clients, in one place",
    jsonLd: ["Organization", "WebSite", "SoftwareApplication", "BreadcrumbList", "FAQPage"],
    mustContain: [
      "For CA, CS, audit and legal firms",
      "Give each client a list of jobs. Chase the answers by email. Keep a dated record nobody can edit.",
      "Your own firm's file is free. No licence fee. You pay per client file, after you have billed the client.",
      "Add each client",
      "Every client has its own file",
      "Checks and sign-off",
      "Start with one client",
      'href="/app/?edition=firm"',
      ...LANDING_COPY,
      FACTS.brand.share_ask,
      ...FACT_COPY,
    ],
  },
  {
    path: "/dpdp-institution/",
    source: "dpdp-institution/index.html",
    title: pageTitle(FACTS, "/dpdp-institution/"),
    h1: "DPDP compliance for your own organisation, with proof you can show",
    jsonLd: ["Organization", "WebSite", "SoftwareApplication", "BreadcrumbList", "FAQPage"],
    mustContain: [
      "For companies, institutions, schools and NGOs",
      "Get a list of jobs. Give each job to a person. Keep a dated record nobody can edit.",
      "Pricing after a short conversation, because the right number depends on what you hold.",
      "Open your organisation",
      "Parents' consent, on a link",
      "Start with what you hold",
      'href="/app/?edition=institution"',
      ...LANDING_COPY,
      FACTS.brand.share_ask,
      ...FACT_COPY,
    ],
  },
  // WO-DPDP-013 v2 §2.1: the full facts for people. Generated by
  // scripts/generate-public-facts.mjs from data/veridian-facts.yaml.
  {
    path: "/about/",
    source: "about/index.html",
    title: pageTitle(FACTS, "/about/"),
    h1: FACTS.pages["/about/"].name,
    jsonLd: ["Organization", "WebSite", "SoftwareApplication", "BreadcrumbList"],
    mustContain: [
      FACTS.deadline_line,
      FACTS.storage.database.sentence,
      FACTS.storage.email.sentence,
      FACTS.storage.website.sentence,
      FACTS.ai_work_link_public_sentence,
      FACTS.contact.contact_email,
      subjectTopicsClause(FACTS),
      FACTS.brand.share_ask,
      ...FACT_COPY,
    ],
  },
]
// Owner, 2026-10-01: the Sales Partner page, the public explanation of the
// in-app Refer & Earn. Generated by scripts/generate-public-facts.mjs from
// data/veridian-facts.yaml (sales_partner). Public and indexable; its primary
// button opens the sign-in at /app/ (which stays private).
PUBLIC_PAGES.push({
  path: "/partner/",
  source: "partner/index.html",
  title: pageTitle(FACTS, "/partner/"),
  h1: FACTS.pages["/partner/"].name,
  jsonLd: ["Organization", "WebSite", "SoftwareApplication", "BreadcrumbList"],
  mustContain: [
    FACTS.sales_partner.lead,
    FACTS.sales_partner.sign_in_note,
    `class="btn" href="/app/">${FACTS.sales_partner.button}</a>`,
    ...FACTS.sales_partner.sections.map((s) => s.h2),
    FACTS.contact.contact_email,
    subjectTopicsClause(FACTS),
    FACTS.brand.share_ask,
    ...FACT_COPY,
  ],
})

/** The /proof/ page (WO-013 §2.1): public once facts.proof.enabled is true,
 * otherwise built-and-hidden (see HIDDEN_PAGES). */
const PROOF_PAGE = {
  path: "/proof/",
  source: "proof/index.html",
  title: pageTitle(FACTS, "/proof/"),
  h1: FACTS.pages["/proof/"].name,
  jsonLd: ["Organization", "WebSite", "SoftwareApplication", "BreadcrumbList"],
  mustContain: [FACTS.brand.share_ask, ...FACT_COPY],
}
if (FACTS.proof.enabled) PUBLIC_PAGES.push(PROOF_PAGE)

/** Built but hidden: noindex meta + X-Robots-Tag, no canonical, not in the
 * sitemap or llms*.txt, linked from nowhere. Not a private prefix. */
export const HIDDEN_PAGES = FACTS.proof.enabled ? [] : [{ prefix: PROOF_PAGE.path, source: PROOF_PAGE.source }]

export function pageUrl(path) {
  return PUBLIC_ORIGIN + path
}

// sitemaps.org's <lastmod> is a W3C datetime: a date, or a date-time with a
// zone. `git log -1 --format=%cI` (strict ISO 8601) satisfies the second form.
const W3C_DATETIME = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/

export function isW3cDatetime(s) {
  return W3C_DATETIME.test(s)
}

function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

/**
 * The sitemap text for exactly the public pages -- every one of them, no
 * private path, no duplicate, every lastmod a real W3C datetime. Throws
 * rather than emitting a sitemap that says something this file does not.
 */
export function renderSitemap(entries) {
  const seen = new Set()
  for (const { path, lastmod } of entries) {
    if (!PUBLIC_PAGES.some((p) => p.path === path)) throw new Error(`renderSitemap: ${path} is not a public page`)
    if (seen.has(path)) throw new Error(`renderSitemap: ${path} listed twice`)
    if (!isW3cDatetime(lastmod)) throw new Error(`renderSitemap: lastmod "${lastmod}" for ${path} is not a W3C datetime`)
    seen.add(path)
  }
  for (const p of PUBLIC_PAGES) if (!seen.has(p.path)) throw new Error(`renderSitemap: public page ${p.path} is missing`)

  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
  for (const { path, lastmod } of entries) {
    lines.push("  <url>", `    <loc>${escapeXml(pageUrl(path))}</loc>`, `    <lastmod>${lastmod}</lastmod>`, "  </url>")
  }
  lines.push("</urlset>", "")
  return lines.join("\n")
}

/**
 * robots.txt, per RFC 9309: consecutive User-agent lines open one group;
 * Allow/Disallow lines belong to the group above them; Sitemap lines are
 * global. Comments (#) are stripped. Enough of the grammar for this site's
 * own file -- not a general parser.
 */
export function parseRobots(text) {
  const groups = []
  const sitemaps = []
  let current = null
  let lastWasAgent = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim()
    if (!line) continue
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line)
    if (!m) continue
    const field = m[1].toLowerCase()
    const value = m[2].trim()
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] }
        groups.push(current)
      }
      current.agents.push(value)
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (field === "sitemap") {
      sitemaps.push(value)
      continue
    }
    if (!current) continue
    if (field === "allow") current.allow.push(value)
    else if (field === "disallow") current.disallow.push(value)
  }
  return { groups, sitemaps }
}

/**
 * Cloudflare Pages' `_headers` file: an unindented line starts a rule (a
 * URL pattern); indented `Name: value` lines attach headers to it; an
 * indented `! Name` line detaches a header that a broader rule attached.
 */
export function parseHeadersFile(text) {
  const rules = []
  let current = null
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    if (/^\s/.test(raw)) {
      if (!current) continue
      if (trimmed.startsWith("! ")) {
        current.unset.push(trimmed.slice(2).trim())
        continue
      }
      const i = trimmed.indexOf(":")
      if (i === -1) continue
      current.set.push([trimmed.slice(0, i).trim(), trimmed.slice(i + 1).trim()])
    } else {
      current = { path: trimmed, set: [], unset: [] }
      rules.push(current)
    }
  }
  return rules
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Only the pattern features this site's own _headers uses: literal segments
// and a splat, which Cloudflare documents as greedily matching any run of
// characters (its own site-wide example is `/*`, so an empty run counts).
function matchesPagesPattern(pattern, path) {
  const re = new RegExp("^" + pattern.split("*").map(escapeRegExp).join(".*") + "$")
  return re.test(path)
}

/**
 * The headers Cloudflare Pages would send for `path`, following its
 * documented merge rules: every matching rule applies in file order, a
 * request inherits all of them, `! Name` detaches, and a name attached
 * twice is comma-joined (which is exactly why the private rule must
 * detach the site-wide Referrer-Policy before setting its own). Keys are
 * lower-cased -- header names are case-insensitive.
 */
export function resolveHeaders(rules, path) {
  const out = new Map()
  for (const rule of rules) {
    if (!matchesPagesPattern(rule.path, path)) continue
    for (const name of rule.unset) out.delete(name.toLowerCase())
    for (const [name, value] of rule.set) {
      const key = name.toLowerCase()
      out.set(key, out.has(key) ? `${out.get(key)}, ${value}` : value)
    }
  }
  return Object.fromEntries(out)
}
