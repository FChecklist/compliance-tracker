// LIVE signing check of the PROJEXA local-first sync: rows a laptop receives are signed by the server's ES256 key, and the signature verifies independently.
//
// Unlike the other live checks (Management API as the database admin), this one goes through PostgREST with the SERVICE ROLE, exactly as the deployed
// Edge function's `rpc` does (supabase/functions/projexa-sync/index.ts), so it also proves the real grants: the chain's functions are callable by
// service_role. It runs the real handler in this process with the real key caches, which CREATE THE SIGNING KEY on first use (projexa_sync_key_put), the
// same thing the first live isolate would do; it is idempotent (an existing key is used). The session check is the usual `tok:<sub>` stand-in.
//
// It WRITES only that one key row (when none exists yet). Nothing prints a key, a token, a sign-in id or a row's data.
//   bun scripts/verify/projexa-sync-live-signing-check.ts
import { readFileSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createClient } from "@supabase/supabase-js"
import { handleSync, RateLimiter, createKeyCaches, type Rpc, type RpcResult } from "../../supabase/functions/projexa-sync/handler"
import { createSigning, generateKeyRecord, canonicalize, sha256Hex, itemMessageV3, itemMessage, fromB64url } from "../../supabase/functions/projexa-sync/sign"
import type { SessionVerifier } from "../../supabase/functions/ai-work-link/session"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const A_ORG = "4ecc472f-4152-4310-ae8d-cf8b7c52ab6d" // Meridian Construction Group (E2E)

function envValue(name: string): string {
  if (process.env[name]) return process.env[name]!
  for (const p of ["C:/ct/ct/.env.local", join(ROOT, ".env.local")]) {
    if (!existsSync(p)) continue
    const m = readFileSync(p, "utf8").match(new RegExp(`^${name}=(.*)$`, "m"))
    if (m) return m[1].trim().replace(/^["']|["']$/g, "")
  }
  throw new Error(`${name} is not set (environment or .env.local)`)
}
const client = createClient(envValue("NEXT_PUBLIC_SUPABASE_URL"), envValue("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
const rpc: Rpc = async (fn, args): Promise<RpcResult> => {
  const { data, error } = await client.rpc(fn, args)
  return { data, error: error ? { message: error.message, code: error.code ?? undefined } : null }
}
const keys = createKeyCaches({ rpc, createSigning, generateKeyRecord })
const session: SessionVerifier = async (t) => (t.startsWith("tok:") ? { ok: true, sub: t.slice(4), email: null, issuer: "live-check", iat: null } : { ok: false, reason: "invalid" })
const limiter = new RateLimiter(1_000_000)
type J = Record<string, any>
async function hit(sub: string | null, path: string, body?: unknown): Promise<{ status: number; json: J }> {
  const headers: Record<string, string> = { "x-px-client": "live-check; protocol=2; schema=3" }
  if (sub) headers.authorization = `Bearer tok:${sub}`
  const req = new Request(`https://x.supabase.co/functions/v1/projexa-sync/${path}`, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const res = await handleSync(req, { rpc, session, limiter, signing: keys.signing, publicKeys: keys.publicKeys })
  let json: J = {}
  try {
    json = (await res.json()) as J
  } catch {
    /* empty */
  }
  return { status: res.status, json }
}
const results: Array<{ ok: boolean; name: string }> = []
function check(ok: boolean, name: string, note?: string) {
  results.push({ ok, name })
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? `   (${note})` : ""}`)
}

async function main() {
  // the service role reaches the chain's functions (the real grant), and an anonymous caller does not
  let sk = await rpc("projexa_sync_public_keys")
  for (let i = 0; i < 4 && sk.error; i++) {
    await new Promise((r) => setTimeout(r, 2500)) // this laptop's network path blips: retry before calling it a grant problem
    sk = await rpc("projexa_sync_public_keys")
  }
  check(!sk.error, "the service role can call the chain's functions through PostgREST (real grants)", sk.error?.message?.slice(0, 80))
  const anon = createClient(envValue("NEXT_PUBLIC_SUPABASE_URL"), envValue("NEXT_PUBLIC_SUPABASE_ANON_KEY"), { auth: { persistSession: false } })
  const a = await anon.rpc("projexa_sync_public_keys")
  check(!!a.error, "an anonymous caller cannot call them (real grants)", a.error ? `refused: ${String(a.error.code ?? a.error.message).slice(0, 40)}` : "NOT REFUSED")
  const a2 = await anon.rpc("projexa_sync_manifest", { p_sub: "00000000-0000-4000-8000-000000000000", p_email: null })
  check(!!a2.error, "nor the manifest function (an unauthenticated browser cannot read anything)", a2.error ? "refused" : "NOT REFUSED")

  // the fixture person is looked up with the Management API (the compliance schema is not exposed through PostgREST, which is correct)
  const lookup = await fetch(`https://api.supabase.com/v1/projects/${process.env.SUPABASE_PROJECT_REF || "pcrjmlpuqsbocqfwoxod"}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${envValue("SUPABASE_ACCESS_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `select auth_user_id::text as sub from compliance.users where org_id = '${A_ORG}' and role = 'member' and auth_user_id is not null order by id limit 1` }),
  })
  const sub = ((await lookup.json()) as Array<{ sub?: string }>)[0]?.sub
  if (!sub) throw new Error("could not choose a fixture person")

  const m = await hit(sub, "manifest")
  check(m.status === 200, "/manifest answers through the real key caches", `status ${m.status}`)
  // public keys travel in /attest (the peer-trust call), which also creates the signing key on first use before it lists the keys
  const at = await hit(sub, "attest", {})
  check(at.status === 200 && typeof at.json.token === "string", "/attest answers with a signed peer token", `status ${at.status}`)
  const pks: J[] = at.json.public_keys ?? []
  check(pks.length >= 1 && pks.some((k) => k.active), "/attest lists the active public signing key (created now if this was the first use)", `${pks.length} key(s)`)
  const tokenParts = String(at.json.token ?? "").split(".")
  check(tokenParts.length === 3, "the peer token is a compact JWS")
  if (pks[0] && tokenParts.length === 3) {
    const tk = await crypto.subtle.importKey("jwk", pks.find((k) => k.active)!.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, tk, fromB64url(tokenParts[2]), new TextEncoder().encode(`${tokenParts[0]}.${tokenParts[1]}`))
    check(ok, "the peer token's ES256 signature verifies with the published key (a laptop can trust it offline)")
  }

  // find a pull with rows
  let items: J[] = []
  let project = ""
  let kid: string | null = null
  let pulledKind = ""
  const kinds = ["tasks", "boq_lines", "boqs", "milestones", "project"]
  for (const p of (m.json.projects as J[]) ?? []) {
    for (const kind of kinds) {
      const r = await hit(sub, "pull", { project_id: p.id, kind, after: null, limit: 5 })
      if (r.status === 200 && (r.json.items as J[]).length) {
        items = r.json.items
        project = String(p.id)
        kid = r.json.kid ?? null
        pulledKind = kind
        break
      }
    }
    if (items.length) break
  }
  check(items.length > 0 && !!kid, "a pull returns signed rows and the key id", `${items.length} rows`)
  const pub = pks.find((k) => k.kid === kid)
  check(!!pub, "the response's key id is one of the published public keys")
  if (!items.length || !pub) return finish()

  const view = String(m.json.view_class)
  const pubKey = await crypto.subtle.importKey("jwk", pub.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])
  const verify = async (sig: string, message: string) => crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pubKey, fromB64url(sig), new TextEncoder().encode(message))
  let v3ok = 0
  let v2ok = 0
  let tamperRejected = 0
  let wrongViewRejected = 0
  for (const it of items) {
    const base = { org: A_ORG, project, kind: pulledKind, id: String(it.id), version: Number(it.version), updatedAt: String(it.updated_at) }
    const dataHash = await sha256Hex(canonicalize(it.data))
    if (it.sig3 && (await verify(it.sig3, itemMessageV3({ ...base, view, dataHash })))) v3ok++
    if (it.sig && (await verify(it.sig, itemMessage({ ...base, dataHash })))) v2ok++
    const tamperedHash = await sha256Hex(canonicalize({ ...(it.data as object), __tampered: true }))
    if (it.sig3 && !(await verify(it.sig3, itemMessageV3({ ...base, view, dataHash: tamperedHash })))) tamperRejected++
    if (it.sig3 && !(await verify(it.sig3, itemMessageV3({ ...base, view: "0000000000000000", dataHash })))) wrongViewRejected++
  }
  check(v3ok === items.length, "every row's px3 signature (sig3) verifies independently with the published public key", `${v3ok}/${items.length}`)
  check(v2ok === items.length, "every row's px2 signature (sig) verifies too (older laptops)", `${v2ok}/${items.length}`)
  check(tamperRejected === items.length, "a row whose data was changed after signing is rejected by the verifier", `${tamperRejected}/${items.length}`)
  check(wrongViewRejected === items.length, "a row cut for another view class is rejected (px3 commits to the class)", `${wrongViewRejected}/${items.length}`)
  return finish()
}
function finish() {
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length} PASS, ${failed.length} FAIL`)
  if (failed.length) {
    for (const f of failed) console.log("  FAILED:", f.name)
    process.exit(1)
  }
  process.exit(0)
}
main().catch((e) => {
  console.error("ERROR:", String(e?.message ?? e).slice(0, 600))
  process.exit(2)
})
