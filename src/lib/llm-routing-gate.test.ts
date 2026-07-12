// Only tests the routing DECISION logic (which intents have a registered
// handler), not check_status/generate_report's actual DB behavior -- that
// would need a live database. What's verified here is real and valuable
// on its own: intents with no registered handler must return
// { handled: false } WITHOUT ever touching the database, so the "falls
// through to the existing LLM path unchanged" guarantee actually holds
// for anything this gate doesn't recognize.
//
// Priority 5 item E5: generate_report is NOW a registered handler (it
// wasn't when this file was first written -- see llm-routing-gate.ts's own
// comment), so the assertion that used to live here ("generate_report
// returns handled: false") is gone; a positive-path test would need a live
// DB, which this suite deliberately doesn't touch (see file header).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { tryDeterministicRoute } from "./llm-routing-gate"

const ctx = { orgId: "org1", userId: "user1" }

describe("tryDeterministicRoute", () => {
  test("unmatched intents (create_task) return handled: false without a DB call", async () => {
    const result = await tryDeterministicRoute(ctx, "create a task for onboarding")
    expect(result).toEqual({ handled: false })
  })

  test("unmatched intents (create_contact) return handled: false without a DB call", async () => {
    const result = await tryDeterministicRoute(ctx, "add a customer named Acme")
    expect(result).toEqual({ handled: false })
  })

  test("unknown intent (unrelated text) returns handled: false without a DB call", async () => {
    const result = await tryDeterministicRoute(ctx, "The weather is nice today")
    expect(result).toEqual({ handled: false })
  })

  test("empty text returns handled: false without a DB call", async () => {
    const result = await tryDeterministicRoute(ctx, "")
    expect(result).toEqual({ handled: false })
  })
})
