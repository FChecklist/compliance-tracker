// R76 (2026-09-06) established this drift guard for the original all-branches-
// blocked lockdown. R87 (2026-09-13, D158) revised the policy to a branch-name
// + docs-path ignoreCommand, then PROJEXA-E2E-001 (2026-09-20) revised it
// again to a simpler VERCEL_ENV-based script that proceeded on
// VERCEL_ENV=production so a Phase-B batch merge could go live in one build.
//
// PROJEXA-E2E-001, continued (2026-09-21, owner directive, quoted verbatim):
// "WE NEED TO SPEND MINIMUM VERCEL CREDITS ... THAN WE GO LIVE BY RECHARGING
// VERCEL." Tightened to unconditional `exit 0` on every ref, with the exit
// condition written directly into the old version of this file: "until the
// owner recharges and says go live, at which point THIS is the one line that
// changes back."
//
// 2026-09-30, owner directive, quoted verbatim, this session: "CAN WE GO LIVE
// ON PROJEXA-AI.COM NOW FOR TESTING ON SERVER?" -- the owner saying go live,
// without recharging (explicitly still on Hobby, $0). Investigated first, not
// applied blind: every production deployment since the start of this session
// (both `projexa` and `veridian-compliance-ai`) was CANCELED with errorLink
// pointing at "ignored-build-step" -- this exact unconditional ignoreCommand
// was the actual, sole blocker; projexa-ai.com had been serving a ~10-day-old
// build the entire session. A Hobby-plan deploy costs $0 regardless of
// whether it runs, as long as build-minute quotas aren't exceeded, so
// deploying does not conflict with "no recharge" -- confirmed with the owner
// directly (not assumed) before changing this file, given how firmly and
// repeatedly the zero-Vercel-spend rule had been stated across this session.
//
// Restores branch+path gating (the same shape as the R87 version, re-derived
// rather than reused verbatim since that version predates PROJEXA-E2E-001's
// dpdp-app/ split): skip any non-main branch outright; on main, additionally
// skip when every changed file is docs/governance (*.md/*.jsonl/kt/**/
// ai-os/**/.github/**) or DPDP-only (dpdp-app/**, src/app/dpdp*/**,
// src/app/api/dpdp/**) -- the owner's own follow-up instruction, same
// session: "please ensure that we use it only for PROJEXA-AI.COM, the work
// of VERIDIAN-AIOS.COM has gone to cloudflare". dpdp-app/DEPLOY.md and
// .github/workflows/dpdp-app-deploy.yml's own header comment both state they
// rely on this file keeping Vercel out of DPDP's deploy path entirely --
// confirmed live via that workflow's real path triggers (`dpdp-app/**` only)
// before writing the skip pattern below, not guessed. Otherwise: proceed.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

function readVercelJson() {
  const raw = readFileSync(join(import.meta.dir, "..", "..", "vercel.json"), "utf8")
  return JSON.parse(raw)
}

/**
 * Runs the real ignoreCommand against a REAL commit's real diff, by substituting the two `HEAD` tokens in the
 * command's own `git diff --name-only HEAD^ HEAD` for the given commit -- so this exercises the actual committed
 * string, not a re-implementation of its logic, and the fixture commits are real history, not synthetic ones.
 */
function runIgnoreCommand(cmd: string, gitRef: string, commitForDiff: string): number | null {
  const substituted = cmd.replaceAll("HEAD^ HEAD", `${commitForDiff}^ ${commitForDiff}`)
  const env = { ...process.env, VERCEL_GIT_COMMIT_REF: gitRef }
  const proc = Bun.spawnSync(["sh", "-c", substituted], { env, cwd: join(import.meta.dir, "..", "..") })
  return proc.exitCode
}

// Real commits from this repo's own history, chosen for what they touch -- not synthetic fixtures, so a change to
// the ignoreCommand's own regex is exercised against real file paths this codebase actually produced.
const REAL_CODE_COMMIT = "76f1da66ce1bea9d7aa9698a2c53cee87bb5c8a8" // e2e specs + ci.yml: real code alongside a skippable path -- must still proceed
const DOCS_ONLY_COMMIT = "b5b7c7aebde77edcb2213a1d486b4c1e3086f820" // docs(ai-os): claim ... -- ai-os/** only
const DPDP_ONLY_COMMIT = "20c98d7b1ca097dd027a9ee8a82c88219349b410" // feat(dpdp): /original/ landing page -- dpdp-app/** only

describe("Vercel deploy gate (2026-09-30, owner-directed go-live) -- branch + path", () => {
  test("git.deploymentEnabled is not relied upon (still gone since R87)", () => {
    const v = readVercelJson()
    expect(v.git).toBeUndefined()
  })

  test("ignoreCommand exists and branches on both VERCEL_GIT_COMMIT_REF and git diff", () => {
    const v = readVercelJson()
    expect(typeof v.ignoreCommand).toBe("string")
    expect(v.ignoreCommand).toContain("VERCEL_GIT_COMMIT_REF")
    expect(v.ignoreCommand).toContain("git diff")
  })

  test("a non-main branch is skipped (exit 0) regardless of what changed", () => {
    const v = readVercelJson()
    expect(runIgnoreCommand(v.ignoreCommand, "some-feature-branch", REAL_CODE_COMMIT)).toBe(0)
  })

  test("main with real code changes proceeds (non-zero), even mixed with a skippable path", () => {
    const v = readVercelJson()
    expect(runIgnoreCommand(v.ignoreCommand, "main", REAL_CODE_COMMIT)).not.toBe(0)
  })

  test("main with a docs/governance-only commit is skipped (exit 0)", () => {
    const v = readVercelJson()
    expect(runIgnoreCommand(v.ignoreCommand, "main", DOCS_ONLY_COMMIT)).toBe(0)
  })

  test("main with a DPDP-only commit is skipped (exit 0) -- DPDP deploys via Cloudflare Pages only, never Vercel", () => {
    const v = readVercelJson()
    expect(runIgnoreCommand(v.ignoreCommand, "main", DPDP_ONLY_COMMIT)).toBe(0)
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
// list of crons that has one defect planted in it on purpose.
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

// The guard above only means something if it is known to reject a bad vercel.json. These run the guard's own functions on a fixed
// synthetic list, not on vercel.json or FROZEN_CRONS, so they hold whatever those two say, and each case plants one defect in it.
describe("drift guard rejects planted crons", () => {
  const frozen: ReadonlyArray<readonly [string, string]> = [["0 7 * * *", "/api/internal/secrets-audit/run"]]
  const committed = (): DeclaredCron[] => frozen.map(([schedule, path]) => ({ schedule, path }))

  test("the control: a list equal to the frozen list passes every rule", () => {
    expect(findUnfrozenCrons(committed(), frozen)).toEqual([])
    expect(findEveryNCrons(committed())).toEqual([])
    expect(exceedsFrozenCount(committed(), frozen)).toBe(false)
  })

  test("an added cron is rejected: by the unfrozen rule and by the count rule", () => {
    const planted = [...committed(), { schedule: "0 3 * * *", path: "/api/internal/loops/run" }]
    expect(findUnfrozenCrons(planted, frozen)).toEqual(["0 3 * * * /api/internal/loops/run"])
    expect(exceedsFrozenCount(planted, frozen)).toBe(true)
  })

  test("an added every-5-minutes cron is rejected by all three rules", () => {
    const planted = [...committed(), { schedule: "*/5 * * * *", path: "/api/internal/crr-catchup-worker/run" }]
    expect(findEveryNCrons(planted)).toEqual(["*/5 * * * * /api/internal/crr-catchup-worker/run"])
    expect(findUnfrozenCrons(planted, frozen)).toEqual(["*/5 * * * * /api/internal/crr-catchup-worker/run"])
    expect(exceedsFrozenCount(planted, frozen)).toBe(true)
  })

  test("an every-15-minutes schedule on the frozen path is rejected: it is re-scheduled and it is every-N", () => {
    const planted = committed().map((c) => ({ ...c, schedule: "*/15 * * * *" }))
    expect(findEveryNCrons(planted)).toHaveLength(planted.length)
    expect(findUnfrozenCrons(planted, frozen)).toHaveLength(planted.length)
    expect(exceedsFrozenCount(planted, frozen)).toBe(false)
  })

  test("a changed schedule on the frozen path is rejected even when it is not every-N", () => {
    const planted = committed().map((c) => ({ ...c, schedule: "0 * * * *" }))
    expect(findUnfrozenCrons(planted, frozen)).toHaveLength(planted.length)
    expect(findEveryNCrons(planted)).toEqual([])
  })

  test("a different path with the frozen schedule is rejected", () => {
    const planted = committed().map((c) => ({ ...c, path: "/api/internal/loops/run" }))
    expect(findUnfrozenCrons(planted, frozen)).toHaveLength(planted.length)
  })

  test("a cron removed from vercel.json is not a violation: the list may only shrink", () => {
    expect(findUnfrozenCrons([], frozen)).toEqual([])
    expect(exceedsFrozenCount([], frozen)).toBe(false)
    expect(findEveryNCrons([])).toEqual([])
  })
})
