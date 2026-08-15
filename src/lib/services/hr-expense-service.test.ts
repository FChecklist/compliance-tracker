// Phase 0 HR gap-closure (2026-07-27): tests createExpenseClaim's input
// validation, which runs entirely before withTenantContext is called --
// these guard clauses throw without ever touching the DB, so they're
// testable directly, matching this repo's established pattern of not
// exercising withTenantContext/a live DB from a .test.ts file.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { createExpenseClaim, ServiceError } from "./hr-expense-service"

const ctx = { orgId: "org-1", userId: "user-1" }

describe("createExpenseClaim validation", () => {
  test("rejects a missing category", async () => {
    await expect(createExpenseClaim(ctx, { category: "", amount: 100, expenseDate: "2026-07-01" })).rejects.toThrow(ServiceError)
  })

  test("rejects a zero or negative amount", async () => {
    await expect(createExpenseClaim(ctx, { category: "travel", amount: 0, expenseDate: "2026-07-01" })).rejects.toThrow(ServiceError)
    await expect(createExpenseClaim(ctx, { category: "travel", amount: -50, expenseDate: "2026-07-01" })).rejects.toThrow(ServiceError)
  })

  test("rejects a missing expenseDate", async () => {
    // @ts-expect-error -- deliberately omitting a required field to exercise the guard
    await expect(createExpenseClaim(ctx, { category: "travel", amount: 100 })).rejects.toThrow(ServiceError)
  })
})
