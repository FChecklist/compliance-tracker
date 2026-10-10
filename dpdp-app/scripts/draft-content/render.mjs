// WO-DPDP-012 §5 page contract, in one place: a page MODEL (plain data,
// built by jobs.mjs / guides.*.mjs / landing.hi.mjs) is rendered here into
// the HTML draft and its Markdown twin (§3 wants a .md copy of every page).
// Keeping rendering here means every draft -- job page, guide, Hindi page --
// carries the same head, the same JSON-LD, the same review line, the same
// disclaimer and the same single link, and drafts.test.ts checks one contract.
//
// The contract, per §4/§5 and the owner's rules:
//   <html lang="en-IN"> (or "hi"), own <title>, meta description, canonical,
//   Open Graph, hreflang alternates where a translation exists, exactly one
//   <h1>, headings in order, NO scripts (JSON-LD is data, not script), no
//   font links, Article + BreadcrumbList JSON-LD, the review line, a plain
//   disclaimer, one link ("Track this with VERIDIAN"), and no price anywhere.
//
// PUBLISH STATE. While REVIEW.reviewer is null every page is a DRAFT: it
// carries an UNPUBLISHED header comment, a <meta name="robots"
// content="noindex, nofollow"> (so an accidental deploy is still not
// indexed), and the review line is an explicit unfilled placeholder. When
// the owner confirms lawyer review, set REVIEW.reviewer/REVIEW.date here,
// regenerate, and the review line, JSON-LD reviewedBy and the removal of
// noindex all change together in one diff -- see drafts/README.md.

export const SITE = {
  base: "https://app.veridian-aios.com",
  name: "VERIDIAN",
  org: "VERIDIAN AI",
  trackUrl: "https://app.veridian-aios.com/",
}

// null until the owner confirms lawyer review. Both must be set together.
export const REVIEW = { reviewer: null, date: null }

export const STRINGS = {
  "en-IN": {
    trackLabel: "Track this with VERIDIAN",
    reviewLine: (r) => r.reviewer ? `Last reviewed by ${r.reviewer}, ${r.date}` : "Last reviewed by [REVIEWING LAWYER — not yet reviewed], [DATE — not yet reviewed]",
    disclaimer: "This page is general information, not legal advice. VERIDIAN is not a law firm. No DPDP certification exists in India and we do not offer one. Read the law's own text, and ask your own lawyer, before you act on anything here.",
    draftNote: "Unpublished draft — machine-generated, not yet reviewed by a lawyer.",
    ogLocale: "en_IN",
    homeCrumb: "Home",
  },
  hi: {
    trackLabel: "इसे VERIDIAN के साथ ट्रैक करें",
    reviewLine: (r) => r.reviewer ? `अंतिम समीक्षा: ${r.reviewer}, ${r.date}` : "अंतिम समीक्षा: [समीक्षक वकील — अभी समीक्षा नहीं हुई], [तारीख — अभी समीक्षा नहीं हुई]",
    disclaimer: "यह पृष्ठ सामान्य जानकारी है, कानूनी सलाह नहीं। VERIDIAN कोई लॉ फ़र्म नहीं है। भारत में कोई DPDP प्रमाणन (certification) मौजूद नहीं है और हम ऐसा कोई प्रमाणन नहीं देते। यहाँ लिखी किसी बात पर अमल करने से पहले कानून का मूल पाठ पढ़ें और अपने वकील से पूछें।",
    draftNote: "अप्रकाशित मशीनी मसौदा — अभी किसी वकील ने समीक्षा नहीं की है।",
    ogLocale: "hi_IN",
    homeCrumb: "मुख्य पृष्ठ",
  },
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

// Inline text -> HTML. Plain text only (escaped), except that a
// "[VERIFY: ...]" note is wrapped so it stands out for the lawyer.
export function inline(text) {
  return escapeHtml(text).replace(/\[VERIFY: ([^\]]+)\]/g, '<mark class="verify">[VERIFY: $1]</mark>')
}

const CSS = `
:root{--navy:#1C2B3A;--saffron:#F5820A;--teal:#0E7C6E;--cream:#FFFDF9;--ink:#1F1B3A;--muted:#564D77;--line:#E6E2F5}
*{box-sizing:border-box}
html{font-size:17px}
body{margin:0;background:var(--cream);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Devanagari",sans-serif;line-height:1.55}
main{max-width:46rem;margin:0 auto;padding:2rem 1rem 3rem}
header.site{border-bottom:1px solid var(--line);background:#fff}
header.site div{max-width:46rem;margin:0 auto;padding:.75rem 1rem;font-weight:700;letter-spacing:.02em;color:var(--navy)}
header.site small{display:block;font-size:.65rem;letter-spacing:.2em;color:#8E86AD;font-weight:600}
.draft{background:#FFF3E0;border:1px solid var(--saffron);color:#7A3E00;padding:.5rem .75rem;border-radius:.5rem;font-size:.85rem;margin-bottom:1.25rem}
.kicker{color:var(--muted);font-size:.9rem;margin:0 0 .5rem}
h1{font-size:1.9rem;line-height:1.2;margin:.25rem 0 1rem;color:var(--navy)}
h2{font-size:1.2rem;margin:1.75rem 0 .5rem;color:var(--navy);border-top:1px solid var(--line);padding-top:1rem}
.answer{font-size:1.1rem;background:#fff;border-left:4px solid var(--teal);padding:.9rem 1rem;border-radius:.4rem}
ul,ol{padding-left:1.3rem}
li{margin:.3rem 0}
.note{color:var(--muted);font-size:.9rem}
mark.verify{background:#FFE8B3;color:#6b3d00;padding:0 .2rem;border-radius:.2rem;font-weight:600}
.cta{margin:2rem 0 1rem}
.cta a{display:inline-block;background:var(--navy);color:#fff;text-decoration:none;padding:.7rem 1.1rem;border-radius:.5rem;font-weight:700}
footer.page{margin-top:2rem;border-top:1px solid var(--line);padding-top:1rem;font-size:.85rem;color:var(--muted)}
footer.page p{margin:.4rem 0}
`.trim()

function jsonLd(page, strings) {
  const canonical = SITE.base + page.path
  const article = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: page.h1,
    description: page.description,
    inLanguage: page.lang,
    datePublished: page.datePublished,
    dateModified: page.dateModified,
    author: { "@type": "Organization", name: SITE.org, url: SITE.trackUrl },
    publisher: { "@type": "Organization", name: SITE.org, url: SITE.trackUrl },
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
    isAccessibleForFree: true,
  }
  // reviewedBy is OMITTED until review exists (WO-012 §4: "naming the
  // reviewing lawyer once review exists") -- never a placeholder in JSON-LD,
  // which an AI crawler would read as a real name.
  if (REVIEW.reviewer) article.reviewedBy = { "@type": "Person", name: REVIEW.reviewer }
  const crumbs = [{ name: strings.homeCrumb, path: "/" }, ...page.breadcrumbs, { name: page.h1, path: page.path }]
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: SITE.base + c.path })),
  }
  return [article, breadcrumb]
}

function renderBlock(b) {
  switch (b.type) {
    case "p":
      return `<p${b.cls ? ` class="${b.cls}"` : ""}>${inline(b.text)}</p>`
    case "ul":
    case "ol":
      return `<${b.type}>\n${b.items.map((it) => `  <li>${typeof it === "string" ? inline(it) : `${inline(it.text)}${it.note ? ` <span class="note">${inline(it.note)}</span>` : ""}`}</li>`).join("\n")}\n</${b.type}>`
    default:
      throw new Error(`unknown block type ${b.type}`)
  }
}

/** The HTML draft for a page model. LF line endings, no trailing whitespace games -- byte-stable across runs. */
export function renderHtml(page) {
  const strings = STRINGS[page.lang]
  if (!strings) throw new Error(`no strings for lang ${page.lang}`)
  const canonical = SITE.base + page.path
  const alternates = (page.alternates ?? []).map((a) => `  <link rel="alternate" hreflang="${a.hreflang}" href="${escapeHtml(a.href)}" />`).join("\n")
  const ld = jsonLd(page, strings)
  const draftMeta = REVIEW.reviewer ? "" : `  <meta name="robots" content="noindex, nofollow" />\n`
  const answerSentences = page.answer
  const answerHtml = `<p class="answer"><strong>${inline(answerSentences[0])}</strong> ${answerSentences.slice(1).map(inline).join(" ")}</p>`

  return `<!doctype html>
<!--
  ${page.headerComment.split("\n").join("\n  ")}
  Generated by dpdp-app/scripts/generate-job-pages.mjs -- do not hand-edit; edit the source and regenerate.
-->
<html lang="${page.lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(page.title)}</title>
  <meta name="description" content="${escapeHtml(page.description)}" />
${draftMeta}  <link rel="canonical" href="${canonical}" />
${alternates ? alternates + "\n" : ""}  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="${SITE.name}" />
  <meta property="og:locale" content="${strings.ogLocale}" />
  <meta property="og:title" content="${escapeHtml(page.title)}" />
  <meta property="og:description" content="${escapeHtml(page.description)}" />
  <meta property="og:url" content="${canonical}" />
  <meta property="article:published_time" content="${page.datePublished}" />
  <meta property="article:modified_time" content="${page.dateModified}" />
  <script type="application/ld+json">
${JSON.stringify(ld, null, 2).split("\n").map((l) => "  " + l).join("\n")}
  </script>
  <style>
${CSS}
  </style>
</head>
<body>
<header class="site"><div>${SITE.name}<small>VERy INDIAN</small></div></header>
<main>
${REVIEW.reviewer ? "" : `<p class="draft">${inline(strings.draftNote)}</p>\n`}<p class="kicker">${inline(page.kicker)}</p>
<h1>${inline(page.h1)}</h1>
${answerHtml}
${page.sections.map((s) => `<h2>${inline(s.h2)}</h2>\n${s.blocks.map(renderBlock).join("\n")}`).join("\n")}
<p class="cta"><a href="${SITE.trackUrl}">${inline(strings.trackLabel)}</a></p>
<footer class="page">
<p>${inline(strings.reviewLine(REVIEW))}</p>
<p>${inline(strings.disclaimer)}</p>
</footer>
</main>
</body>
</html>
`
}

function mdInline(text) {
  return String(text).replace(/\[VERIFY: ([^\]]+)\]/g, "**[VERIFY: $1]**")
}

function mdBlock(b) {
  switch (b.type) {
    case "p":
      return mdInline(b.text)
    case "ul":
      return b.items.map((it) => `- ${typeof it === "string" ? mdInline(it) : `${mdInline(it.text)}${it.note ? ` _${mdInline(it.note)}_` : ""}`}`).join("\n")
    case "ol":
      return b.items.map((it, i) => `${i + 1}. ${typeof it === "string" ? mdInline(it) : `${mdInline(it.text)}${it.note ? ` _${mdInline(it.note)}_` : ""}`}`).join("\n")
    default:
      throw new Error(`unknown block type ${b.type}`)
  }
}

/** The Markdown twin -- same content, same order, same review line and disclaimer, same one link. */
export function renderMarkdown(page) {
  const strings = STRINGS[page.lang]
  const canonical = SITE.base + page.path
  const alternates = (page.alternates ?? []).map((a) => `- hreflang ${a.hreflang}: ${a.href}`).join("\n")
  return `<!--
${page.headerComment}
Generated by dpdp-app/scripts/generate-job-pages.mjs -- do not hand-edit; edit the source and regenerate.
-->

# ${page.h1}

_${mdInline(page.kicker)}_

${REVIEW.reviewer ? "" : `> ${strings.draftNote}\n\n`}**${mdInline(page.answer[0])}** ${page.answer.slice(1).map(mdInline).join(" ")}

${page.sections.map((s) => `## ${s.h2}\n\n${s.blocks.map(mdBlock).join("\n\n")}`).join("\n\n")}

**[${strings.trackLabel}](${SITE.trackUrl})**

---

${strings.reviewLine(REVIEW)}

${strings.disclaimer}

- Canonical: ${canonical}
- Language: ${page.lang}
- Published: ${page.datePublished} · Modified: ${page.dateModified}
${alternates ? alternates + "\n" : ""}`
}

/** ~155-char meta description from the answer sentences, cut at a word boundary. */
export function describe(sentences, max = 158) {
  // [VERIFY] notes are for the lawyer on the page itself, not for a snippet.
  const s = sentences.join(" ").replace(/\s*\[VERIFY: [^\]]+\]/g, "").replace(/\s+/g, " ").trim()
  if (s.length <= max) return s
  const cut = s.slice(0, max - 1)
  return cut.slice(0, cut.lastIndexOf(" ")) + "…"
}
