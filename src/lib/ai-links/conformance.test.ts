import { afterAll, describe, expect, test } from "bun:test"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { createServer } from "node:net"
import { join } from "node:path"

// BR-229 (PROJEXA-BUILD-001, phase 2, U-44/U-45): the Universal AI Work Link conformance harness, run as a real process against
// the reference mock. The harness (scripts/verify/ai-link/ai_link_conformance.py, Python standard library only) behaves like a
// plain AI that has been given nothing but one pasted link: it reads the Markdown manual at the link, finds the manifest block
// in it, and from then on calls only the URLs the manual listed. The mock (ai_link_mock_server.py) is an in-memory stand-in for
// the future Edge Function. This file proves four things and nothing about a real product:
//   1. a read-only run passes all 19 base checks (H01 to H16, H21, H22, H24) and the run writes 0 rows;
//   2. a dry run of a write (POST /check, GET /propose) leaves both business counters at 0, and a real write does move them, so
//      that assertion cannot pass by the counters being dead;
//   3. with one rule switched off in the mock (--break get-writes: a GET now records an intent) the harness exits 1 and names
//      the checks that must catch it (H12 and H13);
//   4. with a link for the same project handed over as "the other project's link", the isolation check H17 fails and the harness
//      exits 1, while a real project-B link passes it (mutation: other-project token, the test must fail).
// A test that passes only when the harness is right AND fails when a rule is broken is the R74-RULING-03 shape; the full
// 24-check run and all 18 breaks are the harness self-test, scripts/verify/awl-harness.sh selftest (BR-280).
//
// Needs python 3 on PATH as `python` or `python3`; without it this file fails at load with a clear message, it never skips.
// Only localhost is contacted (the mock binds 127.0.0.1 on a free port). No database, no Vercel, no secrets.
// Lives under src/ because bunfig.toml sets [test] root = "src": a test outside it is skipped by CI.

const HARNESS_DIR = join(import.meta.dir, "..", "..", "..", "scripts", "verify", "ai-link")
const MOCK = join(HARNESS_DIR, "ai_link_mock_server.py")
const HARNESS = join(HARNESS_DIR, "ai_link_conformance.py")

// The mock's five built-in links (see T_A .. T_D in ai_link_mock_server.py): A is a manager on project A at level 1,
// B is a manager on project B.
const TOKEN_A = "pxa_" + "a".repeat(64)
const TOKEN_B = "pxa_" + "c".repeat(64)

// H01 to H16, H21, H22, H24: the checks that need no second link and make no write.
const BASE_CHECKS = [
  "H01", "H02", "H03", "H04", "H05", "H06", "H07", "H08", "H09", "H10", "H11", "H12", "H13", "H14", "H15", "H16",
  "H21", "H22", "H24",
]

const JSON_HEADERS = { Accept: "application/json", "Content-Type": "application/json" }

function findPython(): string {
  for (const cmd of ["python", "python3"]) {
    const probe = spawnSync(cmd, ["-c", "import sys; print(sys.version_info[0])"], { encoding: "utf8", timeout: 20_000 })
    if (probe.status === 0 && String(probe.stdout).trim() === "3") return cmd
  }
  throw new Error("python 3 is not on PATH as `python` or `python3`; the AI work link conformance harness is a Python script")
}

const PY = findPython()
const children = new Set<ChildProcess>()

afterAll(() => {
  for (const child of children) child.kill()
  children.clear()
})

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      server.close(() => (port ? resolve(port) : reject(new Error("no free port"))))
    })
  })
}

type Mock = { link: (token: string) => string; stop: () => void }

// Starts the mock on a free localhost port and waits until it answers; `breaks` switches one contract rule off per name.
async function startMock(breaks: string[] = []): Promise<Mock> {
  const port = await freePort()
  const args = [MOCK, "--port", String(port)]
  for (const name of breaks) args.push("--break", name)
  const child = spawn(PY, args, { stdio: "ignore", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } })
  children.add(child)
  const state: { exitCode: number | null } = { exitCode: null }
  child.once("exit", (code) => {
    state.exitCode = code ?? -1
  })
  const stop = () => {
    child.kill()
    children.delete(child)
  }
  const prefix = `http://127.0.0.1:${port}/functions/v1/ai-work-link/`
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (state.exitCode !== null) throw new Error(`the mock server exited early with code ${state.exitCode}`)
    try {
      const res = await fetch(prefix + TOKEN_A, { headers: { Accept: "text/markdown" } })
      await res.text()
      if (res.status === 200) return { link: (token) => prefix + token, stop }
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  stop()
  throw new Error("the mock server did not answer within 20 seconds")
}

type Harness = { code: number | null; out: string; passed: string[]; failed: string[] }

// Runs the harness as a real process. Its exit code is 0 when every selected check passed and 1 otherwise; each check is one
// line `PASS <id> ...` or `FAIL <id> ...`, and the last line is `RESULT: <p> passed, <f> failed`.
function runHarness(args: string[]): Harness {
  const p = spawnSync(PY, [HARNESS, ...args], {
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", PYTHONIOENCODING: "utf-8" },
  })
  const out = `${p.stdout ?? ""}`
  const lines = out.split(/\r?\n/)
  const ids = (prefix: string) => lines.filter((l) => l.startsWith(prefix)).map((l) => l.split(" ")[1])
  return { code: p.status, out, passed: ids("PASS "), failed: ids("FAIL ") }
}

type Context = {
  counters: { intents: number; submissions: number }
  functions: { id: string; kind: string; level: number; example_params: Record<string, unknown> | null }[]
}

async function readContext(link: string): Promise<Context> {
  const res = await fetch(link + "/context", { headers: { Accept: "application/json" } })
  expect(res.status).toBe(200)
  return (await res.json()) as Context
}

describe("AI work link conformance harness against the reference mock (BR-229)", () => {
  test("a read-only run passes all 19 base checks and writes 0 rows", async () => {
    const mock = await startMock()
    try {
      const link = mock.link(TOKEN_A)
      expect((await readContext(link)).counters).toEqual({ intents: 0, submissions: 0 })
      const run = runHarness(["--link", link])
      expect(run.failed).toEqual([])
      expect([...run.passed].sort()).toEqual(BASE_CHECKS)
      expect(run.out).toContain("RESULT: 19 passed, 0 failed")
      expect(run.code).toBe(0)
      // the whole run only read, or dry-ran: the mock still holds 0 intents and 0 submissions
      expect((await readContext(link)).counters).toEqual({ intents: 0, submissions: 0 })
    } finally {
      mock.stop()
    }
  }, 90_000)

  test("a dry run of a write leaves both business counters at 0, while a real write moves them", async () => {
    const mock = await startMock()
    try {
      const link = mock.link(TOKEN_A)
      const before = await readContext(link)
      expect(before.counters).toEqual({ intents: 0, submissions: 0 })
      const write = before.functions.find((f) => f.kind === "write" && f.level === 1 && f.example_params)
      expect(write).toBeDefined()
      const params = write!.example_params!

      const check = await fetch(link + "/check", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ function: write!.id, params }) })
      expect(check.status).toBe(200)
      expect(((await check.json()) as { valid: boolean }).valid).toBe(true)

      const query = Object.entries(params).map(([k, v]) => `p.${k}=${encodeURIComponent(String(v))}`).join("&")
      const propose = await fetch(`${link}/propose?fn=${write!.id}&${query}`, { headers: { Accept: "application/json" } })
      expect(propose.status).toBe(200)
      expect(((await propose.json()) as { confirm_url: string }).confirm_url).toContain("#t=")

      expect((await readContext(link)).counters).toEqual({ intents: 0, submissions: 0 })

      // the contrast that keeps the assertion above honest: the same function, really run, does move both counters
      const real = await fetch(link + "/actions", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ function: write!.id, params, idempotency_key: "conformance-test-1" }),
      })
      expect(real.status).toBe(201)
      expect((await readContext(link)).counters).toEqual({ intents: 1, submissions: 1 })
    } finally {
      mock.stop()
    }
  }, 90_000)

  test("one rule broken in the mock (a GET records an intent): the harness exits 1 and names H12 and H13", async () => {
    const mock = await startMock(["get-writes"])
    try {
      const run = runHarness(["--link", mock.link(TOKEN_A)])
      expect(run.code).toBe(1)
      expect(run.failed).toContain("H12")
      expect(run.failed).toContain("H13")
      expect(run.passed).toContain("H01")
      expect(run.out).toMatch(/RESULT: \d+ passed, [1-9]\d* failed/)
    } finally {
      mock.stop()
    }
  }, 90_000)

  test("other-project token: a real project B link passes H17, a project A link handed over as project B's fails it", async () => {
    const mock = await startMock()
    try {
      const linkA = mock.link(TOKEN_A)
      const good = runHarness(["--link", linkA, "--link-b", mock.link(TOKEN_B)])
      expect(good.failed).toEqual([])
      expect(good.passed).toContain("H17")
      expect(good.code).toBe(0)

      const mutated = runHarness(["--link", linkA, "--link-b", linkA])
      expect(mutated.code).toBe(1)
      expect(mutated.failed).toEqual(["H17"])
    } finally {
      mock.stop()
    }
  }, 90_000)
})
