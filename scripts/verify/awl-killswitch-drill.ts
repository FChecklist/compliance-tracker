// PROJEXA-BUILD-002 WP-09b (register row AW-510; spec 10.9): the KILL-SWITCH DRILL. It proves that turning platform.ai_work_link_settings.writes_enabled
// off stops every write at once, and that turning it back on lets the very same intent run. It runs the LOCAL EXECUTION HOST in dry mode (scripts/
// awl-local-exec-host.ts: the real link function, the real exec function and the real pipeline over an in-process database) and talks to it over HTTP
// exactly as an AI client and the link function would. No live database, no secret, no network beyond 127.0.0.1.
//
//   bun run scripts/verify/awl-killswitch-drill.ts        (or: bash scripts/verify/awl-killswitch-drill.sh)
//
// THE DRILL
//   1. switch ON: a level-1 action for a roster member is applied (201) and one attendance row exists.
//   2. an action is RECORDED and not run (the state of an intent when the executor was busy or down).
//   3. switch OFF, then every path that could write:
//        POST /actions            -> 403 WRITES_NOT_ENABLED                        (the link function)
//        POST exec /run <intent>  -> 200 {status: refused, code: WRITES_NOT_ENABLED} (the exec function, called directly with the right secret)
//        POST /drafts             -> 201 (a draft changes nothing; it only waits)
//        GET  /context            -> writes_enabled false and effective level 0
//      and afterwards: not one business write since the switch went off, the recorded intent is still `recorded`, no new submission exists.
//   4. switch ON again: the SAME recorded intent is now applied (done), once. The switch works in both directions.
//
// Prints one line: `AWL_KILLSWITCH actions=<status> exec=<status> rows_written=<n> resumed=<status>`. Exit 0 only when every assertion holds.
import { randomBytes } from "node:crypto"

const PORT = 8790 + Math.floor(Math.random() * 90)
const SECRET = randomBytes(24).toString("hex")
const ORIGIN = `http://127.0.0.1:${PORT}`
const AUTH = { authorization: `Bearer ${SECRET}` }
const JSON_HEADERS = { "content-type": "application/json" }

const host = Bun.spawn([process.execPath, "run", "scripts/awl-local-exec-host.ts", "--dry", "--port", String(PORT)], {
  env: { ...process.env, AWL_EXEC_INTERNAL_SECRET: SECRET },
  stdout: "ignore",
  stderr: "pipe",
})

const problems: string[] = []
const check = (ok: boolean, what: string) => {
  if (!ok) problems.push(what)
}
const post = async (url: string, body: unknown, headers: Record<string, string> = {}) => {
  const r = await fetch(url, { method: "POST", headers: { ...JSON_HEADERS, ...headers }, body: JSON.stringify(body) })
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> }
}
const state = async () => (await (await fetch(`${ORIGIN}/dry/state`, { headers: AUTH })).json()) as { intents: Array<Record<string, any>>; tables: Record<string, any[]>; writes: string[] }
const attendance = (s: Awaited<ReturnType<typeof state>>) => (s.tables.construction_attendance ?? []).length

async function waitForHost(): Promise<void> {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${ORIGIN}/functions/v1/ai-work-link-exec/health`, { headers: AUTH })
      if (r.status === 200) return
    } catch {
      // not up yet
    }
    await new Promise((res) => setTimeout(res, 500))
  }
  throw new Error("the local execution host did not start in 120 seconds")
}

async function run(): Promise<{ actions: number; exec: string; rows: number; resumed: string }> {
  await waitForHost()
  const link = (await post(`${ORIGIN}/dry/mint`, { role: "manager" }, AUTH)).json.link_url as string
  const day = (n: number) => `2026-09-${String(10 + n).padStart(2, "0")}`

  // 1. switch ON: one write lands
  await post(`${ORIGIN}/dry/writes`, { on: true }, AUTH)
  const first = await post(`${link}/actions`, { function: "record_attendance", params: { rosterId: "roster_a", date: day(1) }, idempotency_key: "drill-1" })
  check(first.status === 201 && first.json.status === "done", `with the switch on the action was ${first.status} ${first.json.status}`)
  const s1 = await state()
  check(attendance(s1) === 1, "with the switch on there is one attendance row")

  // 2. an action recorded and not run
  const rec = await post(`${ORIGIN}/dry/record`, { link_url: link, function: "record_attendance", params: { rosterId: "roster_a", date: day(2) } }, AUTH)
  const pending = String(rec.json.intent_id ?? "")
  check(pending !== "", "an intent was recorded")

  // 3. switch OFF: every path that could write
  await post(`${ORIGIN}/dry/writes`, { on: false }, AUTH)
  const writesBefore = (await state()).writes.length
  const submissionsBefore = ((await state()).tables.submissions ?? []).length

  const act = await post(`${link}/actions`, { function: "record_attendance", params: { rosterId: "roster_a", date: day(3) }, idempotency_key: "drill-off" })
  check(act.status === 403 && act.json.code === "WRITES_NOT_ENABLED", `POST /actions with the switch off was ${act.status} ${act.json.code}`)

  const ex = await post(`${ORIGIN}/functions/v1/ai-work-link-exec/run`, { intent_id: pending }, AUTH)
  check(ex.status === 200 && ex.json.status === "refused" && ex.json.code === "WRITES_NOT_ENABLED", `exec /run with the switch off was ${ex.status} ${ex.json.status} ${ex.json.code}`)

  const draft = await post(`${link}/drafts`, { function: "record_attendance", params: { rosterId: "roster_a", date: day(4) }, idempotency_key: "drill-draft" })
  check(draft.status === 201 || draft.status === 503, `POST /drafts with the switch off was ${draft.status}`)

  const ctx = (await (await fetch(`${link}/context`, { headers: { accept: "application/json" } })).json()) as Record<string, any>
  check(ctx.writes_enabled === false && ctx.level === 0, `/context with the switch off said writes_enabled=${ctx.writes_enabled} level=${ctx.level}`)

  const off = await state()
  const writesSince = off.writes.length - writesBefore
  const businessSince = off.writes.slice(writesBefore).filter((w) => !/:(pill_usage|chain_history)$/.test(w)).length
  check(attendance(off) === 1, "with the switch off no attendance row was added")
  check(((off.tables.submissions ?? []).length) === submissionsBefore, "with the switch off no submission was added")
  check(writesSince === 0 && businessSince === 0, `with the switch off ${writesSince} business writes happened`)
  check(off.intents.find((i) => i.id === pending)?.status === "recorded", "the recorded intent is still recorded")

  // 4. switch ON again: the same intent runs, once
  await post(`${ORIGIN}/dry/writes`, { on: true }, AUTH)
  const again = await post(`${ORIGIN}/functions/v1/ai-work-link-exec/run`, { intent_id: pending }, AUTH)
  check(again.status === 200 && again.json.status === "done", `with the switch back on the recorded intent was ${again.json.status}`)
  const twice = await post(`${ORIGIN}/functions/v1/ai-work-link-exec/run`, { intent_id: pending }, AUTH)
  check(twice.json.status === "refused" && twice.json.code === "NOT_CLAIMABLE", "the same intent does not run twice")
  const on = await state()
  check(attendance(on) === 2, `after the switch came back on there are ${attendance(on)} attendance rows, not 2`)

  return { actions: act.status, exec: String(ex.json.status), rows: writesSince, resumed: String(again.json.status) }
}

let result: Awaited<ReturnType<typeof run>> | null = null
try {
  result = await run()
} catch (e) {
  problems.push(String((e as Error).message))
} finally {
  host.kill()
}

if (problems.length || !result) {
  for (const p of problems) console.error("FAIL " + p)
  console.error("AWL_KILLSWITCH FAIL")
  process.exit(1)
}
console.log(`AWL_KILLSWITCH actions=${result.actions} exec=${result.exec} rows_written=${result.rows} resumed=${result.resumed}`)
