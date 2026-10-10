#!/usr/bin/env node
// PROJEXA-BUILD-001 U-46b2: a tiny local stand-in for the deployed ai-work-link function and the static pages, used ONLY by
// scripts/verify/awl-scripts.selftest.sh to prove that the awl-*.sh verify scripts pass when the behaviour is there and fail when it is
// not. It is not the product and proves nothing about the product: the real handler is exercised by src/lib/ai-links/conformance.edge.test.ts.
// No database, no secrets, binds 127.0.0.1 only. Prints `PORT <n>` on its first stdout line, then serves until killed.
//
// Usage: node awl-selftest-stub.mjs [--mode a,b,c] [--window-ms 60000]
// Every mode switches ONE rule off (or one defect on); with no mode the stub behaves as the scripts expect.
//   redirect ctype-plain robots-open ua-block no-cors card-token card-big     (awl-reachability.sh)
//   no-limit xff-bypass                                                        (awl-rate-limits.sh)
//   member-leak member-empty member-manager                                    (awl-member-money.sh)
//   static-vercel static-nocode static-404                                     (awl-static-pages.sh)
//   revoke-noop revoke-401 row-active t-never-live demoted-writes              (awl-live-authority.sh)
//   big-slow big-huge big-empty big-500                                        (awl-largest-page.sh)
import http from "node:http"

const argv = process.argv.slice(2)
const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt }
const modes = new Set(opt("--mode", "").split(",").filter(Boolean))
const WINDOW = Number(opt("--window-ms", "60000"))
const has = (m) => modes.has(m)

export const tok = (c) => "pxa_" + c.repeat(64)
const T = { main: tok("a"), member: tok("b"), big: tok("c"), throwaway: tok("d"), demoted: tok("e") }
const OWNER_JWT = "owner-jwt-selftest"
const THROWAWAY_ID = "lnk_throwaway_1"
const state = { revoked: false }
const hits = { link: new Map(), unknown: new Map() }

function count(map, key) {
  const now = Date.now()
  const list = (map.get(key) ?? []).filter((t) => now - t < WINDOW)
  list.push(now)
  map.set(key, list)
  return list.length
}

const MD = "text/markdown; charset=utf-8"
const send = (res, status, body, headers = {}) => { res.writeHead(status, headers); res.end(body) }
const json = (res, status, obj, headers = {}) => send(res, status, JSON.stringify(obj), { "content-type": "application/json; charset=utf-8", ...headers })

function page(html, extra = {}) { return [200, html, { "content-type": "text/html; charset=utf-8", ...extra }] }

function staticPage(name) {
  if (name === "ai-inbox.html") {
    if (has("static-404")) return [404, "not found", { "content-type": "text/plain" }]
    return page('<html><body><input id="confirm-code" maxlength="4"></body></html>', has("static-vercel") ? { "x-vercel-id": "bom1::abc" } : {})
  }
  if (has("static-nocode")) return page("<html><body>confirm</body></html>")
  return page('<html><body><input id="confirm-code" maxlength="4"></body></html>')
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://127.0.0.1")
  const parts = u.pathname.split("/").filter(Boolean)
  const method = req.method ?? "GET"

  if (u.pathname === "/robots.txt") return has("robots-open") ? send(res, 200, "User-agent: *\nDisallow: /\n", { "content-type": "text/plain" }) : send(res, 404, "not found")
  if (parts.length === 1 && (parts[0] === "ai-inbox.html" || parts[0] === "ai-confirm.html")) {
    const [s, b, h] = staticPage(parts[0])
    return send(res, s, b, h)
  }
  if (parts[0] === "__state" && parts[1] === "links" && parts[2]) {
    return json(res, 200, { id: parts[2], status: parts[2] === THROWAWAY_ID && state.revoked && !has("row-active") ? "revoked" : "active" })
  }
  if (parts[0] !== "fn") return send(res, 404, "not found")

  // signed-in app route: POST /fn/links/<id>/revoke
  if (parts[1] === "links" && parts[3] === "revoke") {
    if (method !== "POST") return json(res, 405, { error: "POST only", status: 405 })
    if (has("revoke-401") || req.headers.authorization !== `Bearer ${OWNER_JWT}`) return json(res, 401, { error: "sign in", status: 401 })
    if (parts[2] !== THROWAWAY_ID) return json(res, 404, { error: "no such link", status: 404 })
    if (!has("revoke-noop")) state.revoked = true
    return json(res, 200, { revoked: true })
  }

  const token = parts[1] ?? ""
  if (!/^pxa_[0-9a-f]{64}$/.test(token)) return json(res, 404, { error: "This link is not valid", status: 404 })
  const owner = Object.entries(T).find(([, v]) => v === token)?.[0]
  const rest = parts.slice(2)

  const dead = !owner || (owner === "throwaway" && (state.revoked || has("t-never-live")))
  if (dead) {
    const key = has("xff-bypass") ? String(req.headers["x-forwarded-for"] ?? "none") : "all"
    if (!has("no-limit") && count(hits.unknown, key) > 30) return json(res, 429, { error: "slow down", status: 429 }, { "retry-after": "60" })
    return json(res, 410, { error: "This link has expired or was revoked", status: 410 })
  }
  if (!has("no-limit") && count(hits.link, token) > 120) return json(res, 429, { error: "slow down", status: 429 }, { "retry-after": "60" })

  if (method === "OPTIONS") {
    if (has("no-cors")) return send(res, 405, "")
    return send(res, 204, "", { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS" })
  }
  const ua = String(req.headers["user-agent"] ?? "")

  if (rest.length === 0) {
    if (has("ua-block") && /ChatGPT/i.test(ua)) return send(res, 403, "blocked")
    if (has("redirect")) return send(res, 302, "", { location: "/fn/elsewhere" })
    return send(res, 200, "# Manual\n", { "content-type": has("ctype-plain") ? "text/plain" : MD })
  }
  if (rest[0] === "card.md") {
    let body = "# Card\nRead the link you were given.\n"
    if (has("card-token")) body += `link ${token}\n`
    if (has("card-big")) body += "x".repeat(8100)
    return send(res, 200, body, { "content-type": MD })
  }
  if (rest[0] === "context") {
    if (owner === "member") {
      return json(res, 200, { acting_for: { money_visible: has("member-manager") }, money_fields: { boq_lines: ["rate", "amount"] } })
    }
    return json(res, 200, { level: owner === "demoted" ? 0 : 1, acting_for: { money_visible: true } })
  }
  if (rest[0] === "actions") {
    if (method !== "POST") return json(res, 405, { error: "POST only", status: 405 }, { allow: "POST" })
    if (owner === "demoted") return has("demoted-writes") ? json(res, 201, { ok: true }) : json(res, 403, { error: "Your role no longer allows writes", status: 403 })
    return json(res, 503, { available: false })
  }
  if (rest[0] === "records" && rest[1] === "boq_lines") {
    if (owner === "member") {
      if (has("member-empty")) return json(res, 200, { items: [], next: null })
      const items = [1, 2, 3].map((i) => ({ id: `boq-${i}`, item_code: `EX-0${i}`, rate: has("member-leak") && i === 2 ? 12.5 : null, amount: null }))
      return json(res, 200, { items, next: null })
    }
    if (owner === "big") {
      if (has("big-500")) return json(res, 500, { error: "boom", status: 500 })
      if (has("big-empty")) return json(res, 200, { items: [], next: null })
      const respond = () => {
        const pad = has("big-huge") ? "y".repeat(1_100_000) : ""
        const items = Array.from({ length: 200 }, (_, i) => ({ id: `boq-${i}`, item_code: `EX-${i}`, name: "line", pad: i === 0 ? pad : "" }))
        json(res, 200, { items, next: "x" })
      }
      if (has("big-slow")) return void setTimeout(respond, 2100)
      return respond()
    }
    return json(res, 200, { items: [], next: null })
  }
  return json(res, 404, { error: "No such path", status: 404 })
})

server.listen(0, "127.0.0.1", () => {
  const address = server.address()
  console.log(`PORT ${typeof address === "object" && address ? address.port : 0}`)
})
