// Audit 100: run ONE live work-link test file and save its result as committed evidence (ai-os/audit37/evidence/run-<file>-<UTC time>.json).
//
//   bun scripts/verify/awl-live/run-live.ts link-lifecycle            (the .live.test.ts suffix is optional)
//   bun scripts/verify/awl-live/run-live.ts link-lifecycle -t HEADER  (extra arguments go to `bun test`)
//
// The evidence records: the commit the tests ran on (and whether the tree was dirty), start/end time, every test with pass/fail/skip, its
// time and (redacted) failure text, and - from the function's own [awl-timing] log lines (scripts/verify/awl-timing-logs.ts) - how many calls
// to the function were slow or failed 5xx during the run window, so a shared-database overload shows up IN the evidence instead of being
// hidden. One file at a time, on purpose: the live tests share the database with everyone else and must not hammer it.
import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { redact } from "./live-lib"
import { parseTimingLine, queryLogs, timingLinesSql } from "../awl-timing-logs"

const [name, ...extra] = process.argv.slice(2)
if (!name) {
  console.error("usage: bun scripts/verify/awl-live/run-live.ts <file> [bun test args]")
  process.exit(2)
}
const file = name.endsWith(".ts") ? name : `${name}.live.test.ts`
const rel = `./scripts/verify/awl-live/${file.replace(/^.*[\\/]/, "")}`
const repo = join(import.meta.dir, "..", "..", "..")
const git = (...a: string[]) => (spawnSync("git", a, { cwd: repo, encoding: "utf8" }).stdout ?? "").trim()

const xml = join(tmpdir(), `awl-live-${process.pid}.xml`)
const started = new Date()
const run = spawnSync("bun", ["test", "--isolate", "--reporter=junit", `--reporter-outfile=${xml}`, rel, ...extra], { cwd: repo, encoding: "utf8", timeout: 40 * 60_000 })
const ended = new Date()

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
let report = ""
try { report = readFileSync(xml, "utf8"); rmSync(xml) } catch { /* no report: bun failed before running a test */ }
const tests: Array<{ name: string; result: "pass" | "fail" | "skip"; time_s: number; failure?: string }> = []
for (const m of report.matchAll(/<testcase name="([^"]*)"[^>]*?time="([^"]*)"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g)) {
  const body = m[4] ?? ""
  const failure = /<failure[^>]*?(?:message="([^"]*)")?[^>]*>([\s\S]*?)<\/failure>|<failure[^>]*message="([^"]*)"[^>]*\/>/.exec(body)
  tests.push({
    name: unescape(m[1]),
    result: failure ? "fail" : /<skipped/.test(body) ? "skip" : "pass",
    time_s: Number(m[2]),
    ...(failure ? { failure: redact(unescape(failure[2] || failure[1] || failure[3] || "")).slice(0, 1500) } : {}),
  })
}

// what the function itself logged during the run (log ingestion lags: wait a little so the last calls are in)
let functionCalls: unknown = "not read"
try {
  await new Promise((r) => setTimeout(r, 20_000))
  const rows = await queryLogs(timingLinesSql(), new Date(started.getTime() - 5_000), new Date(Date.now()))
  const lines = rows.map((r) => parseTimingLine(r.event_message)).filter((l) => l !== null)
  functionCalls = {
    note: "every caller of the function in this window, not only this run (the database and the function are shared)",
    calls: lines.length,
    slow_3s_or_more: lines.filter((l) => l!.slow).length,
    failed_5xx: lines.filter((l) => l!.failed).length,
    status_503: lines.filter((l) => l!.status === 503).length,
  }
} catch (e) {
  functionCalls = redact(`could not read the function logs: ${String((e as Error).message)}`)
}

const evidence = {
  file: rel,
  args: extra,
  commit: git("rev-parse", "HEAD"),
  tree_dirty: git("status", "--porcelain", "--", "scripts", "src", "supabase") !== "",
  started_at: started.toISOString(),
  ended_at: ended.toISOString(),
  exit_code: run.status,
  pass: tests.filter((t) => t.result === "pass").length,
  fail: tests.filter((t) => t.result === "fail").length,
  skip: tests.filter((t) => t.result === "skip").length,
  tests,
  function_calls_during_run: functionCalls,
}
const dir = join(repo, "ai-os", "audit37", "evidence")
mkdirSync(dir, { recursive: true })
const out = join(dir, `run-${file.replace(/^.*[\\/]/, "").replace(/\.live\.test\.ts$|\.ts$/, "")}-${started.toISOString().replace(/[:.]/g, "-")}.json`)
writeFileSync(out, redact(JSON.stringify(evidence, null, 2)) + "\n")
console.log(redact(`${rel}: ${evidence.pass} pass, ${evidence.fail} fail, ${evidence.skip} skip (exit ${run.status}); evidence ${out}`))
if (evidence.fail > 0) for (const t of tests.filter((x) => x.result === "fail")) console.log(redact(`  FAIL ${t.name}\n    ${(t.failure ?? "").slice(0, 400)}`))
process.exit(run.status ?? 1)
