#!/usr/bin/env bash
# register: BR-322
# PROJEXA-BUILD-001 phase 3 (U-25, PMD-01, E-07 end to end): the deployed identity gateway (Edge Function projexa-read on
# verdian-ai) isolates organisations for a REAL PROJEXA session. blocked_owner: it needs the access token of a PROJEXA user of
# organisation A, which only the owner can supply (verify commands may not mint sessions, REGISTER_CONVENTIONS 2026-09-25).
#
# Four calls, one line of output:
#   1. that user's token, a project of organisation A          -> 200 expected
#   2. the same token, a project of organisation B             -> 404 expected (another organisation's project is hidden)
#   3. no token                                                  -> 401 expected
#   4. the same token with its payload's iss changed to a foreign issuer (header and signature kept, so the signature no longer
#      matches)                                                  -> 401 expected
# stdout last line: the four status codes, `200 404 401 401` on success (exit 0). Exit 1 = any other code. Exit 2 = cannot run.
#
# THE TOKEN: read from the environment variable PROJEXA_ACCESS_TOKEN inside node, sent only in the Authorization header, and never
# printed, logged, written to a file or put on a command line (no curl, so it never shows in the process list). Nothing about the
# response body is printed either.
#
# Usage (the owner, in his own shell, signed in to PROJEXA as a test user of organisation A):
#   PROJEXA_ACCESS_TOKEN=<access token> PROJECT_A=<project id of org A> PROJECT_B=<project id of org B> \
#     bash scripts/verify/projexa-gateway-isolation.sh
#   Optional PROJEXA_READ_URL (default https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-read).
#   The gateway switch (platform.projexa_gateway_settings.enabled) must be on, or calls 1, 2 and 4 answer 503 / 401.
# Self-test without the owner: bash scripts/verify/projexa-gateway-isolation.sh --self-test
#   starts a local fake gateway (node http on 127.0.0.1, random port) with a made-up token, runs the same four calls and expects
#   `200 404 401 401`; then a second fake that wrongly accepts the altered token, and expects the script to report
#   `200 404 401 200` and exit 1. Last stderr line `PASS BR-322 self-test` or `FAIL BR-322 self-test: <reason>`.
set -u

ID="BR-322"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SELF="$ROOT/scripts/verify/projexa-gateway-isolation.sh"
winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

command -v node >/dev/null 2>&1 || { printf 'FAIL %s: node is not available on PATH\n' "$ID" >&2; exit 2; }

client() {
  node --input-type=module - <<'JS'
const url = process.env.PROJEXA_READ_URL || "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-read"
const token = process.env.PROJEXA_ACCESS_TOKEN || ""
const A = process.env.PROJECT_A || ""
const B = process.env.PROJECT_B || ""
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const cannot = (why) => { console.error(`cannot run: ${why}`); console.error("FAIL BR-322: cannot run"); process.exitCode = 2 }

function altered(t) {
  const parts = t.split(".")
  if (parts.length !== 3) return null
  let payload
  try { payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) } catch { return null }
  payload.iss = "https://foreign-issuer.invalid/auth/v1"
  return `${parts[0]}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${parts[2]}`
}

async function status(project, bearer) {
  const u = new URL(url)
  u.searchParams.set("fn", "boq_lines")
  u.searchParams.set("projectId", project)
  u.searchParams.set("limit", "1")
  const headers = { Accept: "application/json" }
  if (bearer) headers.Authorization = `Bearer ${bearer}`
  try {
    const res = await fetch(u, { method: "GET", headers, signal: AbortSignal.timeout(20000) })
    await res.arrayBuffer()
    return String(res.status)
  } catch {
    return "ERR"
  }
}

async function main() {
  if (!token) return cannot("PROJEXA_ACCESS_TOKEN is not set (the owner supplies it; see the header)")
  if (!ID_RE.test(A) || !ID_RE.test(B) || A === B) return cannot("PROJECT_A and PROJECT_B must be two different project ids")
  const forged = altered(token)
  if (!forged) return cannot("PROJEXA_ACCESS_TOKEN is not a compact JWT")
  const got = [await status(A, token), await status(B, token), await status(A, null), await status(A, forged)]
  console.log(got.join(" "))
  if (got.join(" ") === "200 404 401 401") { console.error("PASS BR-322"); process.exitCode = 0 }
  else { console.error(`FAIL BR-322: expected 200 404 401 401, got ${got.join(" ")}`); process.exitCode = 1 }
}
main()
JS
}

if [ "${1:-}" = "--self-test" ]; then
  [ $# -eq 1 ] || { printf 'FAIL %s self-test: --self-test takes no other argument\n' "$ID" >&2; exit 2; }
  cd "$ROOT" || exit 2
  SELF_PATH="$(winpath "$SELF")" SELF_BASH="$(winpath "$BASH")" node --input-type=module - <<'JS'
import http from "node:http"
import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url")
// A made-up token with the shape of a PROJEXA access token; the fake gateway accepts exactly this string.
const TOKEN = `${b64({ alg: "ES256", typ: "JWT", kid: "self-test" })}.${b64({ iss: "https://evpckeuxgvahguwsaeul.supabase.co/auth/v1", aud: "authenticated", sub: "00000000-0000-4000-8000-000000000001", role: "authenticated", exp: 4102444800 })}.${randomBytes(48).toString("base64url")}`

function fakeGateway(acceptAnyBearer) {
  return http.createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1")
    const auth = req.headers.authorization || ""
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : ""
    let code
    if (!bearer) code = 401
    else if (bearer !== TOKEN && !acceptAnyBearer) code = 401
    else code = u.searchParams.get("projectId") === "proj-org-a" ? 200 : 404
    res.writeHead(code, { "Content-Type": "application/json" })
    res.end(JSON.stringify(code === 200 ? { rows: [] } : { error: "x" }))
  })
}

// Asynchronous on purpose: the fake gateway lives in this same process, so a synchronous spawn would block it from answering.
function runClient(port) {
  return new Promise((resolve) => {
    const child = spawn(process.env.SELF_BASH || "bash", [process.env.SELF_PATH], {
      env: { ...process.env, PROJEXA_READ_URL: `http://127.0.0.1:${port}/functions/v1/projexa-read`, PROJEXA_ACCESS_TOKEN: TOKEN, PROJECT_A: "proj-org-a", PROJECT_B: "proj-org-b" },
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (d) => { stdout += d })
    child.stderr.on("data", (d) => { stderr += d })
    child.on("close", (code) => {
      const out = `${stdout}\n${stderr}`
      resolve({ code, last: stdout.trim().split("\n").pop(), leaked: out.includes(TOKEN) || out.includes(TOKEN.split(".")[2]) })
    })
  })
}

async function withServer(acceptAny, fn) {
  const srv = fakeGateway(acceptAny)
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok))
  try { return await fn(srv.address().port) } finally { await new Promise((ok) => srv.close(ok)) }
}

const good = await withServer(false, async (port) => runClient(port))
const bad = await withServer(true, async (port) => runClient(port))
console.log(`self-test correct gateway: exit=${good.code} line="${good.last}" token_in_output=${good.leaked}`)
console.log(`self-test gateway that accepts the altered token: exit=${bad.code} line="${bad.last}" token_in_output=${bad.leaked}`)
const ok = good.code === 0 && good.last === "200 404 401 401" && bad.code === 1 && bad.last === "200 404 401 200" && !good.leaked && !bad.leaked
console.error(ok ? "PASS BR-322 self-test" : "FAIL BR-322 self-test: see the two lines above")
process.exitCode = ok ? 0 : 1
JS
  exit $?
fi

[ $# -eq 0 ] || { printf 'FAIL %s: unknown argument (use --self-test or no argument)\n' "$ID" >&2; exit 2; }
client
