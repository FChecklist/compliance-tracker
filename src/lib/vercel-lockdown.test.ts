// R76 (2026-09-06) established this drift guard for the original all-branches-
// blocked lockdown. R87 (2026-09-13, D158) revised the policy to a branch-name
// + docs-path ignoreCommand, then PROJEXA-E2E-001 (2026-09-20) revised it
// again to a simpler VERCEL_ENV-based script that proceeded on
// VERCEL_ENV=production so a Phase-B batch merge could go live in one build.
//
// PROJEXA-E2E-001, continued (2026-09-21, owner directive, quoted verbatim):
// "WE NEED TO SPEND MINIMUM VERCEL CREDITS ... THAN WE GO LIVE BY RECHARGING
// VERCEL." Investigated first, not just applied blind: both projects'
// `live` flag was already `false` and every deployment PROJEXA-E2E-001's own
// merges to main had triggered (dpl_HbGeekZ7.../dpl_EwyTrQAQ...) showed
// readyState=BLOCKED with target=null -- the project-pause/spend-cap
// backstop documented in R87's own findings was in fact catching every one
// of them, so no real build/compute was spent by those merges. Tightening
// anyway, on the owner's explicit instruction, rather than relying on that
// backstop as the only line of defense: ignoreCommand is now unconditional
// -- `exit 0` on every ref, VERCEL_ENV included -- so nothing here can ever
// reach a real build again until the owner recharges and says go live,
// at which point THIS is the one line that changes back.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

function readVercelJson() {
  const raw = readFileSync(join(import.meta.dir, "..", "..", "vercel.json"), "utf8")
  return JSON.parse(raw)
}

function runIgnoreCommand(cmd: string, vercelEnv: string | undefined): number | null {
  const env = { ...process.env }
  if (vercelEnv === undefined) {
    delete env.VERCEL_ENV
  } else {
    env.VERCEL_ENV = vercelEnv
  }
  const proc = Bun.spawnSync(["sh", "-c", cmd], { env })
  return proc.exitCode
}

describe("Vercel deploy lockdown (PROJEXA-E2E-001, 2026-09-21) -- ignoreCommand skips unconditionally", () => {
  test("git.deploymentEnabled is not relied upon (still gone since R87)", () => {
    const v = readVercelJson()
    expect(v.git).toBeUndefined()
  })

  test("ignoreCommand exists and does not branch on VERCEL_ENV, branch name, or git diff", () => {
    const v = readVercelJson()
    expect(typeof v.ignoreCommand).toBe("string")
    expect(v.ignoreCommand).not.toContain("VERCEL_ENV")
    expect(v.ignoreCommand).not.toContain("VERCEL_GIT_COMMIT_REF")
    expect(v.ignoreCommand).not.toContain("git diff")
  })

  test("VERCEL_ENV=production is skipped (exit 0) -- no build proceeds until the owner reverts this", () => {
    const v = readVercelJson()
    expect(runIgnoreCommand(v.ignoreCommand, "production")).toBe(0)
  })

  test("VERCEL_ENV=preview is skipped (exit 0) -- every branch/PR build", () => {
    const v = readVercelJson()
    expect(runIgnoreCommand(v.ignoreCommand, "preview")).toBe(0)
  })

  test("VERCEL_ENV=development is skipped (exit 0)", () => {
    const v = readVercelJson()
    expect(runIgnoreCommand(v.ignoreCommand, "development")).toBe(0)
  })

  test("VERCEL_ENV unset is skipped (exit 0) -- fail closed, not open", () => {
    const v = readVercelJson()
    expect(runIgnoreCommand(v.ignoreCommand, undefined)).toBe(0)
  })
})

describe("Vercel deploy lockdown -- guard the guard", () => {
  test("this test file itself is wired into ci.yml's test job", () => {
    // Same rationale as the original R76 version of this test: check the
    // ACTUAL ci.yml content, not just that this file exists, so a future
    // narrowing of the test glob gets caught here.
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
