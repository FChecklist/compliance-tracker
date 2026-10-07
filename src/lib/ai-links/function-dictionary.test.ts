/// <reference types="bun-types" />
// The function dictionary (supabase/functions/ai-work-link/dictionary.ts): an AI must be able to learn what exists and how to call each function without
// guessing. These tests tie it to the registry so it cannot drift: every function has fields, every required name is a field, and every worked example uses only
// parameter names the link accepts and covers each required field (so an example can never teach a call that the link would refuse).
import { describe, expect, test } from "bun:test"
import { LINK_FUNCTIONS } from "../../../supabase/functions/ai-work-link/api-definition"
import { dictionaryEntry, exampleOf, fieldsOf, signatureOf } from "../../../supabase/functions/ai-work-link/dictionary"
import { handleAwl } from "../../../supabase/functions/ai-work-link/handler"
import { TOKENS, makeFake, req, testConfig } from "../services/__test-helpers__/awl-edge-fake"

describe("every function on a link is fully described", () => {
  test("there are functions, each with a label, a module and at least one required field or none by design", () => {
    expect(LINK_FUNCTIONS.length).toBeGreaterThan(100)
    for (const f of LINK_FUNCTIONS) {
      const e = dictionaryEntry(f)
      expect(e.label.length).toBeGreaterThan(2)
      expect(e.module.length).toBeGreaterThan(1)
      expect(e.steps.length).toBeGreaterThan(1)
    }
  })

  test("every required name is a field of its function, and its type is one of the known ones", () => {
    const types = new Set(["text", "number", "percent", "date", "time", "choice", "file", "id", "list", "flag"])
    for (const f of LINK_FUNCTIONS) {
      const fields = fieldsOf(f)
      for (const r of f.required_params) expect(fields.map((x) => x.name), `${f.function_id} requires ${r.name}`).toContain(r.name)
      for (const x of fields) expect(types.has(x.type), `${f.function_id}.${x.name} has type ${x.type}`).toBe(true)
      expect(fields.filter((x) => x.required).length, f.function_id).toBeGreaterThanOrEqual(f.required_params.length)
    }
  })

  test("every worked example uses only parameter names the link accepts, and gives each required field (or one of its alternatives)", () => {
    for (const f of LINK_FUNCTIONS) {
      const ex = exampleOf(f)
      const accepted = new Set([...f.declared_params, ...f.required_params.flatMap((r) => r.any_of)])
      for (const k of Object.keys(ex)) expect(accepted.has(k), `${f.function_id}: example names "${k}", which the link does not accept`).toBe(true)
      for (const r of f.required_params) {
        if (r.name === "projectId") continue
        expect(r.any_of.some((n) => n in ex), `${f.function_id}: example lacks required ${r.any_of.join(" or ")}`).toBe(true)
      }
    }
  })

  test("the signature marks each required field with a star", () => {
    for (const f of LINK_FUNCTIONS) {
      const sig = signatureOf(f)
      for (const r of f.required_params) if (r.name !== "projectId") expect(sig, f.function_id).toContain(`${r.any_of.join("|")}*`)
    }
  })

  test("typed card fields carry their units and date or percent hints", () => {
    const progress = LINK_FUNCTIONS.find((f) => f.function_id === "record_work_progress")!
    const fields = fieldsOf(progress)
    expect(fields.find((x) => x.name === "percent")).toMatchObject({ type: "percent", required: true, unit: "%" })
    expect(fields.find((x) => x.name === "entryDate")).toMatchObject({ type: "date", required: false })
    expect(fields.find((x) => x.name === "itemCode")?.note).toContain("boqLineItemId")
    const boq = LINK_FUNCTIONS.find((f) => f.function_id === "update_boq")!
    expect(fieldsOf(boq).find((x) => x.name === "boqId")).toMatchObject({ type: "id" })
    expect(fieldsOf(boq).find((x) => x.name === "boqId")?.note).toContain("records/boqs")
  })
})

describe("what an AI sees at /functions", () => {
  async function get(rest: string, accept?: string): Promise<Response> {
    return handleAwl(req(`/${TOKENS.manager}${rest}`, accept ? { headers: { accept } } : undefined), { rpc: makeFake({}).rpc, config: testConfig(), log: () => {} })
  }

  test("the list shows each function's fields in one column", async () => {
    const md = await (await get("/functions")).text()
    expect(md).toContain("| Function | What it does | Module | Kind | Level | Available | Fields |")
    expect(md).toContain("A * marks a required field")
  })

  test("?fn= gives one function in full: a field table and a worked example", async () => {
    const md = await (await get("/functions?fn=record_work_progress")).text()
    expect(md).toContain("## record_work_progress: Record progress")
    expect(md).toContain("| Field | What it is | Type | Required | How to write it |")
    expect(md).toContain("| percent | Percent complete | percent (%) | yes |")
    expect(md).toContain('{"function":"record_work_progress","params":')
  })

  test("?module= gives one area in full, and JSON carries the typed fields", async () => {
    const md = await (await get("/functions?module=work_progress")).text()
    expect(md).toContain("## record_work_progress")
    expect(md).not.toContain("## create_boq:")
    const j = (await (await get("/functions?fn=create_boq", "application/json")).json()) as { functions: Array<{ id: string; fields: Array<{ name: string; required: boolean }>; signature: string }> }
    expect(j.functions.length).toBe(1)
    expect(j.functions[0].fields.find((x) => x.name === "idempotency_key")?.required).toBe(true)
    expect(j.functions[0].signature).toContain("idempotency_key*")
  })
})
