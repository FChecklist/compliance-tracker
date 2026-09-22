// WO-DPDP-014 §5 "protect the main inbox" -- the placement test, run by the
// PM: render the REAL Monday digest (supabase/functions/dpdp-monday-email/
// render.ts, pure TS) three ways and send each to a real Gmail inbox through
// the real sending domain, so Gmail's own category decision can be read
// back (INBOX vs CATEGORY_PROMOTIONS):
//   A  as shipped: brand-line footer + share ask (a decision-maker's digest)
//   B  brand-line footer only (share ask stripped)
//   C  no footer at all (the pre-WO-014 email)
// Usage: bun run scripts/dpdp-inbox-placement.ts <to-address>
// Needs RESEND_API_KEY in the environment (root .env.local). Sends exactly
// three emails, all marked [placement A|B|C] in the subject. Nothing is
// written to the database.
import { renderDigest, type Digest, type DigestJob, type RenderLinks } from "../supabase/functions/dpdp-monday-email/render.ts"

const to = process.argv[2]
if (!to || !to.includes("@")) { console.error("usage: bun run scripts/dpdp-inbox-placement.ts <to-address>"); process.exit(2) }
const key = process.env.RESEND_API_KEY
if (!key) { console.error("RESEND_API_KEY not set"); process.exit(2) }

const today = new Date().toISOString().slice(0, 10)
const job = (o: Partial<DigestJob>): DigestJob => ({
  obligationId: "j", key: "k", what: "Put up a notice wherever there is a camera", part: 3, dueOn: today, daysLate: 0, late: false,
  requiredToday: false, isGroup: false, groupLabel: null, assigneeEmail: null, isMine: true, stuck: false, outsideParty: false, ...o,
})
const digest: Digest = {
  membershipId: "m", identityId: "i", orgId: "o", orgName: "Sharma & Associates", orgProduct: "firm", email: to,
  level: "owner", roleKind: "owner", weekKey: "2026-W39", today, unsubscribed: false, statutoryOnly: false, alreadySentThisWeek: false,
  owners: [{ membershipId: "m", email: to }], coordinators: [],
  jobs: [
    job({ obligationId: "j1", key: "k1", what: "Put up a notice wherever there is a camera", part: 3 }),
    job({ obligationId: "j2", key: "k2", what: "Mask Aadhaar copies", part: 4, requiredToday: true }),
  ],
  escalatedToMe: [],
}
const links: RenderLinks = { signIn: "https://app.veridian-aios.com/app/", actions: null, unsubscribeUrl: "https://app.veridian-aios.com/unsubscribe/", appHome: "https://app.veridian-aios.com/app/" }

const a = renderDigest(digest, links)
const BRAND = "VERIDIAN · VERy INDIAN — Built for India's DPDP Act. For India, by India."
const ASK = "Know a firm that needs this? Share VERIDIAN"
const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
// B: drop the share-ask paragraph / line only.
const b = {
  subject: a.subject,
  html: a.html.replace(/<p[^>]*>[^<]*Know a firm that needs this\? Share VERIDIAN[\s\S]*?<\/p>/, ""),
  text: a.text.split("\n").filter((l) => !l.startsWith(ASK)).join("\n"),
}
// C: drop the brand line too.
const c = {
  subject: a.subject,
  html: b.html.replace(new RegExp(`<p[^>]*>${escHtml(BRAND).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<\\/p>`), ""),
  text: b.text.split("\n").filter((l) => l !== BRAND).join("\n"),
}
for (const [tag, r, must, mustNot] of [["A", a, [BRAND, ASK], []], ["B", b, [BRAND], [ASK]], ["C", c, [], [BRAND, ASK]]] as const) {
  for (const s of must) if (!r.html.includes(escHtml(s)) || !r.text.includes(s)) throw new Error(`variant ${tag} lost "${s}"`)
  for (const s of mustNot) if (r.html.includes(escHtml(s)) || r.text.includes(s)) throw new Error(`variant ${tag} still has "${s}"`)
}

const stamp = new Date().toISOString().slice(11, 16)
for (const [tag, r] of [["A", a], ["B", b], ["C", c]] as const) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "VERIDIAN AI DPDP <dpdp@send.veridian-aios.com>", to: [to],
      subject: `[placement ${tag} ${stamp}] ${r.subject}`, html: r.html, text: r.text,
      headers: { "List-Unsubscribe": "<https://app.veridian-aios.com/unsubscribe/>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    }),
  })
  const body = await res.json().catch(() => ({}))
  console.log(`variant ${tag}: ${res.status} id=${(body as { id?: string }).id ?? "?"} subject="[placement ${tag} ${stamp}] ${r.subject}"`)
}
