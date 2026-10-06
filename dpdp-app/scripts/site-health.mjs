// Is veridian-aios.com up, fast and certificate-valid? A free outside-in probe: crash (down / 5xx), response time
// and timeout reports for every public page, run hourly by .github/workflows/dpdp-site-health.yml, or by hand:
//   node scripts/site-health.mjs [origin]
// Exit 1 (so the GitHub run turns red and GitHub emails the repository's watchers) when a page does not answer 200
// with its heading within the timeout (after one retry), when a page is slower than SLOW_MS to finish, when /rum.js or
// the sitemap is missing, when www does not redirect to the apex, or when the TLS certificate has < 14 days left.
// It reports; it changes nothing. These numbers are measured from a GitHub data centre, not from a visitor's phone in
// India: they catch outages and regressions, while the real-visitor speed is in the first-party report (OPERATIONS.md).
import { appendFileSync } from "node:fs"
import tls from "node:tls"

const ORIGIN = (process.argv[2] ?? "https://veridian-aios.com").replace(/\/$/, "")
const TIMEOUT_MS = 15000
const SLOW_MS = 5000
const PAGES = ["/", "/dpdp-firm/", "/dpdp-institution/", "/about/", "/partner/", "/partner/terms/", "/ai-assistant/", "/terms/", "/privacy/", "/disclaimer/", "/pricing/", "/refund/", "/shipping/", "/contact/", "/subprocessors/"]
const rows = []
const problems = []

async function probe(path, { expectText = "<h1", redirect = "follow", expectStatus = 200 } = {}) {
  let last
  for (let attempt = 1; attempt <= 2; attempt++) {
    const t0 = performance.now()
    try {
      const res = await fetch(ORIGIN + path, { redirect, signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": "veridian-site-health/1 (GitHub Actions)" } })
      const headersMs = Math.round(performance.now() - t0)
      const body = await res.text()
      const totalMs = Math.round(performance.now() - t0)
      last = { path, status: res.status, headersMs, totalMs, ok: res.status === expectStatus && (!expectText || body.includes(expectText)), note: res.status === expectStatus ? "" : `HTTP ${res.status}`, location: res.headers.get("location") ?? "" }
      if (last.ok) break
    } catch (e) {
      last = { path, status: 0, headersMs: 0, totalMs: Math.round(performance.now() - t0), ok: false, note: e?.name === "TimeoutError" ? `TIMEOUT after ${TIMEOUT_MS} ms` : `network error: ${e?.message ?? e}` }
    }
    if (attempt === 1) await new Promise((r) => setTimeout(r, 5000))
  }
  return last
}

for (const path of PAGES) {
  const r = await probe(path)
  rows.push(r)
  if (!r.ok) problems.push(`${path}: ${r.note || "the heading is missing from the page"}`)
  else if (r.totalMs > SLOW_MS) problems.push(`${path}: slow, ${r.totalMs} ms to finish (limit ${SLOW_MS} ms)`)
}
for (const [path, opts, label] of [
  ["/rum.js", { expectText: "/api/telemetry" }, "monitoring script"],
  ["/visit.js", { expectText: "/api/visit" }, "visit-journey script"],
  ["/sitemap.xml", { expectText: "<urlset" }, "sitemap"],
  ["/robots.txt", { expectText: "Sitemap:" }, "robots.txt"],
  ["/definitely-not-a-page-" + Date.now() + "/", { expectText: "", expectStatus: 404 }, "unknown address is a real 404"],
]) {
  const r = await probe(path, opts)
  rows.push({ ...r, path: `${path.startsWith("/definitely") ? "/<unknown>/" : path} (${label})` })
  if (!r.ok) problems.push(`${path}: ${r.note || "unexpected content"}`)
}
if (ORIGIN === "https://veridian-aios.com") {
  try {
    const res = await fetch("https://www.veridian-aios.com/", { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) })
    const loc = res.headers.get("location") ?? ""
    const ok = [301, 308].includes(res.status) && loc.startsWith("https://veridian-aios.com")
    rows.push({ path: "www -> apex redirect", status: res.status, headersMs: 0, totalMs: 0, ok, note: ok ? "" : `HTTP ${res.status} ${loc}` })
    if (!ok) problems.push(`www.veridian-aios.com does not redirect to the apex (HTTP ${res.status} ${loc})`)
  } catch (e) {
    problems.push(`www.veridian-aios.com unreachable: ${e?.message ?? e}`)
  }
}

// TLS certificate expiry.
let certDays = null
try {
  const host = new URL(ORIGIN).hostname
  certDays = await new Promise((resolveDays, reject) => {
    const s = tls.connect({ host, port: 443, servername: host, timeout: 10000 }, () => {
      const c = s.getPeerCertificate()
      s.end()
      resolveDays(Math.floor((new Date(c.valid_to).getTime() - Date.now()) / 86400000))
    })
    s.on("error", reject)
    s.on("timeout", () => reject(new Error("TLS handshake timeout")))
  })
  if (certDays < 14) problems.push(`the TLS certificate expires in ${certDays} day(s)`)
} catch (e) {
  problems.push(`TLS check failed: ${e?.message ?? e}`)
}

const lines = [`### ${ORIGIN} health, ${new Date().toISOString()}`, "", "| Page | HTTP | First byte ms | Done ms | Result |", "|---|---|---|---|---|"]
for (const r of rows) lines.push(`| ${r.path} | ${r.status || "-"} | ${r.headersMs} | ${r.totalMs} | ${r.ok ? (r.totalMs > SLOW_MS ? "SLOW" : "ok") : "FAIL " + r.note} |`)
lines.push("", `TLS certificate days left: ${certDays ?? "unknown"}`, "", problems.length ? `**${problems.length} problem(s):**\n${problems.map((p) => `- ${p}`).join("\n")}` : "No problems.")
console.log(lines.join("\n"))
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n")
if (problems.length) {
  console.error(`site-health: ${problems.length} problem(s)`)
  process.exit(1)
}
console.log("site-health: OK")
