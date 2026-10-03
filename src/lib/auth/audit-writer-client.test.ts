/// <reference types="bun-types" />
// Proves the 2026-10-03 change: a timed-out audit statement is CANCELLED and its connection DISCARDED, not merely abandoned by a
// Promise.race (the old behaviour left the query holding a pooled connection). No database, no mocked modules: runAuditStatement
// takes its client access as a parameter.
import { describe, expect, test } from "bun:test"
import { runAuditStatement } from "./audit-writer-client"

type Fake = { cancelled: number }

function fakeAccess() {
  const state = { discarded: 0 }
  const client = {} as never
  return { state, access: { get: () => client, discard: () => { state.discarded += 1 } } }
}

describe("runAuditStatement", () => {
  test("a statement that finishes in time is neither cancelled nor discarded", async () => {
    const { state, access } = fakeAccess()
    const f: Fake = { cancelled: 0 }
    await runAuditStatement(() => Object.assign(Promise.resolve("ok"), { cancel: () => { f.cancelled += 1 } }), 200, access)
    expect(f.cancelled).toBe(0)
    expect(state.discarded).toBe(0)
  })

  test("a statement that never finishes is cancelled, its connection is discarded, and the call rejects", async () => {
    const { state, access } = fakeAccess()
    const f: Fake = { cancelled: 0 }
    const hung = Object.assign(new Promise<void>(() => {}), { cancel: () => { f.cancelled += 1 } })
    await expect(runAuditStatement(() => hung, 20, access)).rejects.toThrow("timed out")
    expect(f.cancelled).toBe(1)
    expect(state.discarded).toBe(1)
  })

  test("a throwing cancel() still discards the connection", async () => {
    const { state, access } = fakeAccess()
    const hung = Object.assign(new Promise<void>(() => {}), { cancel: () => { throw new Error("boom") } })
    await expect(runAuditStatement(() => hung, 20, access)).rejects.toThrow("timed out")
    expect(state.discarded).toBe(1)
  })

  test("a statement that fails fast propagates its error without discarding", async () => {
    const { state, access } = fakeAccess()
    await expect(runAuditStatement(() => Object.assign(Promise.reject(new Error("db down")), { cancel: () => {} }), 200, access)).rejects.toThrow("db down")
    expect(state.discarded).toBe(0)
  })
})
