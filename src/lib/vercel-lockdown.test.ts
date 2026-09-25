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

// BUILD-001 U-41 (register rows BR-328, BR-329, BR-518), 2026-09-26. PROJEXA-COST-001 caps the Vercel bill at USD 20 a month and every
// Vercel cron is a metered function invocation, so the set of crons in vercel.json may only shrink. U-41 part A cut the list from 29
// crons (one of them every 15 minutes) to the one cron that has to run inside the Vercel runtime: secrets-audit checks the env vars
// of the running Vercel process, so no other scheduler can evaluate it. The other 28 went to pg_cron, GitHub Actions or were removed
// (ai-os/projexa-build-001/CRON_PLACEMENT.csv). Adding a cron, or changing a schedule, fails this test until this list is edited too,
// and editing this list to allow MORE needs the owner's instruction (CLAUDE.md, R76 lockdown section).
const FROZEN_CRONS: ReadonlyArray<readonly [schedule: string, path: string]> = [["0 7 * * *", "/api/internal/secrets-audit/run"]]

// The most crons the list may ever hold. Raising it is the same owner decision as adding an entry to FROZEN_CRONS.
const MAX_FROZEN_CRONS = 1

const EVERY_N_SCHEDULE = /^\*\/[0-9]+ /

type DeclaredCron = { schedule: string; path: string }

function cronKey(cron: { schedule: string; path: string }): string {
  return `${cron.schedule} ${cron.path}`
}

// The three rules of the guard, as plain functions so that the "planted defect" tests below can run the very same code on a
// vercel.json that has been changed on purpose.
function findUnfrozenCrons(declared: DeclaredCron[], frozen: ReadonlyArray<readonly [string, string]>): string[] {
  const allowed = new Set(frozen.map(([schedule, path]) => cronKey({ schedule, path })))
  return declared.map(cronKey).filter((key) => !allowed.has(key))
}

function findEveryNCrons(declared: DeclaredCron[]): string[] {
  return declared.filter((c) => EVERY_N_SCHEDULE.test(c.schedule)).map(cronKey)
}

function exceedsFrozenCount(declared: DeclaredCron[], frozen: ReadonlyArray<readonly [string, string]>): boolean {
  return declared.length > frozen.length
}

function declaredCrons(): DeclaredCron[] {
  return readVercelJson().crons ?? []
}

describe("crons drift guard", () => {
  test("the frozen list itself has no duplicate entry", () => {
    const keys = FROZEN_CRONS.map(([schedule, path]) => cronKey({ schedule, path }))
    expect(new Set(keys).size).toBe(keys.length)
  })

  test("the frozen list holds at most MAX_FROZEN_CRONS entries and none of them is an every-N-minutes schedule", () => {
    expect(FROZEN_CRONS.length).toBeLessThanOrEqual(MAX_FROZEN_CRONS)
    expect(MAX_FROZEN_CRONS).toBeLessThanOrEqual(1)
    expect(FROZEN_CRONS.filter(([schedule]) => EVERY_N_SCHEDULE.test(schedule))).toEqual([])
  })

  test("vercel.json declares no cron (schedule and path) that is not in the frozen list", () => {
    const extra = findUnfrozenCrons(declaredCrons(), FROZEN_CRONS)
    expect(extra, `vercel.json has crons that are not in FROZEN_CRONS (added or re-scheduled): ${extra.join(" | ")}`).toEqual([])
  })

  test("vercel.json declares no more crons than the frozen list", () => {
    expect(exceedsFrozenCount(declaredCrons(), FROZEN_CRONS)).toBe(false)
  })

  test("vercel.json declares no every-N-minutes cron, so no frequent schedule can appear", () => {
    const frequent = findEveryNCrons(declaredCrons())
    expect(frequent, `vercel.json has every-N-minutes crons: ${frequent.join(" | ")}`).toEqual([])
  })
})

// The guard above only means something if it is known to reject a bad vercel.json. These run the guard's own functions on a copy of
// the committed crons that has one defect planted in it.
describe("drift guard rejects planted crons", () => {
  const committed = (): DeclaredCron[] => declaredCrons().map((c) => ({ ...c }))

  test("the committed crons pass every rule (the control for the cases below)", () => {
    expect(findUnfrozenCrons(committed(), FROZEN_CRONS)).toEqual([])
    expect(findEveryNCrons(committed())).toEqual([])
    expect(exceedsFrozenCount(committed(), FROZEN_CRONS)).toBe(false)
  })

  test("an added cron is rejected: by the unfrozen rule and by the count rule", () => {
    const planted = [...committed(), { schedule: "0 3 * * *", path: "/api/internal/loops/run" }]
    expect(findUnfrozenCrons(planted, FROZEN_CRONS)).toEqual(["0 3 * * * /api/internal/loops/run"])
    expect(exceedsFrozenCount(planted, FROZEN_CRONS)).toBe(true)
  })

  test("an added every-5-minutes cron is rejected by all three rules", () => {
    const planted = [...committed(), { schedule: "*/5 * * * *", path: "/api/internal/crr-catchup-worker/run" }]
    expect(findEveryNCrons(planted)).toEqual(["*/5 * * * * /api/internal/crr-catchup-worker/run"])
    expect(findUnfrozenCrons(planted, FROZEN_CRONS)).toEqual(["*/5 * * * * /api/internal/crr-catchup-worker/run"])
    expect(exceedsFrozenCount(planted, FROZEN_CRONS)).toBe(true)
  })

  test("an every-15-minutes schedule on the frozen path is rejected: it is re-scheduled and it is every-N", () => {
    const planted = committed().map((c) => ({ ...c, schedule: "*/15 * * * *" }))
    expect(findEveryNCrons(planted)).toHaveLength(planted.length)
    expect(findUnfrozenCrons(planted, FROZEN_CRONS)).toHaveLength(planted.length)
    expect(exceedsFrozenCount(planted, FROZEN_CRONS)).toBe(false)
  })

  test("a changed schedule on the frozen path is rejected even when it is not every-N", () => {
    const planted = committed().map((c) => ({ ...c, schedule: "0 * * * *" }))
    expect(findUnfrozenCrons(planted, FROZEN_CRONS)).toHaveLength(planted.length)
    expect(findEveryNCrons(planted)).toEqual([])
  })

  test("a different path with the frozen schedule is rejected", () => {
    const planted = committed().map((c) => ({ ...c, path: "/api/internal/loops/run" }))
    expect(findUnfrozenCrons(planted, FROZEN_CRONS)).toHaveLength(planted.length)
  })

  test("a cron removed from vercel.json is not a violation: the list may only shrink", () => {
    expect(findUnfrozenCrons([], FROZEN_CRONS)).toEqual([])
    expect(exceedsFrozenCount([], FROZEN_CRONS)).toBe(false)
  })
})
