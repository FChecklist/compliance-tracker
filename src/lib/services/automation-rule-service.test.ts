/// <reference types="bun-types" />
// R62 task B4 / fault_id E95_AUTOMATION_PERCENTCOMPLETE_STRING_STRICT_EQUALITY:
// tests the pure conditionsMatch() helper -- the DB-touching parts of this
// service (listAutomationRules/evaluateAndRunRules/etc.) are deliberately
// left untested here, matching this repo's established pattern of not
// exercising a live DB from a .test.ts file (see capability-registry-service
// .test.ts's and task-service.test.ts's own notes on this).
//
// Real bug this file proves: construction-progress-service.ts stores
// percent_complete as a Postgres `numeric` column (schema.ts line ~10182),
// which Drizzle/postgres.js returns as a STRING on .returning() reads (this
// is standard Drizzle numeric-column behavior, done to avoid float
// precision loss) -- see construction-progress-service.ts:144
// (`percentComplete: String(input.percentComplete)`) storing it, and :154-155
// forwarding `row.percentComplete` (a string) straight into the automation
// payload. A rule authored via the API's own createAutomationRule() with
// `triggerConditions: { field: "percentComplete", operator: "equals",
// value: 100 }` stores `value` as a JSON NUMBER in the jsonb column (the
// natural way to enter a 0-100 percent value), which reads back as a JS
// number. conditionsMatch()'s strict `===` then compares the string "100"
// against the number 100 and silently returns false forever -- the rule
// can never fire, with no error anywhere.
import { describe, expect, test } from "bun:test"
import { conditionsMatch } from "./automation-rule-service"

describe("conditionsMatch -- E95 string/number equals mismatch", () => {
  test("matches when payload value (string, as returned by a numeric DB column) equals a numeric rule value", () => {
    // Real shape: row.percentComplete comes back as "100" (string) from a
    // Drizzle `numeric` column; a rule authored with a plain JS number 100
    // must still match it.
    const conditions = { field: "percentComplete", operator: "equals" as const, value: 100 }
    const payload = { activityId: "a1", projectId: "p1", percentComplete: "100" }
    expect(conditionsMatch(conditions, payload)).toBe(true)
  })

  test("matches the reverse shape too -- numeric payload value against a string rule value", () => {
    const conditions = { field: "percentComplete", operator: "equals" as const, value: "100" }
    const payload = { activityId: "a1", projectId: "p1", percentComplete: 100 }
    expect(conditionsMatch(conditions, payload)).toBe(true)
  })

  test("still matches the same-type case (both strings) -- no regression", () => {
    const conditions = { field: "status", operator: "equals" as const, value: "done" }
    const payload = { status: "done" }
    expect(conditionsMatch(conditions, payload)).toBe(true)
  })

  test("still matches the same-type case (both numbers) -- no regression", () => {
    const conditions = { field: "count", operator: "equals" as const, value: 5 }
    const payload = { count: 5 }
    expect(conditionsMatch(conditions, payload)).toBe(true)
  })

  test("still rejects a genuine value mismatch, not just a type mismatch", () => {
    const conditions = { field: "percentComplete", operator: "equals" as const, value: 100 }
    const payload = { percentComplete: "99" }
    expect(conditionsMatch(conditions, payload)).toBe(false)
  })

  test("does not coerce non-numeric strings into a false match (no accidental loose-equality footgun)", () => {
    // Number("") === 0 in JS -- guard against "" spuriously matching 0.
    const conditions = { field: "flag", operator: "equals" as const, value: 0 }
    const payload = { flag: "" }
    expect(conditionsMatch(conditions, payload)).toBe(false)
  })

  test("still allows a rule with no field set to match every event (unchanged short-circuit)", () => {
    expect(conditionsMatch({ operator: "equals" }, { anything: 1 })).toBe(true)
  })

  test("still returns true when conditions is not an object (unchanged short-circuit)", () => {
    expect(conditionsMatch(null, { anything: 1 })).toBe(true)
  })
})
