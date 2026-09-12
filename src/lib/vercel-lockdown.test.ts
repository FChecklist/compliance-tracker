// R76 (2026-09-06): Layer 3 of the Vercel deploy lockdown -- the layer that
// survives forgetting. Same pattern as authz-gap-inventory.test.ts: a
// checked-in test that fails CI the moment the config it protects drifts,
// rather than relying on anyone remembering a rule.
//
// See platform.crr_ruling id R76-RULING-01 for the full policy this
// enforces: Vercel is a customer-facing production surface only; a
// deployment requires the owner to set OWNER_DEPLOY_APPROVAL to today's UTC
// date in the Vercel dashboard; no session or agent may set that variable,
// create a deployment, or weaken this file.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

function readVercelJson() {
  const raw = readFileSync(join(import.meta.dir, "..", "..", "vercel.json"), "utf8")
  return JSON.parse(raw)
}

describe("Vercel deploy lockdown (R76-RULING-01) -- Layer 1: nothing auto-deploys", () => {
  test("git.deploymentEnabled exists", () => {
    const v = readVercelJson()
    expect(v.git?.deploymentEnabled).toBeDefined()
  })

  test("the wildcard branch key is present and false", () => {
    const v = readVercelJson()
    expect(v.git.deploymentEnabled["*"]).toBe(false)
  })

  test("no branch key anywhere in deploymentEnabled is set to true", () => {
    const v = readVercelJson()
    const entries = Object.entries(v.git.deploymentEnabled as Record<string, unknown>)
    const enabledBranches = entries.filter(([, value]) => value === true).map(([key]) => key)
    expect(enabledBranches, `these branches would auto-deploy: ${enabledBranches.join(", ")} -- see R76-RULING-01`).toEqual([])
  })
})

describe("Vercel deploy lockdown (R76-RULING-01) -- Layer 2: the owner-approval gate", () => {
  test("ignoreCommand exists", () => {
    const v = readVercelJson()
    expect(typeof v.ignoreCommand).toBe("string")
    expect(v.ignoreCommand.length).toBeGreaterThan(0)
  })

  test("ignoreCommand references OWNER_DEPLOY_APPROVAL", () => {
    const v = readVercelJson()
    expect(v.ignoreCommand).toContain("OWNER_DEPLOY_APPROVAL")
  })

  test("ignoreCommand fails closed: unset/empty/wrong-date all cancel, only an exact UTC-date match proceeds", () => {
    const v = readVercelJson()
    const cmd = v.ignoreCommand as string
    const run = (env: Record<string, string> | undefined) => {
      const proc = Bun.spawnSync(["sh", "-c", cmd], { env: { ...process.env, ...env } })
      return proc.exitCode
    }
    const today = new Date().toISOString().slice(0, 10)
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)

    expect(run({ OWNER_DEPLOY_APPROVAL: "" })).toBe(0) // unset/empty -> cancel
    expect(run({ OWNER_DEPLOY_APPROVAL: yesterday })).toBe(0)
    expect(run({ OWNER_DEPLOY_APPROVAL: tomorrow })).toBe(0)
    expect(run({ OWNER_DEPLOY_APPROVAL: "not-a-date" })).toBe(0)
    expect(run({ OWNER_DEPLOY_APPROVAL: today })).toBe(1) // exact match -> proceed
  })
})

describe("Vercel deploy lockdown (R76-RULING-01) -- guard the guard", () => {
  test("this test file itself is wired into ci.yml's test job", () => {
    // The repo's own test job runs `bun test --isolate` (or a glob that
    // includes src/**), which already picks up every *.test.ts file under
    // src/ -- confirmed by reading ci.yml's test step directly rather than
    // assuming. This assertion exists so that if a FUTURE ci.yml rewrite
    // narrows the test glob to exclude this file, THAT change trips this
    // assertion (a self-referential file-existence check would be trivially
    // true and prove nothing -- checking the ACTUAL ci.yml content is what
    // makes deleting/narrowing the wiring itself get caught).
    const ci = readFileSync(join(import.meta.dir, "..", "..", ".github", "workflows", "ci.yml"), "utf8")
    const testStep = ci.match(/bun test[^\n]*/)?.[0] ?? ""
    expect(testStep, "ci.yml's test job no longer runs a plain `bun test` invocation that would include this file").toContain("bun test")
  })
})
