/// <reference types="bun-types" />
// Covers scripts/check-screen-definition-labels.mjs -- both its own scan logic
// and, crucially, the DRIFT GUARD: that script duplicates the label rule from
// src/lib/services/screen-definitions-labels.ts because it must run under
// plain `node` with no TypeScript build step. The last describe block below
// reads that TypeScript file's real source text and asserts the two copies are
// character-for-character the same rule, so the duplication cannot rot.
//
// The live-database leg of the script (connect, SELECT, exit 1 on a leak) is
// deliberately NOT exercised here: it needs a real DATABASE_URL, and this repo's
// convention is to unit-test the DB-free logic and let the DB leg be proven by
// the job actually running in CI (same split as check-migration-integrity.test.ts).
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  ALLOWED_TEST_LABELS,
  TEST_LABEL_PATTERN_FLAGS,
  TEST_LABEL_PATTERN_SOURCE,
  extractColumnLabels,
  findLeakedTestLabels,
  formatLeakedTestLabelReport,
} from "./check-screen-definition-labels.mjs"

const TS_MODULE_PATH = fileURLToPath(
  new URL("../src/lib/services/screen-definitions-labels.ts", import.meta.url)
)

describe("check-screen-definition-labels: scan logic", () => {
  test("flags the real leaked schedule.timeline label and passes once it reads 'Activity'", () => {
    const leaked = [{ id: "r1", functionId: "schedule.timeline", orgId: null, columns: [{ label: "Activity (HARD-STOP TEST)" }] }]
    const clean = [{ id: "r1", functionId: "schedule.timeline", orgId: null, columns: [{ label: "Activity" }] }]
    expect(findLeakedTestLabels(leaked).length).toBe(1)
    expect(findLeakedTestLabels(clean)).toEqual([])
  })

  test("names a GLOBAL (org_id null) row as leaking into every tenant", () => {
    const leaks = findLeakedTestLabels([
      { id: "a018f269-8375-44a5-a9ed-1060bf4d3efc", functionId: "dashboard.dashboard", orgId: null, columns: [{ label: "Active Projects (HARD-STOP TEST)" }] },
    ])
    expect(formatLeakedTestLabelReport(leaks)).toContain("GLOBAL -- leaks into every tenant")
  })

  test("names the org when the row is org-scoped", () => {
    const leaks = findLeakedTestLabels([
      { id: "r2", functionId: "permits.list", orgId: "org-9", columns: [{ label: "TEST col" }] },
    ])
    expect(formatLeakedTestLabelReport(leaks)).toContain("org org-9")
  })

  test("malformed columns jsonb is skipped, never thrown on", () => {
    expect(extractColumnLabels(null)).toEqual([])
    expect(extractColumnLabels([null, { label: 7 }, { label: "Ok" }])).toEqual([{ index: 2, label: "Ok" }])
    expect(() => findLeakedTestLabels([{ id: "r", functionId: "f", orgId: null, columns: 3 }])).not.toThrow()
  })

  test("a clean registry reports so explicitly", () => {
    expect(formatLeakedTestLabelReport([])).toBe("compliance.screen_definitions: no debug labels found.")
  })
})

describe("check-screen-definition-labels: rule-drift guard vs the TypeScript module", () => {
  const tsSource = readFileSync(TS_MODULE_PATH, "utf8")

  test("the TypeScript module declares the identical pattern source", () => {
    expect(tsSource).toContain(`export const TEST_LABEL_PATTERN_SOURCE = "${TEST_LABEL_PATTERN_SOURCE}"`)
  })

  test("the TypeScript module declares the identical pattern flags", () => {
    expect(tsSource).toContain(`export const TEST_LABEL_PATTERN_FLAGS = "${TEST_LABEL_PATTERN_FLAGS}"`)
  })

  test("both copies of the allowlist are empty -- neither side has quietly gained an exception", () => {
    expect(ALLOWED_TEST_LABELS.size).toBe(0)
    expect(tsSource).toContain("ALLOWED_TEST_LABELS: ReadonlySet<string> = new Set<string>([])")
  })
})
