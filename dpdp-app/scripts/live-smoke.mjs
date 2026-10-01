#!/usr/bin/env node
// WO-DPDP-015: the deployed DPDP site and its two public doors, checked from
// the outside with no credentials, no database and no Vercel. Runs daily from
// .github/workflows/dpdp-live-smoke.yml (a red run is the alarm) and by hand:
//   node scripts/live-smoke.mjs [https://dpdp.veridian-aios.com]
// The workflow runs it against all three hostnames of the one Pages project:
// the apex, dpdp. (the signed-in app, since 2026-10-01) and the legacy app.
// host, whose links are already in sent emails and must keep working.
// DPDP_PEERS=<comma-separated origins> additionally requires the peers to serve
// a byte-identical /robots.txt and the same private-prefix headers.
// It makes GET requests only, plus one POST that must be refused for want of a
// bearer. It changes nothing.
const ORIGIN = (process.argv[2] || process.env.DPDP_ORIGIN || "https://dpdp.veridian-aios.com").replace(/\/+$/, "")
const FUNCTIONS = process.env.DPDP_FUNCTIONS || "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1"
const failures = []
let checks = 0

function check(ok, what, detail = "") {
  checks++
  if (!ok) failures.push(`${what}${detail ? ` -- ${detail}` : ""}`)
}

async function get(path, init) {
  const url = path.startsWith("http") ? path : `${ORIGIN}${path}`
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20_000), ...init })
      return { status: res.status, type: res.headers.get("content-type") || "", body: await res.text(), headers: res.headers }
    } catch (e) {
      if (attempt === 3) return { status: 0, type: "", body: String(e), headers: new Headers() }
      await new Promise((r) => setTimeout(r, 1500 * attempt))
    }
  }
}

// 1. Every public page answers, as HTML.
for (const p of ["/", "/dpdp-firm/", "/dpdp-institution/", "/about/", "/partner/", "/proof/", "/app/", "/act/", "/unsubscribe/", "/copy/"]) {
  const r = await get(p)
  check(r.status === 200 && /text\/html/.test(r.type), `${p} answers 200 as HTML`, `${r.status} ${r.type}`)
}
for (const p of ["/llms.txt", "/robots.txt", "/sitemap.xml"]) {
  const r = await get(p)
  check(r.status === 200, `${p} answers 200`, String(r.status))
}

// 1a. Withdrawn on 2026-10-01 (owner): the AI-only fact sheet, its plain-text copy and facts.json answer a 301 to /about/, never a page.
for (const p of ["/for-ai/", "/for-ai.md", "/facts.json"]) {
  const r = await get(p)
  check(r.status === 301 && /\/about\/$/.test(r.headers.get("location") || ""), `${p} is withdrawn (301 to /about/)`, `${r.status} ${r.headers.get("location") || ""}`)
}

// 1b. One file, three hosts: the private prefixes are never indexed and never cached on ANY of them.
for (const p of ["/app/", "/act/", "/copy/", "/unsubscribe/"]) {
  const r = await get(p)
  check(/noindex/i.test(r.headers.get("x-robots-tag") || ""), `${p} carries X-Robots-Tag noindex`, r.headers.get("x-robots-tag") || "(none)")
  check(/no-store/i.test(r.headers.get("cache-control") || ""), `${p} is Cache-Control no-store`, r.headers.get("cache-control") || "(none)")
}
{
  const robots = await get("/robots.txt")
  check(/^\s*disallow\s*:\s*\/ai\/\s*$/im.test(robots.body), "/robots.txt disallows /ai/")
  for (const peer of (process.env.DPDP_PEERS || "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean)) {
    const other = await get(`${peer}/robots.txt`)
    check(other.status === 200 && other.body === robots.body, `/robots.txt is identical on ${peer} and ${ORIGIN}`, `${other.status}`)
    for (const p of ["/app/", "/act/", "/copy/", "/unsubscribe/"]) {
      const a = await get(p)
      const b = await get(`${peer}${p}`)
      for (const h of ["x-robots-tag", "cache-control", "referrer-policy"]) check((a.headers.get(h) || "") === (b.headers.get(h) || ""), `${p} ${h} is identical on ${peer} and ${ORIGIN}`)
    }
  }
}

// 2. The two edition landing pages open the app, never the old Next.js login.
for (const [path, edition] of [["/dpdp-firm/", "firm"], ["/dpdp-institution/", "institution"]]) {
  const r = await get(path)
  check(r.body.includes(`href="/app/?edition=${edition}"`), `${path}: "Start free" opens /app/?edition=${edition}`)
  check(!/\/dpdp\/login/.test(r.body), `${path}: no link to the old /dpdp/login`)
  check(r.body.includes('href="/app/"'), `${path}: "Sign in" opens /app/`)
}
const root = await get("/")
check(!/\/dpdp\/login/.test(root.body), "/: no link to the old /dpdp/login")
const sitemap = await get("/sitemap.xml")
check(sitemap.body.includes("/dpdp-firm/") && sitemap.body.includes("/dpdp-institution/"), "the sitemap lists both edition pages")
check(sitemap.body.includes("/partner/"), "the sitemap lists the Sales Partner page")
const refJs = await get("/ref.js")
check(refJs.status === 200 && /javascript/i.test(refJs.type) && refJs.body.includes("dpdp-referral"), "/ref.js is served as JavaScript and keeps the referral code", `${refJs.status} ${refJs.type}`)
for (const p of ["/", "/dpdp-firm/", "/dpdp-institution/", "/about/", "/partner/"]) check((await get(p)).body.includes('<script defer src="/ref.js"></script>'), `${p} loads /ref.js`)
const partner = await get("/partner/")
check(!/noindex/i.test(partner.headers.get("x-robots-tag") || "") && !/<meta name="robots"/i.test(partner.body), "/partner/ is indexable (no noindex header, no robots meta)")
check(partner.body.includes('class="btn" href="/app/">Become a Sales Partner</a>'), '/partner/: "Become a Sales Partner" opens /app/')

// 3. The external AI work link: an unknown token is refused the same way on every route, and nothing leaks.
const zero = "0".repeat(64)
for (const sub of ["", "/manual.md", "/context", "/jobs", "/snapshot.md"]) {
  const r = await get(`/ai/${zero}${sub}`)
  check(r.status === 410 && /expired or was revoked/.test(r.body), `/ai/<unknown>${sub} is refused with the one sentence`, `${r.status} ${r.body.slice(0, 80)}`)
}
const short = await get("/ai/not-a-token")
check(short.status === 404, "/ai/<malformed> is a 404 and is never forwarded", String(short.status))
const write = await get(`/ai/${zero}/actions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ verb: "NOTE", job_id: "x", value: { text: "x" } }) })
check([403, 404, 410].includes(write.status), "a write with an unknown token is refused", String(write.status))

// 4. The Monday email worker: no bearer -> 401; a bad unsubscribe token -> 400. (Public, changes nothing.)
const worker = await get(`${FUNCTIONS}/dpdp-monday-email`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
check(worker.status === 401, "the Monday worker refuses a call with no bearer", String(worker.status))
const unsub = await get(`${FUNCTIONS}/dpdp-monday-email?action=unsubscribe&t=nope`)
check(unsub.status === 400, "a bad unsubscribe link is refused", String(unsub.status))

if (failures.length) {
  console.error(`dpdp live smoke: ${failures.length} of ${checks} checks FAILED against ${ORIGIN}`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`dpdp live smoke: OK -- ${checks} checks passed against ${ORIGIN}`)
