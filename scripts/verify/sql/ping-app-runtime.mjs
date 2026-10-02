// node/bun scripts/verify/sql/ping-app-runtime.mjs : can THIS machine open the app_runtime connection the exec pipeline uses? Prints the role and the time, never the URL.
import dns from "node:dns"
if (process.env.PX_IPV4 === "1") dns.setDefaultResultOrder("ipv4first")
import { readFileSync } from "node:fs"
import postgres from "postgres"
const env = readFileSync("C:/ct/ct/.env.local", "utf8")
const url = env.match(/^APP_RUNTIME_DATABASE_URL=(.*)$/m)[1].trim().replace(/^["']|["']$/g, "")
const t0 = Date.now()
const N = Number(process.argv[2] || 1)
const sql = postgres(url, { max: N, connect_timeout: 10, idle_timeout: 30, prepare: false, connection: process.argv[3] === "opts" ? { statement_timeout: 25000, options: "-c idle_in_transaction_session_timeout=30000" } : { statement_timeout: 25000 } })
try {
  const rs = await Promise.all(Array.from({ length: N }, () => sql`select current_user as u`)); const r = rs[0]
  console.log(`connected as ${r[0].u} in ${Date.now() - t0} ms`)
} catch (e) {
  console.log(`FAILED after ${Date.now() - t0} ms: ${String(e?.code ?? e?.message).slice(0, 120)}`)
} finally {
  await sql.end({ timeout: 2 }).catch(() => {})
}
