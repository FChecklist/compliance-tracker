import { test, expect } from "bun:test"
import { runResyncSingleFlight, summarizeDrift } from "./verify-graph-drift.mjs"

// A fake pooled client: begin(fn) runs fn with a tagged-template "tx" that answers the lock query and the resync query from a script.
function fakeSql({ locked }) {
  const calls = []
  const tx = (strings) => {
    const text = strings.join("?")
    calls.push(text.includes("pg_try_advisory_xact_lock") ? "lock" : text.includes("graph_full_resync") ? "resync" : "other")
    if (text.includes("pg_try_advisory_xact_lock")) return Promise.resolve([{ locked }])
    return Promise.resolve([{ phase: "reconcile", step: "x", row_count: 0 }])
  }
  return { calls, begin: (fn) => fn(tx) }
}

test("a run that gets the lock does the resync and returns its rows", async () => {
  const sql = fakeSql({ locked: true })
  const rows = await runResyncSingleFlight(sql)
  expect(sql.calls).toEqual(["lock", "resync"])
  expect(summarizeDrift(rows).clean).toBe(true)
})

test("a run that does NOT get the lock skips: returns null and never calls graph_full_resync", async () => {
  const sql = fakeSql({ locked: false })
  const rows = await runResyncSingleFlight(sql)
  expect(rows).toBeNull()
  expect(sql.calls).toEqual(["lock"])
})
