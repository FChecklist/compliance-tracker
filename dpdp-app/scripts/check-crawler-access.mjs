#!/usr/bin/env node
// WO-DPDP-012 §3 "Verify from outside": fetch each public page with each of
// the named crawler user agents and record the HTTP status -- any 403 is a
// failure -- and confirm the private app path answers every crawler with
// noindex. Zero dependencies; run against any host:
//
//   node scripts/check-crawler-access.mjs https://veridian-dpdp-app.pages.dev
//
// Exit 0 only when every public page is 200 for every agent AND the private
// path carries X-Robots-Tag: noindex for every agent. The table it prints is
// the evidence line for the go-live checklist (DEPLOY.md §5 #12).
import { pathToFileURL } from "node:url"

export const CRAWLER_AGENTS = [
  ["Googlebot", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
  ["Bingbot", "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36"],
  ["Applebot", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)"],
  ["OAI-SearchBot", "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot"],
  ["ChatGPT-User", "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot"],
  ["ClaudeBot", "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)"],
  ["Claude-User", "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)"],
  ["PerplexityBot", "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)"],
  ["Perplexity-User", "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)"],
]

export const PUBLIC_PATHS = ["/", "/dpdp-firm/", "/dpdp-institution/", "/robots.txt", "/sitemap.xml", "/llms.txt"]
export const PRIVATE_PATHS = ["/app/"]

/** Pure: returns the rows and a boolean verdict; `fetchImpl` is injectable for tests. */
export async function checkCrawlerAccess(baseUrl, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const base = baseUrl.replace(/\/+$/, "")
  const rows = []
  for (const [agent, ua] of CRAWLER_AGENTS) {
    for (const path of PUBLIC_PATHS) {
      const r = await probe(fetchImpl, base + path, ua, timeoutMs)
      rows.push({ agent, path, kind: "public", status: r.status, xRobots: r.xRobots, ok: r.status === 200 && !/noindex/i.test(r.xRobots ?? "") })
    }
    for (const path of PRIVATE_PATHS) {
      const r = await probe(fetchImpl, base + path, ua, timeoutMs)
      rows.push({ agent, path, kind: "private", status: r.status, xRobots: r.xRobots, ok: /noindex/i.test(r.xRobots ?? "") })
    }
  }
  const any403 = rows.some((r) => r.status === 403)
  const ok = rows.every((r) => r.ok) && !any403
  return { ok, any403, rows }
}

async function probe(fetchImpl, url, ua, timeoutMs) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, { headers: { "user-agent": ua, accept: "text/html,*/*" }, redirect: "manual", signal: ctrl.signal })
    return { status: res.status, xRobots: res.headers.get("x-robots-tag") }
  } catch (e) {
    return { status: 0, xRobots: null, error: e instanceof Error ? e.message : String(e) }
  } finally {
    clearTimeout(t)
  }
}

export function formatTable(rows) {
  const w = Math.max(...rows.map((r) => r.agent.length))
  return rows.map((r) => `${r.agent.padEnd(w)}  ${String(r.status).padStart(3)}  ${r.kind.padEnd(7)} ${r.path.padEnd(20)} ${r.xRobots ?? "-"}  ${r.ok ? "ok" : "FAIL"}`).join("\n")
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const baseUrl = process.argv[2]
  if (!baseUrl) { console.error("usage: node scripts/check-crawler-access.mjs <https://host>"); process.exit(2) }
  const result = await checkCrawlerAccess(baseUrl)
  console.log(formatTable(result.rows))
  console.log(`\ncrawler-check: ${result.rows.length} probes, any 403: ${result.any403 ? "YES" : "no"}, verdict: ${result.ok ? "PASS" : "FAIL"}`)
  process.exit(result.ok ? 0 : 1)
}
