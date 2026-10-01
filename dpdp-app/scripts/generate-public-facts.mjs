#!/usr/bin/env node
// WO-DPDP-013 v2 Part 2 (the outside door) + WO-DPDP-014 (the brand line):
// generate every public fact surface from data/veridian-facts.yaml -- never
// hand-written twice.
//
//   node scripts/generate-public-facts.mjs          write every surface
//   node scripts/generate-public-facts.mjs --check  exit 1 if any surface on
//                                                   disk differs from what
//                                                   would be generated (this
//                                                   is what `bun run build`
//                                                   runs: the facts changed,
//                                                   regenerate and commit)
//
// What it writes (all relative to dpdp-app/):
//   about/index.html          the full facts for people
//   partner/index.html        the Sales Partner page (the public face of the
//                             in-app Refer & Earn), from facts.sales_partner
//   ai-assistant/index.html   the free AI assistant page, from facts.ai_assistant
//                             (the home page's highlight is the generated block
//                             "ai-assistant" in index.html)
//   proof/index.html          from data/proof.yaml; noindex + hidden until
//                             facts.proof.enabled is true
//   public/llms.txt           short: what the home page says, plus the list of
//                             public pages
//   public/llms-full.txt      the visible text of every public page, taken
//                             from the generated pages themselves
//   (2026-10-01, owner decision: /for-ai/, /for-ai.md and /facts.json are no
//   longer published; nothing here generates them.)
//   index.html, dpdp-firm/index.html, dpdp-institution/index.html
//                             ONLY between the marker comments
//                             <!-- BEGIN generated: X --> ... <!-- END generated: X -->
//                             (X = brand-line, facts, footer-links, and on the home
//                             page ai-assistant), plus <title>, the meta
//                             description, og:title / og:description and the
//                             Organization + WebSite + SoftwareApplication +
//                             BreadcrumbList nodes of the JSON-LD (a landing's
//                             FAQPage is left as it is), the canonical and
//                             og:url, and the Open Graph image / Twitter card /
//                             favicon tags. Everything else on those pages is the
//                             owner's landing copy and is not touched.
//   public/_headers           ONLY between "# BEGIN generated: proof" and
//                             "# END generated: proof": the X-Robots-Tag
//                             noindex rule for /proof/* while it is hidden.
//
// Emitted pages carry NO descriptive HTML comment (owner, 2026-10-01: view-source
// must not name internal files or work orders); only the BEGIN/END markers and
// the email_off markers remain.
//
// Output is byte-stable across runs (no dates but the ones in the facts
// file), which is what makes --check meaningful. Plain Node, one dependency
// (yaml, via src/lib/facts.mjs).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { APP_DIR, contactSentence, grievanceOfficerLine, loadClaims, loadFacts, loadProof, pageDescription, pageTitle, subjectTopicsClause } from "../src/lib/facts.mjs"
import { FOOTER_LINKS, HIDDEN_PAGES, NAV_AI, NAV_PARTNER, NAV_SIGN_IN, OG_IMAGE, PUBLIC_ORIGIN, PUBLIC_PAGES, REF_SCRIPT, pageUrl } from "../src/lib/public-surface.mjs"

const SELF = fileURLToPath(import.meta.url)

// ------------------------------------------------------------------ helpers
export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

// The public pages are indexed under the apex (PUBLIC_ORIGIN), so the JSON-LD
// @ids and urls say so too. The signed-in app host (SITE_ORIGIN) appears on
// no public page.
const ORG_ID = `${PUBLIC_ORIGIN}/#organization`
const WEBSITE_ID = `${PUBLIC_ORIGIN}/#website`
const LOGO_URL = `${PUBLIC_ORIGIN}/logo.png`
const ICON_PATH = "/favicon-48.png"

/** The three "not yet" renderings. Never a number, never a name, when the
 * facts file says null. */
const orNotRecorded = (v) => (v === null || v === undefined ? "not yet recorded" : String(v))

// The handful of entities the landings use (same table as
// scripts/check-public-surface.mjs).
export function decodeEntities(s) {
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

/**
 * The visible text of a page as lines (llms-full.txt): scripts, styles, the
 * brand line and the nav dropped; headings, list items and block elements
 * become their own lines; inline tags become spaces; entities decoded.
 * Used for llms-full.txt AND by scripts/check-claims.mjs, so what the
 * checker sees is what an assistant reading llms-full.txt sees.
 */
export function visibleLines(html, { keepBrandLine = false, keepNav = false } = {}) {
  let body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html
  body = body.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ")
  if (!keepBrandLine) body = body.replace(/<div class="brand-line"[\s\S]*?<\/div>/i, " ")
  if (!keepNav) body = body.replace(/<header class="nav"[\s\S]*?<\/header>/i, " ")
  // Source whitespace (a heading wrapped over two lines) is not a line break.
  const text = body
    .replace(/\s+/g, " ")
    // An ordered list keeps its numbers: "1. ...", "2. ..." (the other lists are "- ...").
    .replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_, inner) => {
      let n = 0
      return "\n" + inner.replace(/<li\b[^>]*>/gi, () => `\n${++n}. `) + "\n"
    })
    .replace(/<h1\b[^>]*>/gi, "\n# ")
    .replace(/<h2\b[^>]*>/gi, "\n## ")
    .replace(/<h3\b[^>]*>/gi, "\n### ")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<(?:p|div|section|footer|main|ul|ol|dl|dt|dd|hr|table|tr)\b[^>]*>/gi, "\n")
    .replace(/<\/(?:h[1-6]|p|div|section|footer|main|ul|ol|li|dl|dt|dd|table|tr|td|th)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
  return decodeEntities(text)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    // Drop empty lines and lines with no letter or digit at all (a card's
    // decorative emoji on its own line).
    .filter((l) => /[\p{L}\p{N}]/u.test(l))
}

// ------------------------------------------------------------ page pieces
function brandLine(facts, { shareAsk }) {
  const share = shareAsk ? `<a class="brand-line-share" href="${esc(facts.brand.share_url)}">${esc(facts.brand.share_ask)}</a>` : ""
  return [
    `<div class="brand-line">`,
    `  <p class="brand-line-text"><span class="brand-line-full">${esc(facts.brand.full)}</span><span class="brand-line-short">${esc(facts.brand.short)}</span></p>`,
    ...(share ? [`  ${share}`] : []),
    `</div>`,
  ].join("\n")
}

/** The visible fact block (WO-013 §2.1): one line, who it is for, three
 * strongest facts, one line of what it does not do. The same HTML on every
 * page, for humans and bots alike. */
function factBlock(facts, { compact = false } = {}) {
  return [
    `<section class="facts${compact ? " facts-compact" : ""}" aria-labelledby="facts-title">`,
    `  <h2 class="facts-title" id="facts-title">${esc(facts.fact_block_title)}</h2>`,
    `  <p class="facts-line">${esc(facts.one_line)}</p>`,
    // Two separate lines, an ordered list 1. 2. (owner, 2026-10-01) -- never one dotted line.
    `  <div class="facts-for">`,
    `    <b>Who it is for:</b>`,
    `    <ol class="facts-for-list">`,
    ...facts.who_for.map((w) => `      <li>${esc(w)}</li>`),
    `    </ol>`,
    `  </div>`,
    `  <ul class="facts-list">`,
    ...facts.three_strongest_facts.map((f) => `    <li>${esc(f)}</li>`),
    `  </ul>`,
    `  <p class="facts-not">${esc(facts.what_it_does_not_do)}</p>`,
    `  <p class="facts-links"><a href="/about/">${esc(facts.pages["/about/"].name)}</a></p>`,
    `</section>`,
  ].join("\n")
}

function organizationNode(facts) {
  const node = {
    "@type": "Organization",
    "@id": ORG_ID,
    name: "VERIDIAN",
    url: facts.company_site,
    logo: LOGO_URL,
    // One address, one ContactPoint per topic a sender may name in the
    // subject line (contact.subject_topics). "Grievance" keeps its old
    // contactType, "Grievance Officer".
    contactPoint: facts.contact.subject_topics.map((topic) => ({
      "@type": "ContactPoint",
      contactType: topic === "Grievance" ? "Grievance Officer" : topic,
      email: facts.contact.contact_email,
    })),
  }
  if (facts.company.legal_name) node.legalName = facts.company.legal_name
  if (facts.company.registered_office) node.address = { "@type": "PostalAddress", streetAddress: facts.company.registered_office, addressCountry: "IN" }
  return node
}

function websiteNode() {
  return { "@type": "WebSite", "@id": WEBSITE_ID, name: "VERIDIAN DPDP", url: `${PUBLIC_ORIGIN}/`, inLanguage: "en-IN", publisher: { "@id": ORG_ID } }
}

/** Home > this page, for every public page except the root (a one-item trail
 * on the home page adds nothing). The names are the facts file's page names,
 * the same words as the tab title and the nav. */
function breadcrumbNode(facts, path) {
  if (path === "/") return null
  return {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: pageUrl("/") },
      { "@type": "ListItem", position: 2, name: facts.pages[path].name, item: pageUrl(path) },
    ],
  }
}

/** The schema.org nodes for a page, in a fixed order; `extra` (a landing's
 * FAQPage) goes last. */
function pageNodes(facts, path, extra = []) {
  return [organizationNode(facts), websiteNode(), softwareNode(facts, path), breadcrumbNode(facts, path), ...extra].filter(Boolean)
}

/** Open Graph image + Twitter card + the favicon: the same lines on every
 * indexable page, built from OG_IMAGE (public-surface.mjs). The card text
 * repeats the page's own title and description. */
function socialLines(facts, { title, description }) {
  const image = `${PUBLIC_ORIGIN}${OG_IMAGE.path}`
  return [
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta property="og:image:width" content="${OG_IMAGE.width}" />`,
    `<meta property="og:image:height" content="${OG_IMAGE.height}" />`,
    `<meta property="og:image:alt" content="${esc(OG_IMAGE.alt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
    `<meta name="twitter:image:alt" content="${esc(OG_IMAGE.alt)}" />`,
    `<link rel="icon" type="image/png" sizes="48x48" href="${ICON_PATH}" />`,
  ]
}

// WO-013 §2.1: category, audience, Web browser; no price, no ratings.
function softwareNode(facts, path) {
  return {
    "@type": "SoftwareApplication",
    name: facts.product,
    url: pageUrl(path),
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web browser",
    inLanguage: "en-IN",
    description: facts.one_line,
    audience: { "@type": "Audience", audienceType: facts.pages[path].audience },
    publisher: { "@id": ORG_ID },
  }
}

const jsonLdScript = (nodes, indent = "    ") => {
  const body = JSON.stringify({ "@context": "https://schema.org", "@graph": nodes }, null, 2)
    .split("\n")
    .map((l) => indent + l)
    .join("\n")
  return `<script type="application/ld+json">\n${body}\n${indent}</script>`
}

function head(facts, { path, title, description, nodes, hidden = false }) {
  const lines = [
    `<meta charset="utf-8" />`,
    `<meta name="viewport" content="width=device-width, initial-scale=1" />`,
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
  ]
  if (hidden) {
    // Built and hidden (WO-013 §2.1): no canonical, noindex, no Open Graph.
    lines.push(`<meta name="robots" content="noindex, nofollow" />`)
  } else {
    lines.push(
      `<link rel="canonical" href="${esc(pageUrl(path))}" />`,
      `<meta property="og:type" content="website" />`,
      `<meta property="og:site_name" content="VERIDIAN DPDP" />`,
      `<meta property="og:locale" content="en_IN" />`,
      `<meta property="og:url" content="${esc(pageUrl(path))}" />`,
      `<meta property="og:title" content="${esc(title)}" />`,
      `<meta property="og:description" content="${esc(description)}" />`,
      ...socialLines(facts, { title, description }),
    )
  }
  lines.push(
    `<link rel="preload" href="/fonts/sora-latin-wght.woff2" as="font" type="font/woff2" crossorigin />`,
    `<link rel="preload" href="/fonts/instrument-sans-latin-wght.woff2" as="font" type="font/woff2" crossorigin />`,
    `<link rel="stylesheet" href="/src/site.css" />`,
    REF_SCRIPT.tag,
    jsonLdScript(nodes),
  )
  return lines.map((l) => "    " + l).join("\n")
}

/** The top-right of the header on every public page: the "Free AI assistant"
 * pill, then "Sales Partner" (the page that explains Refer & Earn), then "Sign in"
 * (owner, 2026-10-01). The three hand-kept pages (/, /dpdp-firm/,
 * /dpdp-institution/) carry the same links in their own headers;
 * src/lib/public-surface.test.ts proves they agree. */
function navActions(current) {
  return [
    `<div class="nav-actions">`,
    `  <a class="nav-ai"${current === NAV_AI.href ? ' aria-current="page"' : ""} href="${NAV_AI.href}">${esc(NAV_AI.label)}</a>`,
    `  <a class="nav-partner"${current === NAV_PARTNER.href ? ' aria-current="page"' : ""} href="${NAV_PARTNER.href}">${esc(NAV_PARTNER.label)}</a>`,
    `  <a class="nav-signin" href="${NAV_SIGN_IN.href}">${esc(NAV_SIGN_IN.label)}</a>`,
    `</div>`,
  ]
}

function nav(facts, current) {
  const links = [
    ["/dpdp-firm/", "For CA, CS, legal and audit firms"],
    ["/dpdp-institution/", "For companies, schools and NGOs"],
    ["/about/", facts.pages["/about/"].name],
  ]
  return [
    `<header class="nav">`,
    `  <div class="nav-inner">`,
    `    <a class="wordmark" href="/">VERIDIAN<span class="wordmark-sub">VERy INDIAN</span></a>`,
    `    <nav class="nav-links" aria-label="Pages">`,
    ...links.map(([href, label]) => `      <a${href === current ? ' aria-current="page"' : ""} href="${href}">${esc(label)}</a>`),
    `    </nav>`,
    ...navActions(current).map((l) => "    " + l),
    `  </div>`,
    `</header>`,
  ].join("\n")
}

/** Cloudflare Pages rewrites every visible e-mail address in HTML to "[email protected]" plus a script unless the text sits between these two
 * comments (the comments themselves are removed from the response). A no-JavaScript reader -- a crawler, an AI fetcher, a screen reader on a
 * locked-down device -- then sees no way to reach us. Every visible address the generator writes goes through this. */
const EMAIL_OFF = (html) => `<!--email_off-->${html}<!--/email_off-->`

/** The footer's row of internal links to the fact surfaces: the same row on
 * every public page (generated pages write it into their footer; the
 * hand-kept landings and the root carry it between BEGIN/END markers). */
function footerLinks() {
  return `<p class="footer-legal footer-legal-links">${FOOTER_LINKS.map(([href, label]) => `<a href="${esc(href)}">${esc(label)}</a>`).join(" · ")}</p>`
}

function footer(facts) {
  return [
    `<footer class="footer">`,
    `  <b class="font-heading footer-brand">VERIDIAN · VERy INDIAN</b>`,
    `  <p class="footer-line">${EMAIL_OFF(`Write to <b class="white">${esc(facts.contact.contact_email)}</b> ${esc(subjectTopicsClause(facts))}`)}</p>`,
    `  <p class="footer-line">${EMAIL_OFF(`Grievance Officer: <b class="white">${esc(facts.contact.contact_email)}</b> (subject: Grievance)`)}</p>`,
    `  <p class="footer-line">${esc(facts.storage.stored_in_india_wording)}</p>`,
    `  <p class="footer-legal">We are not a law firm and this is not legal advice. No DPDP certification exists in India and we do not offer one.</p>`,
    `  ${footerLinks()}`,
    `  <p class="footer-legal footer-legal-links"><a href="/terms/">Terms of Service</a> · <a href="/privacy/">Privacy Notice</a> · <a href="/disclaimer/">Disclaimer</a> · <a href="/pricing/">Pricing</a> · <a href="/refund/">Cancellation &amp; Refund</a> · <a href="/shipping/">Delivery</a> · <a href="/contact/">Contact</a></p>`,
    `</footer>`,
  ].join("\n")
}

/** The Contact section's bullets, everywhere it appears (/about/,
 * llms.txt, llms-full.txt): the one address, the subject-line
 * topics, and the Grievance Officer line (the officer is reached at the same
 * address). Wording comes from src/lib/facts.mjs so the hand-kept landing
 * footers' must-contain strings (public-surface.mjs) cannot drift from it. */
const contactBullets = (facts) => [contactSentence(facts), grievanceOfficerLine(facts)]

function companyLines(facts) {
  const out = []
  if (facts.company.legal_name) out.push(`${facts.company.legal_name}, ${facts.company.incorporation}.`)
  if (facts.company.cin) out.push(`CIN: ${facts.company.cin}`)
  if (facts.company.registered_office) out.push(`Registered office: ${facts.company.registered_office}`)
  if (facts.company.gstin) out.push(`GSTIN: ${facts.company.gstin}`)
  return out
}

function libraryLines(facts) {
  return [
    `Version ${facts.library.version}: ${facts.library.job_count} jobs, each mapped to its legal source.`,
    `Reviewer: ${orNotRecorded(facts.library.reviewer)}. Reviewed on: ${orNotRecorded(facts.library.reviewed_on)}.`,
  ]
}

const withEmailOff = (s) => (s.includes("@") ? EMAIL_OFF(esc(s)) : esc(s))

/** A section is its h2, then paragraphs, then a numbered list (steps), then a
 * bulleted list. A text with an e-mail address in it goes through EMAIL_OFF. */
const sectionsHtml = (sections) =>
  sections
    .map((s) => {
      const out = [`  <section class="facts-section">`, `    <h2>${esc(s.h2)}</h2>`]
      for (const p of s.paragraphs ?? []) out.push(`    <p>${withEmailOff(p)}</p>`)
      if (s.steps) out.push(`    <ol>`, ...s.steps.map((b) => `      <li>${withEmailOff(b)}</li>`), `    </ol>`)
      if (s.bullets) out.push(`    <ul>`, ...s.bullets.map((b) => `      <li>${withEmailOff(b)}</li>`), `    </ul>`)
      out.push(`  </section>`)
      return out.join("\n")
    })
    .join("\n")

function page(facts, { path, description, nodes, hidden = false, shareAsk, body }) {
  return [
    `<!doctype html>`,
    `<html lang="en-IN">`,
    `  <head>`,
    head(facts, { path, title: pageTitle(facts, path), description, nodes, hidden }),
    `  </head>`,
    `  <body class="site">`,
    `    <!-- BEGIN generated: brand-line -->`,
    indent(brandLine(facts, { shareAsk }), 4),
    `    <!-- END generated: brand-line -->`,
    indent(nav(facts, path), 4),
    indent(body, 4),
    indent(footer(facts), 4),
    `  </body>`,
    `</html>`,
    ``,
  ].join("\n")
}

const indent = (s, n) => s
  .split("\n")
  .map((l) => (l.length ? " ".repeat(n) + l : l))
  .join("\n")

// ---------------------------------------------------------------- /about/
// 2026-10-01 (owner): the About page is for people and says what the home page
// says, plus the dates, where the data is, the company and how to reach us. It
// carries no version, approval date, library reviewer or other internal
// process wording, and it links to no AI-only surface (those were withdrawn).
function aboutPage(facts) {
  const body = [
    `<main class="container facts-page">`,
    `  <h1>${esc(facts.pages["/about/"].name)}</h1>`,
    `  <!-- BEGIN generated: facts -->`,
    indent(factBlock(facts), 2),
    `  <!-- END generated: facts -->`,
    sectionsHtml([
      { h2: "Key dates", paragraphs: [facts.deadline_line], bullets: facts.key_dates.items.map((d) => `${d.label}: ${d.what}`) },
      { h2: "Where the data is", bullets: [facts.storage.database.sentence, facts.storage.email.sentence, facts.storage.website.sentence] },
      { h2: "Your own AI assistant", paragraphs: [facts.ai_work_link_public_sentence] },
      { h2: "The company", paragraphs: companyLines(facts) },
      { h2: "Contact", bullets: contactBullets(facts) },
    ]),
    `</main>`,
  ].join("\n")
  return page(facts, {
    path: "/about/",
    description: pageDescription(facts, "/about/"),
    nodes: pageNodes(facts, "/about/"),
    shareAsk: true,
    body,
  })
}
// -------------------------------------------------------------- /partner/
// 2026-10-01 (owner): the public page for the in-app Refer & Earn. Plain
// English, short sentences, the real rules only (see data/veridian-facts.yaml,
// sales_partner). The primary button opens the sign-in, /app/.
function partnerPage(facts) {
  const sp = facts.sales_partner
  const button = `<a class="btn" href="/app/">${esc(sp.button)}</a>`
  const body = [
    `<main class="container facts-page">`,
    `  <h1>${esc(facts.pages["/partner/"].name)}</h1>`,
    `  <p class="lead">${esc(sp.lead)}</p>`,
    `  <p class="partner-cta">${button}</p>`,
    `  <p class="partner-note">${esc(sp.sign_in_note)}</p>`,
    `  <p class="partner-note"><a href="/partner/terms/">${esc(sp.terms_link_text)}</a></p>`,
    sectionsHtml([...sp.sections, { h2: "Contact", bullets: contactBullets(facts) }]),
    `  <p class="partner-cta">${button}</p>`,
    `  <!-- BEGIN generated: facts -->`,
    indent(factBlock(facts), 2),
    `  <!-- END generated: facts -->`,
    `</main>`,
  ].join("\n")
  return page(facts, {
    path: "/partner/",
    description: pageDescription(facts, "/partner/"),
    nodes: pageNodes(facts, "/partner/"),
    shareAsk: true,
    body,
  })
}
// ---------------------------------------------------------- /partner/terms/
// 2026-10-01 (owner): the Sales Partner agreement, from facts.sales_partner_terms. Public and
// indexable; shows its version and date. No script of its own.
function partnerTermsPage(facts) {
  const t = facts.sales_partner_terms
  const body = [
    `<main class="container facts-page">`,
    `  <h1>${esc(t.heading)}</h1>`,
    `  <p class="lead">${esc(t.status_line)}</p>`,
    `  <p class="partner-note">${esc(t.lead)}</p>`,
    sectionsHtml([...t.sections, { h2: "The company", paragraphs: companyLines(facts) }, { h2: "Contact", bullets: contactBullets(facts) }]),
    `  <p class="partner-note"><a href="/partner/">${esc(t.back_link_text)}</a> · <a href="/terms/">Terms of Service</a></p>`,
    `  <!-- BEGIN generated: facts -->`,
    indent(factBlock(facts), 2),
    `  <!-- END generated: facts -->`,
    `</main>`,
  ].join("\n")
  return page(facts, {
    path: "/partner/terms/",
    description: pageDescription(facts, "/partner/terms/"),
    nodes: pageNodes(facts, "/partner/terms/"),
    shareAsk: true,
    body,
  })
}
// ---------------------------------------------------------- /ai-assistant/
// 2026-10-01 (owner): the free AI assistant. The "assistant" is the person's own
// AI, opened with their personal AI work link; we run no model for it. Plain
// English, short sentences, the real rules only (data/veridian-facts.yaml,
// ai_assistant). The button opens the sign-in, /app/. No address, path or token
// of the link itself appears (the wall, scripts/check-two-doors.mjs).
function aiAssistantPage(facts) {
  const ai = facts.ai_assistant
  const button = `<a class="btn" href="/app/">${esc(ai.button)}</a>`
  const body = [
    `<main class="container facts-page">`,
    `  <h1>${esc(ai.heading)}</h1>`,
    `  <p class="lead lead-strong">${esc(ai.tagline)}</p>`,
    `  <p class="lead">${esc(ai.lead)}</p>`,
    `  <p class="partner-cta">${button}</p>`,
    `  <p class="partner-note">${esc(ai.sign_in_note)}</p>`,
    sectionsHtml([...ai.sections, { h2: "Contact", bullets: contactBullets(facts) }]),
    `  <p class="partner-cta">${button}</p>`,
    `  <!-- BEGIN generated: facts -->`,
    indent(factBlock(facts), 2),
    `  <!-- END generated: facts -->`,
    `</main>`,
  ].join("\n")
  return page(facts, {
    path: "/ai-assistant/",
    description: pageDescription(facts, "/ai-assistant/"),
    nodes: pageNodes(facts, "/ai-assistant/"),
    shareAsk: true,
    body,
  })
}

/** The highlight on the home page, between the two ways in and "Already have an
 * account?": the heading, one line, a button to the sign-in and a link to the page. */
function homeAiSection(facts) {
  const ai = facts.ai_assistant
  return [
    `<section class="ai-highlight" aria-labelledby="ai-highlight-title">`,
    `  <h2 class="ai-highlight-title" id="ai-highlight-title">${esc(ai.heading)}</h2>`,
    `  <p class="ai-highlight-tagline">${esc(ai.tagline)}</p>`,
    `  <p class="ai-highlight-line">${esc(ai.home_line)}</p>`,
    `  <p class="ai-highlight-actions"><a class="btn btn-sm" href="/app/">${esc(ai.button)}</a> <a class="ai-highlight-more" href="${NAV_AI.href}">${esc(ai.home_more)}</a></p>`,
    `</section>`,
  ].join("\n")
}
// ---------------------------------------------------------------- /proof/
function proofPage(facts, proof) {
  const hidden = !facts.proof.enabled
  const aggregates = proof.aggregates.items.map((a) => `${a.label}: ${a.value === null ? "not yet published" : String(a.value)}`)
  const asOf = proof.aggregates.as_of ? [`Figures as of ${proof.aggregates.as_of}.`] : [`Figures: not yet published.`]
  const cases = proof.case_studies.items.length
    ? proof.case_studies.items.map((c) => `${c.organisation} (consent given ${c.consent_on}): ${c.summary}`)
    : ["No case study is published yet. A case study appears here after the organisation gives written consent, not before."]
  const body = [
    `<main class="container facts-page">`,
    `  <h1>${esc(facts.pages["/proof/"].name)}</h1>`,
    `  <p class="lead">${esc(proof.intro)}</p>`,
    sectionsHtml([
      { h2: "In use", paragraphs: asOf, bullets: aggregates },
      { h2: "Case studies", bullets: cases },
      { h2: "The job library and its reviewer", paragraphs: libraryLines(facts) },
    ]),
    `  <!-- BEGIN generated: facts -->`,
    indent(factBlock(facts), 2),
    `  <!-- END generated: facts -->`,
    `</main>`,
  ].join("\n")
  return page(facts, {
    path: "/proof/",
    description: proof.intro,
    nodes: pageNodes(facts, "/proof/"),
    hidden,
    shareAsk: true,
    body,
  })
}

// ------------------------------------------------------- the three landings
function replaceBetween(html, name, inner, file) {
  const begin = `<!-- BEGIN generated: ${name} -->`
  const end = `<!-- END generated: ${name} -->`
  const i = html.indexOf(begin)
  const j = html.indexOf(end)
  if (i === -1 || j === -1 || j < i) throw new Error(`${file}: markers "${begin}" ... "${end}" missing -- add them where the block belongs, once`)
  // Keep the indentation of the BEGIN line for the inserted block.
  const lineStart = html.lastIndexOf("\n", i) + 1
  const pad = html.slice(lineStart, i)
  return html.slice(0, i + begin.length) + "\n" + indent(inner, pad.length) + "\n" + pad + html.slice(j)
}

function replaceOne(html, re, replacement, file, what) {
  const m = re.exec(html)
  if (!m) throw new Error(`${file}: cannot find ${what}`)
  const text = typeof replacement === "function" ? replacement(m) : replacement
  return html.slice(0, m.index) + text + html.slice(m.index + m[0].length)
}

/** Apply the generated parts to an existing landing page: brand line and
 * fact block between their markers; title, description and Open Graph from
 * the one line; Organization + SoftwareApplication in the JSON-LD (WebSite
 * and FAQPage untouched). */
export function applyToLanding(facts, html, path, file) {
  const title = pageTitle(facts, path)
  const description = pageDescription(facts, path)
  let out = html
  out = replaceOne(out, /<title>[^<]*<\/title>/i, `<title>${esc(title)}</title>`, file, "<title>")
  out = replaceOne(out, /<meta name="description" content="[^"]*" \/>/i, `<meta name="description" content="${esc(description)}" />`, file, "the meta description")
  out = replaceOne(out, /<link rel="canonical" href="[^"]*" \/>/i, `<link rel="canonical" href="${esc(pageUrl(path))}" />`, file, "the canonical link")
  out = replaceOne(out, /<meta property="og:url" content="[^"]*" \/>/i, `<meta property="og:url" content="${esc(pageUrl(path))}" />`, file, "og:url")
  out = replaceOne(out, /<meta property="og:title" content="[^"]*" \/>/i, `<meta property="og:title" content="${esc(title)}" />`, file, "og:title")
  out = replaceOne(out, /<meta property="og:description" content="[^"]*" \/>/i, `<meta property="og:description" content="${esc(description)}" />`, file, "og:description")
  // Open Graph image, Twitter card and favicon: drop any earlier copy, then
  // write them right after og:description (idempotent, byte-stable).
  out = out.replace(/^[ \t]*<(?:meta (?:property="og:image[^"]*"|name="twitter:[^"]*")|link rel="icon")[^>]*\/>\r?\n/gm, "")
  out = replaceOne(
    out,
    /^([ \t]*)(<meta property="og:description" content="[^"]*" \/>)\r?\n/m,
    (m) => `${m[1]}${m[2]}\n${socialLines(facts, { title, description }).map((l) => m[1] + l).join("\n")}\n`,
    file,
    "og:description (to attach the image and card tags)",
  )

  // The one allowed script besides JSON-LD: /ref.js, right after the stylesheet link (idempotent).
  out = replaceOne(
    out,
    /^([ \t]*)(<link rel="stylesheet" href="\/src\/site\.css" \/>)\r?\n(?:[ \t]*<script defer src="\/ref\.js"><\/script>\r?\n)?/m,
    (m) => `${m[1]}${m[2]}\n${m[1]}${REF_SCRIPT.tag}\n`,
    file,
    "the stylesheet link (to attach /ref.js)",
  )

  const block = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/i.exec(out)
  if (!block) throw new Error(`${file}: no JSON-LD block`)
  const parsed = JSON.parse(block[1])
  const graph = Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [parsed]
  const GENERATED = new Set(["Organization", "SoftwareApplication", "WebSite", "BreadcrumbList"])
  const kept = graph.filter((n) => !GENERATED.has(n["@type"]))
  const faq = kept.filter((n) => n["@type"] === "FAQPage")
  const other = kept.filter((n) => n["@type"] !== "FAQPage")
  if (other.length) throw new Error(`${file}: JSON-LD carries ${other.map((n) => n["@type"]).join(", ")}, which this generator does not know how to keep`)
  const nodes = pageNodes(facts, path, faq)
  out = out.slice(0, block.index) + jsonLdScript(nodes) + out.slice(block.index + block[0].length)

  out = replaceBetween(out, "brand-line", brandLine(facts, { shareAsk: true }), file)
  if (path === "/") out = replaceBetween(out, "ai-assistant", homeAiSection(facts), file)
  out = replaceBetween(out, "facts", factBlock(facts, { compact: path === "/" }), file)
  out = replaceBetween(out, "footer-links", footerLinks(), file)
  return out
}

// ----------------------------------------------------------- llms*.txt
// Owner decision 2026-10-01: llms.txt is short. It says only what the home page
// already says in public, plus the list of public pages. No internal process,
// no approval or version wording, no crawl-policy notes.
function llmsTxt(facts) {
  return [
    `# ${facts.product}`,
    ``,
    `> ${facts.one_line}`,
    ``,
    facts.brand.full,
    ``,
    `## Who it is for`,
    ``,
    ...facts.who_for.map((w, i) => `${i + 1}. ${w}`),
    ``,
    `## What it does`,
    ``,
    ...facts.three_strongest_facts.map((f) => `- ${f}`),
    ``,
    facts.what_it_does_not_do,
    ``,
    `## Pages`,
    ``,
    ...PUBLIC_PAGES.map((p) => `- [${facts.pages[p.path].name}](${pageUrl(p.path)}): ${facts.pages[p.path].summary}`),
    `- The sitemap: ${facts.site}/sitemap.xml`,
    ``,
    `## Contact`,
    ``,
    ...contactBullets(facts).map((b) => `- ${b}`),
    ``,
    `We are not a law firm and this is not legal advice. No DPDP certification exists in India and we do not offer one.`,
    ``,
  ].join("\n")
}

function llmsFullTxt(facts, pagesHtml) {
  const out = [`# ${facts.product} — full text`, ``, `> ${facts.one_line}`, ``, `This is the visible text of every public page of ${facts.site}.`, ``]
  for (const p of PUBLIC_PAGES) {
    out.push(`## ${facts.pages[p.path].name} — ${pageUrl(p.path)}`, ``)
    for (const line of visibleLines(pagesHtml.get(p.source))) out.push(line.startsWith("# ") ? `### ${line.slice(2)}` : line.startsWith("## ") ? `### ${line.slice(3)}` : line)
    out.push(``)
  }
  out.push(`## Contact`, ``, ...contactBullets(facts).map((b) => `- ${b}`), ``, `We are not a law firm and this is not legal advice. No DPDP certification exists in India and we do not offer one.`, ``)
  return out.join("\n")
}
// ---------------------------------------------------------------- _headers
function applyToHeaders(facts, text, file) {
  const begin = "# BEGIN generated: proof"
  const end = "# END generated: proof"
  const i = text.indexOf(begin)
  const j = text.indexOf(end)
  if (i === -1 || j === -1 || j < i) throw new Error(`${file}: markers "${begin}" ... "${end}" missing`)
  const body = facts.proof.enabled
    ? `# (facts.proof.enabled is true: /proof/ is public, no rule)`
    : [`# facts.proof.enabled is false: /proof/ is built but hidden (WO-DPDP-013 v2 §2.1).`, `/proof/*`, `  X-Robots-Tag: noindex, nofollow`].join("\n")
  const lineEnd = text.indexOf("\n", i)
  return text.slice(0, lineEnd + 1) + body + "\n" + text.slice(j)
}

// ------------------------------------------------------------------- build
/** Every generated file, in memory: Map<relative posix path, content>. */
export function buildOutputs() {
  const facts = loadFacts()
  loadClaims() // validated here so a broken register stops the generator too
  const proof = loadProof()
  const files = new Map()
  const read = (rel) => readFileSync(join(APP_DIR, rel), "utf8").replace(/\r\n/g, "\n")

  const landings = new Map()
  for (const path of ["/", "/dpdp-firm/", "/dpdp-institution/"]) {
    const p = PUBLIC_PAGES.find((x) => x.path === path)
    landings.set(p.source, applyToLanding(facts, read(p.source), path, p.source))
  }
  for (const [source, html] of landings) files.set(source, html)
  files.set("about/index.html", aboutPage(facts))
  files.set("partner/index.html", partnerPage(facts))
  files.set("partner/terms/index.html", partnerTermsPage(facts))
  files.set("ai-assistant/index.html", aiAssistantPage(facts))
  files.set("proof/index.html", proofPage(facts, proof))
  files.set("public/llms.txt", llmsTxt(facts))

  const pagesHtml = new Map(files)
  files.set("public/llms-full.txt", llmsFullTxt(facts, pagesHtml))
  files.set("public/_headers", applyToHeaders(facts, read("public/_headers"), "public/_headers"))

  // Every public and hidden page listed in public-surface.mjs must be one
  // this generator wrote or touched -- a listed page nobody generates would
  // be a page nobody can regenerate.
  for (const p of [...PUBLIC_PAGES, ...HIDDEN_PAGES]) {
    if (!files.has(p.source)) throw new Error(`public-surface.mjs lists ${p.source}, which this generator does not produce`)
  }
  return { facts, files }
}

function main() {
  const args = new Set(process.argv.slice(2))
  const { files } = buildOutputs()
  if (args.has("--check")) {
    const stale = []
    for (const [rel, body] of files) {
      const abs = join(APP_DIR, rel)
      if (!existsSync(abs)) {
        stale.push(`missing: ${rel}`)
        continue
      }
      if (readFileSync(abs, "utf8").replace(/\r\n/g, "\n") !== body) stale.push(`differs: ${rel}`)
    }
    if (stale.length) {
      console.error(`generate-public-facts: ${stale.length} surface(s) are out of date with data/veridian-facts.yaml -- run: node scripts/generate-public-facts.mjs, then commit`)
      for (const s of stale) console.error("  " + s)
      return 1
    }
    console.log(`generate-public-facts: OK -- ${files.size} surfaces match the facts file`)
    return 0
  }
  let written = 0
  for (const [rel, body] of files) {
    const abs = join(APP_DIR, rel)
    mkdirSync(dirname(abs), { recursive: true })
    const existing = existsSync(abs) ? readFileSync(abs, "utf8").replace(/\r\n/g, "\n") : null
    if (existing !== body) {
      writeFileSync(abs, body, "utf8")
      written++
    }
  }
  console.log(`generate-public-facts: ${files.size} surfaces (${written} written, ${files.size - written} unchanged) under ${relative(process.cwd(), APP_DIR) || "."}`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) process.exitCode = main()
