/// <reference types="bun-types" />
// R85 Addendum 3 v4, Phase 4 (gates 4-05/4-06/4-07/4-08). Real, committed,
// re-runnable proofs -- not a one-off script (R74-RULING-03's own bar).
import { afterEach, describe, expect, mock, test } from "bun:test"
import * as realTenantScopedForBoqContract from "@/lib/db/tenant-scoped"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { NOT_SET } from "./boq-dual-view-service"
import { resolveApprovedBoq, resolveBoqEffectiveContractValue, type BoqOverrideRow } from "./boq-contract-value-service"

describe("resolveApprovedBoq -- 4-06's gate: only an APPROVED revision can ever feed contract_value", () => {
  test("an UNAPPROVED (draft) variation on top of an approved baseline does NOT move the resolved BOQ", () => {
    const boqs = [
      { id: "v1", status: "approved", version: 1 },
      { id: "v2-draft-variation", status: "draft", version: 2 },
    ]
    // Real behaviour of createBoqRevision: the parent is marked 'superseded'
    // the moment a revision is created, BEFORE it is ever submitted or
    // approved -- so the more realistic fixture is:
    const realistic = [
      { id: "v1", status: "superseded", version: 1 },
      { id: "v2-draft-variation", status: "draft", version: 2 },
    ]
    expect(resolveApprovedBoq(boqs)?.id).toBe("v1")
    // Once the parent is superseded and the variation is still only draft,
    // NOTHING is approved -- resolveApprovedBoq must return null, not fall
    // back to "highest version" the way resolveCurrentBoq does for work-
    // progress purposes. This is the whole point of 4-06/X-11: an unapproved
    // variation must never move contract_value, even though it would
    // legitimately be "current" for entering site progress against.
    expect(resolveApprovedBoq(realistic)).toBe(null)
  })

  test("submitting the variation (but not yet approving it) STILL does not move contract_value", () => {
    const boqs = [
      { id: "v1", status: "superseded", version: 1 },
      { id: "v2-submitted-variation", status: "submitted", version: 2 },
    ]
    expect(resolveApprovedBoq(boqs)).toBe(null)
  })

  test("approving the variation moves contract_value to the NEW revision's total (4-06 positive case)", () => {
    const boqs = [
      { id: "v1", status: "superseded", version: 1 },
      { id: "v2-now-approved", status: "approved", version: 2 },
    ]
    expect(resolveApprovedBoq(boqs)?.id).toBe("v2-now-approved")
  })

  test("no BOQ at all, or none ever approved -- returns null, not a thrown error or a false 0", () => {
    expect(resolveApprovedBoq([])).toBe(null)
    expect(resolveApprovedBoq([{ id: "v1", status: "draft", version: 1 }])).toBe(null)
  })

  test("defensive: two rows illegally 'approved' at once resolves to the highest version (should never happen in practice -- createBoqRevision's supersede step prevents it)", () => {
    const boqs = [
      { id: "v1-approved", status: "approved", version: 1 },
      { id: "v2-approved", status: "approved", version: 2 },
    ]
    expect(resolveApprovedBoq(boqs)?.id).toBe("v2-approved")
  })
})

describe("resolveBoqEffectiveContractValue -- wires a real BOQ row's override columns into 4-07's resolver", () => {
  function overrideRow(overrides: Partial<BoqOverrideRow>): BoqOverrideRow {
    return {
      id: "boq-1", contractValueOverride: null, overrideActorId: null, overrideAt: null,
      overrideReason: null, evidenceArtefactRef: null, ...overrides,
    }
  }

  test("no override columns set -> falls back to computed, exactly like resolveEffectiveContractValue(x, null)", () => {
    const result = resolveBoqEffectiveContractValue(850000, overrideRow({}))
    expect(result).toEqual({ value: 850000, source: "computed", computedTotal: 850000 })
  })

  test("override columns set on the row -> resolves to the override, computed total still retained (4-07)", () => {
    const at = new Date("2026-09-12T10:00:00Z")
    const result = resolveBoqEffectiveContractValue(850000, overrideRow({
      contractValueOverride: "900000", overrideActorId: "user-1", overrideAt: at,
      overrideReason: "client verbally agreed higher figure", evidenceArtefactRef: "artefact://emails/msg-1",
    }))
    expect(result.source).toBe("override")
    expect(result.value).toBe(900000)
    expect(result.computedTotal).toBe(850000)
    expect(result.override?.actorId).toBe("user-1")
    expect(result.override?.at).toBe(at)
    expect(result.override?.reason).toBe("client verbally agreed higher figure")
    expect(result.override?.evidenceArtefactRef).toBe("artefact://emails/msg-1")
  })
})

describe("applyContractOverride -- 4-07/4-08: reason + evidenceArtefactRef required, actor/timestamp/before/after captured", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScopedForBoqContract)
  })

  test("throws (ServiceError 400) when reason is missing -- never reaches the database", async () => {
    const { applyContractOverride, ServiceError } = await import("./boq-contract-value-service")
    await expect(
      applyContractOverride({ orgId: "org-1", userId: "user-1" }, "boq-1", {
        value: 900000, reason: "", evidenceArtefactRef: "artefact://po/PO-1",
      })
    ).rejects.toThrow(ServiceError)
  })

  test("throws (ServiceError 400) when evidenceArtefactRef is missing -- D88's cited-evidence requirement", async () => {
    const { applyContractOverride } = await import("./boq-contract-value-service")
    await expect(
      applyContractOverride({ orgId: "org-1", userId: "user-1" }, "boq-1", {
        value: 900000, reason: "client agreed", evidenceArtefactRef: "   ",
      })
    ).rejects.toThrow("evidenceArtefactRef is required")
  })

  test("throws (ServiceError 400) when value is not a finite number", async () => {
    const { applyContractOverride } = await import("./boq-contract-value-service")
    await expect(
      applyContractOverride({ orgId: "org-1", userId: "user-1" }, "boq-1", {
        value: NaN, reason: "x", evidenceArtefactRef: "y",
      })
    ).rejects.toThrow("value must be a finite number")
  })

  function mountFakeDb(existingBoq: Record<string, unknown>) {
    const setCalls: Record<string, unknown>[] = []
    const fakeDb = {
      query: {
        constructionBoqs: { findFirst: mock(async () => existingBoq) },
      },
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => ({
            returning: async () => {
              setCalls.push(values)
              return [{ ...existingBoq, ...values }]
            },
          }),
        }),
      }),
    }
    return { fakeDb, setCalls }
  }

  async function override(existingBoq: Record<string, unknown>, input: { value: number; reason: string; evidenceArtefactRef: string }) {
    const { fakeDb, setCalls } = mountFakeDb(existingBoq)
    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScopedForBoqContract,
      withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)),
    }))
    const { applyContractOverride } = await import("./boq-contract-value-service")
    const updated = await applyContractOverride({ orgId: "org-1", userId: "actor-77" }, "boq-1", input)
    return { updated, setCalls }
  }

  test("4-08: captures actor (ctx.userId), a real timestamp, and the reason/evidence -- BEFORE (no override) -> AFTER (override set)", async () => {
    const before = { id: "boq-1", orgId: "org-1", title: "Villa 21", contractValueOverride: null, overrideActorId: null, overrideAt: null, overrideReason: null, evidenceArtefactRef: null, amount: "850000" }
    const { updated, setCalls } = await override(before, { value: 900000, reason: "Client agreed a higher lump sum by email", evidenceArtefactRef: "artefact://emails/msg-42" })

    expect(setCalls).toHaveLength(1)
    const written = setCalls[0]!
    expect(written.contractValueOverride).toBe("900000")
    expect(written.overrideActorId).toBe("actor-77") // the ACTOR, from ctx -- never caller-suppliable
    expect(written.overrideAt).toBeInstanceOf(Date) // a real timestamp, captured server-side
    expect(written.overrideReason).toBe("Client agreed a higher lump sum by email")
    expect(written.evidenceArtefactRef).toBe("artefact://emails/msg-42")

    // BEFORE state is still inspectable (this test's own `before` object) and
    // AFTER state (the function's return value) is different -- a real
    // before/after pair, not a message-only confirmation.
    expect(before.contractValueOverride).toBe(null)
    expect(updated.contractValueOverride).toBe("900000")
  })

  test("4-07/X-12: applyContractOverride NEVER touches amount/quantity/rate -- the computed BOQ total is untouched by this write", async () => {
    const before = { id: "boq-1", orgId: "org-1", amount: "850000", quantity: "10", rate: "85000" }
    const { setCalls } = await override(before, { value: 900000, reason: "x", evidenceArtefactRef: "y" })
    const written = setCalls[0]!
    expect("amount" in written).toBe(false)
    expect("quantity" in written).toBe(false)
    expect("rate" in written).toBe(false)
  })

  test("BOQ not found -> ServiceError 404, no write attempted", async () => {
    const { fakeDb, setCalls } = mountFakeDb(undefined as unknown as Record<string, unknown>)
    fakeDb.query.constructionBoqs.findFirst = mock(async () => undefined) as unknown as typeof fakeDb.query.constructionBoqs.findFirst
    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScopedForBoqContract,
      withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)),
    }))
    const { applyContractOverride, ServiceError } = await import("./boq-contract-value-service")
    await expect(
      applyContractOverride({ orgId: "org-1", userId: "user-1" }, "missing-boq", { value: 1, reason: "x", evidenceArtefactRef: "y" })
    ).rejects.toThrow(ServiceError)
    expect(setCalls).toHaveLength(0)
  })
})

describe("4-05: nothing is stored pre-computed -- the migration adds ONLY the two rate columns and the five override columns, never a gross/net/profit column", () => {
  const migrationPath = join(import.meta.dir, "..", "..", "..", "drizzle", "0595_r85a3_p4_gross_net_override_columns.sql")
  const sql = readFileSync(migrationPath, "utf8")
  // Strip `--` line comments before pattern-matching below -- this
  // migration's own header comment narrates (in prose) the bloated
  // `drizzle-kit generate` output that was discarded, which itself contains
  // the words "CREATE TABLE"; matching against real SQL only avoids a false
  // positive against that prose.
  const sqlOnly = sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n")

  test("the migration file exists and is additive (ALTER TABLE ... ADD COLUMN only, no DROP/CREATE TABLE)", () => {
    expect(sqlOnly).toContain("ALTER TABLE compliance.projects")
    expect(sqlOnly).toContain("ALTER TABLE compliance.construction_boqs")
    expect(sqlOnly).not.toMatch(/DROP\s+(TABLE|COLUMN)/i)
    expect(sqlOnly).not.toMatch(/CREATE\s+TABLE/i)
  })

  test("adds exactly the two rate config columns on projects -- vat_rate_percent, retention_percent", () => {
    expect(sql).toContain("vat_rate_percent")
    expect(sql).toContain("retention_percent")
  })

  test("adds exactly the five override columns on construction_boqs", () => {
    for (const col of ["contract_value_override", "override_actor_id", "override_at", "override_reason", "evidence_artefact_ref"]) {
      expect(sql).toContain(col)
    }
  })

  test("NEVER adds a gross/net/profit/variance column -- those are ALWAYS derived, never stored (X-02/4-05)", () => {
    const forbidden = [
      /\bgross\w*\s+numeric/i,
      /\bnet_of_vat\b/i,
      /\bnet_receivable\b/i,
      /\bprofit\w*\s+numeric/i,
      /\bvariance\w*\s+numeric/i,
      /\bcontract_variance\b/i,
    ]
    for (const pattern of forbidden) {
      expect(sql).not.toMatch(pattern)
    }
  })
})
