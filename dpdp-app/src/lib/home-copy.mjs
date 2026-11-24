// ALL the home page copy (owner order, 24 Nov 2026: firm-first redesign), in one place so it can be translated later.
// scripts/generate-home.mjs writes renderHome(HOME_COPY) into index.html between the "generated: home-firm-first" markers; `--check` (run by `bun run build`)
// fails if the committed page differs, and src/lib/home-copy.test.ts pins the standard sentences, the plain-English rules and the absence of tick boxes.
//
// Rules for anything added here: short sentences, simple English, no "my" or "your", no tick box, no number, date or section of the Act unless it is
// checked against the official text (spec/veridian-dpdp.html is the repo's own copy) and the source is cited. "Penalties are high" is the whole penalty claim.
// Words the claims register bans (data/claims-register.yaml) stay out. Plain ESM so node scripts can read it; the .d.mts carries the types.

export const HOME_COPY = {
  eyebrow: "DPDP Act 2023 · DPDP Rules 2025",
  h1: "DPDP is coming. Penalties are high.",
  lead: "It is not an IT job. It is the job of the CA, CS or auditor to remind the client.",
  lead2: "The first step is Discover, with a regular independent follow-up every week: what data is there, where it is, and what has been done with it.",
  cta: { label: "Become a Partner", href: "/partner/" },
  ctaNote: "For a Firm (CA, CS, auditor or lawyer) and for an Accountant Partner.",
  signIn: { label: "Already a Partner or a client? Sign in", href: "/app/" },
  under: ["Sign in with an e-mail. No password.", "Simple. Step by step.", "A free AI assistant helps with each step"],
  strip: [
    "Built for DPDP Act 2023 & Rules 2025",
    "SPDI Rules 2011 apply until 13 May 2027",
    "Every control mapped to its legal source",
    "Free AI assistant, a person confirms every update",
  ],
  wordsTitle: "Discover. Decide. Do.",
  words: [
    { word: "Discover", meaning: "What data there is, where it is, and with whom." },
    { word: "Decide", meaning: "What to do, when to do it, and who will do it." },
    { word: "Do", meaning: "Confirm that it is done." },
  ],
  weekly: {
    title: "It is not a one-time job. It is weekly work.",
    text: "Discover, Decide and Do come round every week. A simple system keeps them going. VERIDIAN is that system.",
  },
  stepsTitle: "How it works in 3 steps",
  steps: [
    { title: "A Partner joins", text: "A Firm or an Accountant Partner signs in with an e-mail. No password." },
    { title: "The Partner adds clients", text: "Each client gets an e-mail invitation, verifies by e-mail, and sees its own dashboard." },
    { title: "Every week", text: "Discover, Decide, Do. Partner and client both see what is done, what is pending, with whom, and how old it is." },
  ],
  partnersTitle: "Two ways to become a Partner",
  partners: [
    { name: "Firm", text: "A CA, CS, auditor or lawyer. Runs the weekly work for clients, signs off reports and gives advice." },
    { name: "Accountant Partner", text: "An accountant or bookkeeper who is not a CA. Runs the weekly routine with clients as a reminder and follow-up service." },
  ],
  accountantLine: "Accountant Partners remind clients and follow up every week. A professional confirms every sign-off and every legal point.",
  earnLine: "Partners earn a commission in Moneypenny credits when a client pays for the weekly plan.",
  terms: { before: "By continuing you accept the ", label: "Terms of Service", href: "/terms/", after: "." },
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** The home page's generated region, as HTML. Pure: the same copy always gives the same bytes. */
export function renderHome(c = HOME_COPY) {
  const L = []
  L.push(`        <section class="hm-hero">`)
  L.push(`          <div class="hm-wrap">`)
  L.push(`            <span class="hm-eyebrow">${esc(c.eyebrow)}</span>`)
  L.push(`            <h1 class="chooser-title">${esc(c.h1)}</h1>`)
  L.push(`            <p class="hm-lead">${esc(c.lead)}</p>`)
  L.push(`            <p class="hm-lead">${esc(c.lead2)}</p>`)
  L.push(`            <p class="hm-cta"><a class="btn hm-cta-btn" href="${c.cta.href}">${esc(c.cta.label)}</a></p>`)
  L.push(`            <p class="hm-cta-note">${esc(c.ctaNote)}</p>`)
  L.push(`            <p class="hm-notice">${esc(c.terms.before)}<a href="${c.terms.href}">${esc(c.terms.label)}</a>${esc(c.terms.after)}</p>`)
  L.push(`            <div class="hm-under">`)
  for (const u of c.under) L.push(`              <span>${esc(u)}</span>`)
  L.push(`            </div>`)
  L.push(`            <p class="hm-signin"><a href="${c.signIn.href}">${esc(c.signIn.label)}</a></p>`)
  L.push(`          </div>`)
  L.push(`        </section>`)
  L.push(``)
  L.push(`        <div class="hm-strip">`)
  L.push(`          <div class="hm-wrap">`)
  for (const s of c.strip) L.push(`            <span>${esc(s)}</span>`)
  L.push(`          </div>`)
  L.push(`        </div>`)
  L.push(``)
  L.push(`        <section class="hm-sec hm-ddd" aria-labelledby="ddd-title">`)
  L.push(`          <div class="hm-wrap">`)
  L.push(`            <h2 id="ddd-title">${esc(c.wordsTitle)}</h2>`)
  L.push(`            <ol class="hm-words">`)
  c.words.forEach((w, i) => L.push(`              <li class="hm-word hm-word-${i + 1}"><b>${esc(w.word)}</b><span>${esc(w.meaning)}</span></li>`))
  L.push(`            </ol>`)
  L.push(`            <p class="hm-weekly"><b>${esc(c.weekly.title)}</b> ${esc(c.weekly.text)}</p>`)
  L.push(`          </div>`)
  L.push(`        </section>`)
  L.push(``)
  L.push(`        <section class="hm-sec hm-steps-bg" id="how" aria-labelledby="how-title">`)
  L.push(`          <div class="hm-wrap">`)
  L.push(`            <h2 id="how-title">${esc(c.stepsTitle)}</h2>`)
  L.push(`            <ol class="hm-arrows">`)
  c.steps.forEach((s) => L.push(`              <li><h3>${esc(s.title)}</h3><p>${esc(s.text)}</p></li>`))
  L.push(`            </ol>`)
  L.push(`          </div>`)
  L.push(`        </section>`)
  L.push(``)
  L.push(`        <section class="hm-sec hm-firms" aria-labelledby="partners-title">`)
  L.push(`          <div class="hm-wrap">`)
  L.push(`            <h2 id="partners-title">${esc(c.partnersTitle)}</h2>`)
  L.push(`            <div class="hm-firms-grid hm-two">`)
  for (const p of c.partners) L.push(`              <div><b>${esc(p.name)}</b> ${esc(p.text)}</div>`)
  L.push(`            </div>`)
  L.push(`            <p class="hm-firms-lead">${esc(c.accountantLine)}</p>`)
  L.push(`            <p class="hm-firms-lead">${esc(c.earnLine)}</p>`)
  L.push(`            <p class="hm-cta"><a class="btn hm-cta-btn" href="${c.cta.href}">${esc(c.cta.label)}</a></p>`)
  L.push(`          </div>`)
  L.push(`        </section>`)
  return L.join("\n")
}

export const HOME_BEGIN = "<!-- BEGIN generated: home-firm-first -->"
export const HOME_END = "<!-- END generated: home-firm-first -->"

/** index.html with the generated region replaced by renderHome(). Throws if the markers are missing or not in order. */
export function applyHome(html, c = HOME_COPY) {
  const a = html.indexOf(HOME_BEGIN)
  const b = html.indexOf(HOME_END)
  if (a < 0 || b < a) throw new Error("index.html: the home-firm-first markers are missing or out of order")
  return `${html.slice(0, a + HOME_BEGIN.length)}\n${renderHome(c)}\n        ${html.slice(b)}`
}
