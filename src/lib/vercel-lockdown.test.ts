// GO-LIVE PACK -- PROJEXA-COST-001 Step 3.3 / PROJEXA-NEXT-001 Step 6.1, prepared
// 2026-09-22 on branch golive/cost001-vercel-json. DO NOT MERGE until the owner
// says "go live" in chat: merging this re-enables real production builds on main.
//
// History of this guard: R76 (2026-09-06) blocked every branch; R87 (2026-09-13,
// D158) replaced the buggy glob-based git.deploymentEnabled with a single
// ignoreCommand that (1) skips any ref that is not literally "main", (2) on main
// skips docs/governance-only diffs (*.md, *.jsonl, kt/**, ai-os/**, .github/**),
// (3) on main proceeds for real application code; PROJEXA-E2E-001 (2026-09-20/21)
// then locked everything to `exit 0` while Vercel credits were exhausted.
//
// This file restores the R87 gate and pins the cost work order's cron decisions:
// the 10 KILL crons are gone from vercel.json, crr-catchup-worker runs every 30
// minutes (the longest interval that meets the real 1-hour SLO in
// platform.crr_spec CRR-090), and the remaining 18 MOVE rows stay here only until
// their pg_cron / GitHub-runner replacements are live. Evidence that the gate
// really skips previews came from the deployments list, not this test: 37 of 37
// non-main preview deployments in the 17-19 Sep 2026 unpaused window were
// CANCELED by the ignored build step (see the 2026-09-22 COST-001 handout).
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const KILLED_CRONS = [
  "the-firm/deadline-digest",
  "ai-performance-report",
  "escalations-report",
  "recommendations-report",
  "risk-trends-report",
  "routing-accuracy-report",
  "cost-anomalies",
  "idle-ai-capacity",
  "role-quality-regression",
  "crm-data-integrity",
]

function readVercelJson() {
  const raw = readFileSync(join(import.meta.dir, "..", "..", "vercel.json"), "utf8")
  return JSON.parse(raw) as { git?: unknown; ignoreCommand: string; crons: Array<{ path: string; schedule: string }> }
}

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "lockdown-test",
  GIT_AUTHOR_EMAIL: "lockdown-test@example.invalid",
  GIT_COMMITTER_NAME: "lockdown-test",
  GIT_COMMITTER_EMAIL: "lockdown-test@example.invalid",
}

function git(cwd: string, ...args: string[]) {
  const proc = Bun.spawnSync(["git", ...args], { cwd, env: gitEnv })
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`)
}

/** A throwaway repo with one base commit touching both app code and docs. */
function makeFixtureRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "vercel-ignore-"))
  git(dir, "init", "-q")
  mkdirSync(join(dir, "src"), { recursive: true })
  mkdirSync(join(dir, "ai-os"), { recursive: true })
  writeFileSync(join(dir, "src", "app.ts"), "export const v = 1\n")
  writeFileSync(join(dir, "README.md"), "# base\n")
  writeFileSync(join(dir, "ai-os", "TRACKER.yaml"), "a: 1\n")
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "base")
  return dir
}

/** Adds a second commit so `git diff HEAD^ HEAD` has exactly these changes. */
function commitChange(dir: string, files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true })
    writeFileSync(join(dir, rel), content)
  }
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "change")
}

/** Runs the real ignoreCommand inside the fixture repo. Vercel: exit 0 = skip, 1 = build. */
function runIgnoreCommand(cmd: string, cwd: string, ref: string | undefined): number | null {
  const env = { ...process.env }
  delete env.VERCEL_GIT_COMMIT_REF
  if (ref !== undefined) env.VERCEL_GIT_COMMIT_REF = ref
  return Bun.spawnSync(["sh", "-c", cmd], { cwd, env }).exitCode
}

const fixtures: string[] = []
function fixtureWith(files: Record<string, string>): string {
  const dir = makeFixtureRepo()
  commitChange(dir, files)
  fixtures.push(dir)
  return dir
}

let cmd = ""
beforeAll(() => {
  cmd = readVercelJson().ignoreCommand
})
afterAll(() => {
  for (const dir of fixtures) rmSync(dir, { recursive: true, force: true })
})

describe("Vercel go-live gate (R87 branch + docs-path ignoreCommand, restored 2026-09-22)", () => {
  test("git.deploymentEnabled is not relied upon (gone since R87 -- its '*' glob never matched a real branch)", () => {
    expect(readVercelJson().git).toBeUndefined()
  })

  test("ignoreCommand is the branch + path gate, not the unconditional skip", () => {
    expect(typeof cmd).toBe("string")
    expect(cmd).toContain('"$VERCEL_GIT_COMMIT_REF" = "main" || exit 0')
    expect(cmd).toContain("git diff --quiet HEAD^ HEAD")
    for (const pattern of ["*.md", "*.jsonl", "kt/**", "ai-os/**", ".github/**"]) {
      expect(cmd).toContain(`:(exclude)${pattern}`)
    }
    expect(cmd).not.toContain("VERCEL_ENV")
  })

  test("main + docs-only diff is skipped (exit 0)", () => {
    const dir = fixtureWith({ "README.md": "# changed\n", "ai-os/TRACKER.yaml": "a: 2\n" })
    expect(runIgnoreCommand(cmd, dir, "main")).toBe(0)
  })

  test("main + application-code diff builds (exit 1)", () => {
    const dir = fixtureWith({ "src/app.ts": "export const v = 2\n" })
    expect(runIgnoreCommand(cmd, dir, "main")).toBe(1)
  })

  test("main + mixed docs and code diff builds (exit 1)", () => {
    const dir = fixtureWith({ "README.md": "# changed\n", "src/app.ts": "export const v = 3\n" })
    expect(runIgnoreCommand(cmd, dir, "main")).toBe(1)
  })

  test("any non-main ref is skipped (exit 0) even with application-code changes -- no preview builds", () => {
    const dir = fixtureWith({ "src/app.ts": "export const v = 4\n" })
    for (const ref of ["feat/thing", "dependabot/npm_and_yarn/next-16.3.5", "preview/demo", "Main", "main "]) {
      expect(runIgnoreCommand(cmd, dir, ref), `ref ${JSON.stringify(ref)} must skip`).toBe(0)
    }
  })

  test("ref unset is skipped (exit 0) -- fail closed, not open", () => {
    const dir = fixtureWith({ "src/app.ts": "export const v = 5\n" })
    expect(runIgnoreCommand(cmd, dir, undefined)).toBe(0)
  })
})

describe("PROJEXA-COST-001 cron decisions pinned in vercel.json", () => {
  test("the 10 KILL crons are no longer scheduled on Vercel", () => {
    const paths = readVercelJson().crons.map((c) => c.path)
    for (const killed of KILLED_CRONS) {
      expect(paths.some((p) => p.includes(`/api/internal/${killed}/`)), `${killed} must be gone`).toBe(false)
    }
  })

  test("crr-catchup-worker polls every 30 minutes (meets CRR-090's 1-hour SLO), never every 15", () => {
    const crr = readVercelJson().crons.find((c) => c.path.includes("crr-catchup-worker"))
    expect(crr?.schedule).toBe("*/30 * * * *")
  })

  test("19 crons remain: secrets-audit (KEEP) + the 18 MOVE rows awaiting their pg_cron / runner replacements", () => {
    const v = readVercelJson()
    expect(v.crons).toHaveLength(19)
    expect(v.crons.some((c) => c.path.includes("secrets-audit"))).toBe(true)
  })
})

describe("Vercel deploy lockdown -- guard the guard", () => {
  test("this test file itself is wired into ci.yml's test job", () => {
    const ci = readFileSync(join(import.meta.dir, "..", "..", ".github", "workflows", "ci.yml"), "utf8")
    const testStep = ci.match(/bun test[^\n]*/)?.[0] ?? ""
    expect(testStep, "ci.yml's test job no longer runs a plain `bun test` invocation that would include this file").toContain("bun test")
  })
})

// BUILD-001 U-41 (register rows BR-328, BR-329), 2026-09-25. PROJEXA-COST-001 caps the Vercel bill at USD 20 a month and every
// Vercel cron is a metered function invocation, so the set of crons in vercel.json may only shrink. This is the list as committed
// on 2026-09-25 (29 crons, one of them every 15 minutes). U-41 will cut it to one cron when the owner releases the go-live pack
// (draft PR #1808); at that point this list shrinks in the same PR. Adding a cron, or changing a schedule, fails this test until
// this list is edited too, and editing this list to allow MORE needs the owner's instruction (CLAUDE.md, R76 lockdown section).
const FROZEN_CRONS: ReadonlyArray<readonly [schedule: string, path: string]> = [
  ["0 2 * * *", "/api/internal/fm-ppm/generate-occurrences/run"],
  ["0 3 * * *", "/api/internal/loops/run"],
  ["0 4 * * *", "/api/internal/instruction-audit/run"],
  ["0 5 * * *", "/api/internal/metric-alerts/run"],
  ["0 6 * * *", "/api/internal/the-firm/deadline-digest/run"],
  ["0 7 * * *", "/api/internal/secrets-audit/run"],
  ["30 7 * * *", "/api/internal/the-firm/recur-engagements/run"],
  ["15 8 * * *", "/api/internal/audit-cadence/run"],
  ["0 1 * * *", "/api/internal/ai-performance-report/run"],
  ["0 8 * * *", "/api/internal/task-nudge-digest/run"],
  ["15 1 * * *", "/api/internal/escalations-report/run"],
  ["30 1 * * *", "/api/internal/recommendations-report/run"],
  ["45 1 * * *", "/api/internal/risk-trends-report/run"],
  ["30 8 * * *", "/api/internal/dispatch-completion-monitor/run"],
  ["45 8 * * *", "/api/internal/report-schedules/run"],
  ["0 9 * * *", "/api/internal/capability-audit/run"],
  ["30 9 * * *", "/api/internal/exchange-rate-refresh/run"],
  ["45 9 * * *", "/api/internal/orchestra-log-purge/run"],
  ["0 1 * * 1", "/api/internal/routing-accuracy-report/run"],
  ["0 2 1 * *", "/api/internal/ai-reduction-snapshot/run"],
  ["15 9 * * *", "/api/internal/cost-anomalies/run"],
  ["0 10 1 1,4,7,10 *", "/api/internal/idle-ai-capacity/run"],
  ["50 9 * * *", "/api/internal/pipeline-stuck-deal-digest/run"],
  ["30 10 * * *", "/api/internal/l2-phrase-promotion/run"],
  ["45 10 * * *", "/api/internal/role-quality-regression/run"],
  ["0 11 * * *", "/api/internal/crm-lead-scoring/run"],
  ["15 11 * * *", "/api/internal/crm-lead-followup-alerts/run"],
  ["30 11 * * 1", "/api/internal/crm-data-integrity/run"],
  ["*/15 * * * *", "/api/internal/crr-catchup-worker/run"],
]

const EVERY_N_SCHEDULE = /^\*\/[0-9]+ /

describe("crons drift guard", () => {
  test("the frozen list itself has no duplicate entry", () => {
    const keys = FROZEN_CRONS.map(([schedule, path]) => `${schedule} ${path}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  test("vercel.json declares no cron (schedule and path) that is not in the frozen list", () => {
    const declared: Array<{ schedule: string; path: string }> = readVercelJson().crons ?? []
    const allowed = new Set(FROZEN_CRONS.map(([schedule, path]) => `${schedule} ${path}`))
    const extra = declared.map((c) => `${c.schedule} ${c.path}`).filter((key) => !allowed.has(key))
    expect(extra, `vercel.json has crons that are not in FROZEN_CRONS (added or re-scheduled): ${extra.join(" | ")}`).toEqual([])
  })

  test("vercel.json declares no more crons than the frozen list", () => {
    const declared: unknown[] = readVercelJson().crons ?? []
    expect(declared.length).toBeLessThanOrEqual(FROZEN_CRONS.length)
  })

  test("the only every-N-minutes cron is the one frozen entry, so no new frequent schedule can appear", () => {
    const declared: Array<{ schedule: string; path: string }> = readVercelJson().crons ?? []
    const frequentDeclared = declared.filter((c) => EVERY_N_SCHEDULE.test(c.schedule)).map((c) => c.path)
    const frequentFrozen = FROZEN_CRONS.filter(([schedule]) => EVERY_N_SCHEDULE.test(schedule)).map(([, path]) => path)
    expect(frequentFrozen).toEqual(["/api/internal/crr-catchup-worker/run"])
    expect(frequentDeclared.sort()).toEqual(frequentFrozen.sort())
  })
})
