/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-09b (blocker B9, write-path gap G23): the app_runtime pool is 20 unless APP_RUNTIME_POOL_MAX names a whole number from 1 to 50. The
// ai-work-link-exec Edge function sets 2, so one warm isolate does not open 20 pooler connections. Unset or invalid keeps 20 (the value the pool's own
// comments re-measured), so nothing changes for the app.
//
// Falsifiability: break appRuntimePoolMax to return 20 always -> "a valid override is used" fails; to return the env value unchecked -> "an invalid value
// keeps 20" fails.
//
// Run: bun test --isolate src/lib/db/app-runtime-pool-max.test.ts
import { afterEach, describe, expect, test } from "bun:test"
import { appRuntimePoolMax, appRuntimePoolOptions } from "./tenant-scoped"

const saved = process.env.APP_RUNTIME_POOL_MAX
afterEach(() => {
  if (saved === undefined) delete process.env.APP_RUNTIME_POOL_MAX
  else process.env.APP_RUNTIME_POOL_MAX = saved
})

describe("appRuntimePoolMax", () => {
  test("unset keeps 20, and the pool options carry it", () => {
    delete process.env.APP_RUNTIME_POOL_MAX
    expect(appRuntimePoolMax()).toBe(20)
    expect(appRuntimePoolOptions().max).toBe(20)
  })

  test("a valid override is used, in the options too", () => {
    for (const [v, want] of [["2", 2], ["1", 1], ["50", 50], ["15", 15]] as const) {
      process.env.APP_RUNTIME_POOL_MAX = v
      expect({ v, max: appRuntimePoolMax() }).toEqual({ v, max: want })
    }
    process.env.APP_RUNTIME_POOL_MAX = "2"
    expect(appRuntimePoolOptions().max).toBe(2)
  })

  test("an invalid value keeps 20: zero, negative, over 50, a fraction, text, empty", () => {
    for (const v of ["0", "-3", "51", "1000", "2.5", "many", "", " "]) {
      process.env.APP_RUNTIME_POOL_MAX = v
      expect({ v, max: appRuntimePoolMax() }).toEqual({ v, max: 20 })
    }
  })
})
