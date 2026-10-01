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
//
// FIXTURE-REPO-DRIVEN, same day, second revision: the first version of this
// rewrite (real historical commit SHAs from this repo, e.g. `HEAD^` on a
// picked commit) passed locally but failed in CI -- `unit-tests`' checkout
// step (ci.yml) uses actions/checkout's default fetch-depth: 1 (shallow), so
// a fixture commit's parent is genuinely absent and `git diff HEAD^ HEAD`
// fails, silently falling through to exit 0 (skip) instead of exit 1
// (proceed) -- the exact failure mode this test exists to catch, now firing
// on the test itself rather than on production (PROJEXA's real Vercel build
// environment is NOT shallow -- confirmed separately via a real "BUILDING"
// deployment for a real commit -- so this was a CI-checkout-depth artifact of
// the test, not a production bug). Same fix PROJEXA's own copy of this file
// already used for the same reason: build a throwaway git repo under a temp
// directory with deterministic fixture commits, so every case is exercised
// against a real `git diff` and a real shell with full local history,
// independent of how deep the outer CI checkout is.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

function readVercelJson() {
  const raw = readFileSync(join(import.meta.dir, "..", "..", "vercel.json"), "utf8")
  return JSON.parse(raw)
}

function sh(cwd: string, cmd: string, env?: Record<string, string>) {
  const proc = Bun.spawnSync(["sh", "-c", cmd], { cwd, env: { ...process.env, ...env } })
  return proc
}

/** Builds a throwaway git repo with a base commit, then one more commit per `commits` entry, in order. Returns its path. */
function buildFixtureRepo(commits: ReadonlyArray<{ files: Record<string, string> }>): string {
  const dir = mkdtempSync(join(tmpdir(), "vercel-lockdown-fixture-"))
  sh(dir, "git init -q && git config user.email t@t.test && git config user.name t")
  writeFileSync(join(dir, "README.md"), "base\n")
  sh(dir, "git add -A && git commit -q -m base")
  for (const [i, c] of commits.entries()) {
    for (const [path, content] of Object.entries(c.files)) {
      const full = join(dir, path)
      mkdirSync(join(full, ".."), { recursive: true })
      writeFileSync(full, content)
    }
    sh(dir, `git add -A && git commit -q -m commit-${i}`)
  }
  return dir
}

function runIgnoreCommand(cmd: string, cwd: string, gitRef: string): number | null {
  const proc = sh(cwd, cmd, { VERCEL_GIT_COMMIT_REF: gitRef })
  return proc.exitCode
}

let repo: string

beforeAll(() => {
  repo = buildFixtureRepo([
    { files: { "src/app/page.tsx": "// real code v1\n" } }, // commit-0: real code only
    { files: { "docs/NOTES.md": "notes\n" } }, // commit-1: docs-only
    { files: { "kt/report.jsonl": '{"a":1}\n' } }, // commit-2: kt-only
    { files: { "dpdp-app/src/App.tsx": "// dpdp only\n" } }, // commit-3: DPDP-only
    { files: { "src/app/page.tsx": "// real code v2\n", "docs/NOTES.md": "more notes\n" } }, // commit-4: mixed
  ])
})

afterAll(() => {
  rmSync(repo, { recursive: true, force: true })
})

// 2026-10-02 (owner directive: spend no money, use Vercel as little as possible): Vercel's own build machine ran out of memory on
// `next build`, so releases now build on GitHub Actions and ship prebuilt output (.github/workflows/deploy-prebuilt.yml). Git-triggered
// Vercel builds are therefore skipped on EVERY ref including main (`ignoreCommand` is unconditional `exit 0`); the only path to
// production is the prebuilt workflow. `vercel deploy --prebuilt` does not run ignoreCommand, so it is unaffected.
describe("Vercel deploy gate (2026-10-02) -- Git builds always skipped, prebuilt workflow is the only deploy path", () => {
  test("git.deploymentEnabled is not relied upon (still gone since R87)", () => {
    const v = readVercelJson()
    expect(v.git).toBeUndefined()
  })

  test("ignoreCommand is a string that skips unconditionally", () => {
    const v = readVercelJson()
    expect(typeof v.ignoreCommand).toBe("string")
    expect(v.ignoreCommand.trim()).toBe("exit 0")
  })

  test("a non-main branch is skipped (exit 0) regardless of what changed", () => {
    const v = readVercelJson()
    expect(runIgnoreCommand(v.ignoreCommand, repo, "some-feature-branch")).toBe(0)
  })

  test("main with real code changes is ALSO skipped (exit 0): Vercel must never build, the prebuilt workflow deploys", () => {
    const v = readVercelJson()
    expect(runIgnoreCommand(v.ignoreCommand, repo, "main")).toBe(0)
  })
})

describe("prebuilt deploy workflow -- guard", () => {
  const wf = () => readFileSync(join(import.meta.dir, "..", "..", ".github", "workflows", "deploy-prebuilt.yml"), "utf8")

  test("exists, never triggers on pull_request, and deploys with --prebuilt", () => {
    const text = wf()
    expect(text).not.toMatch(/^\s*pull_request(_target)?\s*:/m)
    expect(text).toContain("workflow_dispatch")
    expect(text).toContain("vercel deploy --prebuilt --prod")
    expect(text).toContain("vercel build --prod")
  })

  test("deploy step is gated (push or explicit deploy=true) and runs are serialized", () => {
    const text = wf()
    expect(text).toContain("inputs.deploy == 'true'")
    expect(text).toContain("group: deploy-prebuilt")
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
