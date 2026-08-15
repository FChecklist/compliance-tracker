/// <reference types="bun-types" />
// See dispatch-mathematical-engines.test.ts's header for why these dispatch-
// routing tests exist and what they deliberately don't cover.
import { describe, test, expect } from "bun:test"
import { dispatchAccountingEngines } from "./dispatch-accounting-engines"
import { NOT_HANDLED } from "./dispatch-helpers"

describe("dispatchAccountingEngines", () => {
  test("returns NOT_HANDLED for a key outside this category", async () => {
    expect(await dispatchAccountingEngines("job_costing_engine", {})).toBe(NOT_HANDLED)
  })

  test("opening_balance_engine dispatches", async () => {
    expect(await dispatchAccountingEngines("opening_balance_engine", { priorClosingBalance: 500 })).toEqual({ openingBalance: 500 })
  })

  test("balance_verification_engine rejects a non-array balances", async () => {
    expect(dispatchAccountingEngines("balance_verification_engine", { balances: "nope" })).rejects.toThrow("balances must be an array")
  })

  test("consolidation_engine rejects when either array input is missing", async () => {
    expect(dispatchAccountingEngines("consolidation_engine", { entityBalances: [], intercompanyAccountIds: "nope" }))
      .rejects.toThrow("entityBalances and intercompanyAccountIds must both be arrays")
  })

  test("notes_to_accounts_generator rejects a non-array lineItems", async () => {
    expect(dispatchAccountingEngines("notes_to_accounts_generator", { lineItems: {} })).rejects.toThrow("lineItems must be an array")
  })

  test("voucher_validation_engine rejects a non-array lines", async () => {
    expect(dispatchAccountingEngines("voucher_validation_engine", { debitTotal: 1, creditTotal: 1, lines: "nope" })).rejects.toThrow("lines must be an array")
  })

  test("duplicate_entry_detection_engine rejects a non-array entries", async () => {
    expect(dispatchAccountingEngines("duplicate_entry_detection_engine", { entries: "nope" })).rejects.toThrow("entries must be an array")
  })

  test("ledger_reconciliation_engine rejects when either ledger input is missing", async () => {
    expect(dispatchAccountingEngines("ledger_reconciliation_engine", { ledgerA: [], ledgerB: "nope" }))
      .rejects.toThrow("ledgerA and ledgerB must both be arrays")
  })

  test("ledger_reconciliation_engine accepts two real arrays", async () => {
    const result = await dispatchAccountingEngines("ledger_reconciliation_engine", { ledgerA: [], ledgerB: [] })
    expect(result).toBeTruthy()
  })
})
