// WO-DPDP-012 §0/§1/§3 for the STATIC host (app.veridian-aios.com): the ONE
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
// must carry, and the /about/ and /for-ai/ pages come from
// data/veridian-facts.yaml (via facts.mjs) -- never retyped here. A third
// category, HIDDEN_PAGES, is a page that is BUILT but not public yet
// (/proof/ until the owner switches facts.proof.enabled on): noindex, no
// canonical, X-Robots-Tag noindex, absent from the sitemap and llms*.txt,
// linked from nowhere -- but NOT a private prefix (no robots Disallow, so a
// crawler that finds it can still read the noindex).
import { loadFacts, pageTitle } from "./facts.mjs"

import { SITE_ORIGIN } from "./site-origin.mjs"
export { SITE_ORIGIN }

export const FACTS = loadFacts()

// The copy generated from the facts file onto EVERY public page (the fact
// block, WO-013 §2.1; the brand line, WO-014 §2): the post-build check
// proves each string is in the raw HTML of each page.
const FACT_COPY = [
  FACTS.one_line,
  ...FACTS.three_strongest_facts,
  FACTS.what_it_does_not_do,
  FACTS.brand.full,
  FACTS.brand.short,
]

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
  // WO-DPDP-011 §4: the parent consent page (consent token in the #fragment).
  { prefix: "/p/", source: "p/index.html" },
  // WO-DPDP-012 §7: the AI link's human-readable page, proxied from the
  // Edge Function by functions/ai/[token].ts so it is served with a real
  // text/html content-type from this host.
  { prefix: "/ai/", source: null },
]

// Copy shared by both edition landing pages, verbatim from
// src/app/dpdp/_components/DpdpMarketingPage.tsx on the Next.js side. The
// post-build check proves each string is in the RAW html file -- WO-012 §1:
// "readable with JavaScript switched off ... prove it".
const LANDING_COPY = [
  "Compliance due 13 May 2027",
  "The Schedule to the Act",
  "Ceilings per instance · the Board decides under S.33 ·",
  "no penalty order has been issued in India to date",
  "Everything DPDP, in one place",
  "And the two things the law already requires you to publish are free, forever.",
  "Where your data actually is",
  "A Grievance Officer, published",
  "Your own public page",
  "One email a day, and it is the dashboard",
  "An AI Link for any chatbox",
  "Proof that survives people",
  "We never keep your documents",
  "Deleting somebody, everywhere",
  "Consent that people actually give",
  "72 hours, planned in advance",
  "Auditors and cyber firms, listed",
  "Your vendors, in the same system",
  "What we do, and where we stop",
  "Said plainly, because the people selling fear will not.",
  "Write down what you hold and where · turn the Act into duties with names and dates · chase them · check the proof · publish your officer and your notices · keep a record nobody can edit · answer people who ask",
  "Touch your systems · keep your documents · certify you as compliant · give legal advice · quote penalties at you · promise nobody will ever be fined",
  "Four ways in",
  "Pricing after a short conversation, because the right number depends on what you hold.",
  "A company, school or NGO",
  "A CA, CS, audit or legal firm",
  "A web agency, payroll bureau or IT firm",
  "An auditor or cyber firm",
  "Questions people actually ask",
  "We run on Gmail. Does that matter?",
  "Has anybody actually been fined?",
  "We are small. Does this apply to us?",
  "Do you touch our systems?",
  "Do you keep our documents?",
  "Can you certify us as compliant?",
  "What if we stop paying?",
  "What happens if you disappear?",
  "Start with what you hold",
  "One email. No card. Fifteen minutes.",
  "Your DPDP proof — not just your DPDP policy. People move on. The proof stays.",
  "grievance@veridian-aios.com",
  "partners@veridian-aios.com",
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
      "Know what data you hold. Tell people about it. Keep it safe.",
      "Prove all three — with a record that outlasts the person who set it up.",
      "I do this for clients",
      "A CA, CS, audit or legal firm. Your own file is free, always.",
      "I do this for us",
      "A company, NGO or firm of our own.",
      "Running a school instead? →",
      "Already have an account? Sign in",
      FACTS.brand.share_ask,
      ...FACT_COPY,
    ],
  },
  {
    path: "/dpdp-firm/",
    source: "dpdp-firm/index.html",
    title: pageTitle(FACTS, "/dpdp-firm/"),
    h1: "Your DPDP proof — not just your DPDP policy.",
    jsonLd: ["Organization", "WebSite", "SoftwareApplication", "FAQPage"],
    mustContain: [
      "an independent, third-party DPDP compliance record",
      "Built for a company, NGO, trading firm or a CA/CS/audit practice's own file.",
      ...LANDING_COPY,
      FACTS.brand.share_ask,
      ...FACT_COPY,
    ],
  },
  {
    path: "/dpdp-institution/",
    source: "dpdp-institution/index.html",
    title: pageTitle(FACTS, "/dpdp-institution/"),
    h1: "Your DPDP proof — not just a policy nobody reads.",
    jsonLd: ["Organization", "WebSite", "SoftwareApplication", "FAQPage"],
    mustContain: [
      "an independent, third-party DPDP compliance record for schools",
      "Built for a school handling students', parents' and staff's data — most of it belonging to minors.",
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
    jsonLd: ["Organization", "WebSite", "SoftwareApplication"],
    mustContain: [
      FACTS.what_it_does,
      FACTS.deadline_line,
      FACTS.storage.database.sentence,
      FACTS.storage.email.sentence,
      FACTS.storage.website.sentence,
      FACTS.ai_work_link_public_sentence,
      FACTS.contact.grievance_officer_email,
      FACTS.brand.share_ask,
      ...FACT_COPY,
    ],
  },
  // WO-DPDP-013 v2 §2.1: the fact sheet for AI systems (+ /for-ai.md). No
  // share ask here (WO-014 §4: the share ask is for people on pages, never an
  // instruction to an AI) -- scripts/check-two-doors.mjs proves it.
  {
    path: "/for-ai/",
    source: "for-ai/index.html",
    title: pageTitle(FACTS, "/for-ai/"),
    h1: FACTS.pages["/for-ai/"].name,
    jsonLd: ["Organization", "WebSite", "SoftwareApplication"],
    mustContain: [
      FACTS.what_it_does,
      FACTS.deadline_line,
      FACTS.storage.database.sentence,
      FACTS.storage.email.sentence,
      FACTS.ai_work_link_public_sentence,
      ...FACT_COPY,
    ],
  },
]

/** The /proof/ page (WO-013 §2.1): public once facts.proof.enabled is true,
 * otherwise built-and-hidden (see HIDDEN_PAGES). */
const PROOF_PAGE = {
  path: "/proof/",
  source: "proof/index.html",
  title: pageTitle(FACTS, "/proof/"),
  h1: FACTS.pages["/proof/"].name,
  jsonLd: ["Organization", "WebSite", "SoftwareApplication"],
  mustContain: [FACTS.brand.share_ask, ...FACT_COPY],
}
if (FACTS.proof.enabled) PUBLIC_PAGES.push(PROOF_PAGE)

/** Built but hidden: noindex meta + X-Robots-Tag, no canonical, not in the
 * sitemap or llms*.txt, linked from nowhere. Not a private prefix. */
export const HIDDEN_PAGES = FACTS.proof.enabled ? [] : [{ prefix: PROOF_PAGE.path, source: PROOF_PAGE.source }]

export function pageUrl(path) {
  return SITE_ORIGIN + path
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
