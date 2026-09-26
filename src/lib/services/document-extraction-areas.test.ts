/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-02, register row AW-113: two areas of one workbook (Play and Vet in the ZOOMIES file) make ONE BOQ, with
// area-prefixed categories and item codes that are unique across sheets.
//
// WHY ONE BOQ. createBoq() always writes version 1, and the "current" BOQ of a project is the highest version, then the latest
// created. Two version-1 BOQs for two areas would make one of them invisible to the dashboard and would raise the exception "Multiple
// versions of the BOQ". The faithful model of two areas is one BOQ with the area in the category.
// WHY PREFIXED CODES. The bill sheets of a PDF-table export restart their numbering at 1 in every bill, and createBoq() refuses two
// lines with one item code. The reader's convention, <AREA>-B<bill>-<number> (PLAY-B3-01), has hyphens and no dot, because createBoq()
// infers a parent line from a dot in an item code.
//
// WHAT IS PROVEN
//   1. The rules as pure checks (checkAreaRules): a category that does not start with an area, a code that does not start with the
//      area's code, a code with a dot, a repeated code (with or without regard to case), two areas with one prefix, an area named
//      twice, a missing code. None of them applies when the answer names no areas (an answer of the first shape is unchanged).
//   2. The rules through the model route: a model that copies each sheet's own numbering ("1.01" in every bill) is refused with
//      extraction_areas_invalid when it names areas and with extraction_boq_invalid (createBoq's own rule) when it does not; nothing
//      is created either way.
//   3. The ZOOMIES workbook through createProjectFromDocument with the REAL createProject() and createBoq() on PGlite (real Postgres in
//      process; only the authentication layer and withTenantContext's connection are replaced), read back from the tables: 1 project,
//      1 BOQ (version 1), 53 lines, 53 distinct item codes of the form PLAY-B..-.. or VET-B..-.., every category starting with
//      "Play Area - " or "Vet Area - ", and the sums of quantity x rate read from the stored rows are 1,343,445 for Play, 252,835 for
//      Vet and 1,596,280 in all, the totals the file prints (VAT excluded). The ledger row is the job record: state created.
//
// Run: bun test --isolate src/lib/services/document-extraction-areas.test.ts
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test"
import * as realTenantScoped from "@/lib/db/tenant-scoped"
import { ExtractionRejectedError, areaCodePrefix, checkAreaRules, validateExtractionOutput, type ExtractedProject, type WorkbookDigest } from "./document-extraction-schema"
import { createExtractionPglite, insertProduct, insertUser } from "./__test-helpers__/document-extraction-pglite"
import { SHARED_SECRET, buildWorkbook, deterministicModel, edgeCallerFor, edgeDeps } from "./__test-helpers__/document-extraction-fixtures"
import { harness, outcome } from "./__test-helpers__/document-extraction-harness"
import { carefulHumanModel } from "./__test-helpers__/zoomies-standin-model"
import { zoomiesWorkbook } from "./__test-helpers__/zoomies-workbook"
import type { ModelCall } from "../../../supabase/functions/projexa-document-extract/handler"

// ---------------------------------------------------------------------------------------------------------- 1. the rules

type Line = ExtractedProject["boq"]["lineItems"][number]
const line = (itemCode: string | undefined, category: string | undefined, row = 2): Line => ({
  source: { sheet: "Bill", row },
  ...(itemCode ? { itemCode } : {}),
  description: "d",
  unit: "m2",
  quantity: 1,
  rate: 1,
  ...(category ? { category } : {}),
})
const answer = (areas: string[] | undefined, lines: Line[]): ExtractedProject => ({
  schema: "boq_project_v1",
  project: { name: "P" },
  boq: { title: "B", lineItems: lines },
  ...(areas ? { areas } : {}),
})

describe("AW-113: the area rules as pure checks", () => {
  test("the area code is the reader's: the word Area and everything that is not a letter or a digit removed, upper case", () => {
    expect(areaCodePrefix("Play Area")).toBe("PLAY")
    expect(areaCodePrefix("Vet Area")).toBe("VET")
    expect(areaCodePrefix("Ground-Floor Area")).toBe("GROUNDFLOOR")
    expect(areaCodePrefix("Area")).toBe("AREA")
  })

  test("lines of the reader's shape pass: category starts with the area, code is AREA-B<bill>-<number>", () => {
    const ok = answer(["Play Area", "Vet Area"], [line("PLAY-B3-01", "Play Area - Partition"), line("VET-B3-01", "Vet Area - Partition"), line("PLAY-B1A-LS", "Play Area - Preliminaries")])
    expect(checkAreaRules(ok)).toEqual([])
  })

  test("nothing applies when the answer names no areas: numbering that restarts in every sheet is left to createBoq's own rule", () => {
    expect(checkAreaRules(answer(undefined, [line("1.01", "Civil"), line("1.01", "Civil", 3)]))).toEqual([])
    expect(checkAreaRules(answer([], [line("1.01", undefined)]))).toEqual([])
  })

  test("each way to break the rules is named", () => {
    const problems = (areas: string[], lines: Line[]) => checkAreaRules(answer(areas, lines)).join(" | ")
    expect(problems(["Play Area"], [line("PLAY-B1-01", "Floor Finishes")])).toContain('category: must start with one of the areas followed by " - "')
    expect(problems(["Play Area"], [line("PLAY-B1-01", undefined)])).toContain("category")
    expect(problems(["Play Area"], [line("3.01", "Play Area - Floor")])).toContain("must be PLAY-B<bill>-<number>")
    expect(problems(["Play Area"], [line("PLAY.B1.01", "Play Area - Floor")])).toContain("no dot")
    expect(problems(["Play Area"], [line("PLAY-01", "Play Area - Floor")])).toContain("must be PLAY-B<bill>-<number>")
    expect(problems(["Play Area", "Vet Area"], [line("VET-B1-01", "Play Area - Floor")])).toContain("must be PLAY-B<bill>-<number>")
    expect(problems(["Play Area"], [line(undefined, "Play Area - Floor")])).toContain("itemCode: is required when the answer names areas")
    expect(problems(["Play Area"], [line("PLAY-B1-01", "Play Area - A"), line("PLAY-B1-01", "Play Area - B", 3)])).toContain('repeats boq.lineItems.0; codes must be unique across sheets')
    // Without regard to case.
    expect(problems(["Play Area"], [line("PLAY-B1-01", "Play Area - A"), line("play-b1-01", "Play area - B", 3)])).toContain("repeats boq.lineItems.0")
    expect(problems(["Play Area", "play area"], [line("PLAY-B1-01", "Play Area - A")])).toContain("an area is named twice")
    expect(problems(["Play Area", "Play"], [line("PLAY-B1-01", "Play Area - A")])).toContain("same code prefix")
  })

  test("a category that only starts like an area is not one: the separator is part of the rule", () => {
    expect(checkAreaRules(answer(["Play Area"], [line("PLAY-B1-01", "Play Area Extension - Floor")])).join(" ")).toContain("category")
    expect(checkAreaRules(answer(["Play Area"], [line("PLAY-B1-01", "play area - floor")]))).toEqual([])
  })
})

// ------------------------------------------------------------------------ 2. the rules through the model route (no database)

const DIGEST: WorkbookDigest = { sheets: [{ name: "Bill", rows: [{ row: 2, cells: ["1.01", "Floor"] }, { row: 3, cells: ["1.01", "Wall"] }] }] }

describe("AW-113: the rules through the model route", () => {
  test("validateExtractionOutput refuses the answer that names areas but breaks the rules, with a stable code", () => {
    const bad = answer(["Play Area", "Vet Area"], [line("1.01", "Play Area - Floor"), line("1.01", "Vet Area - Floor", 3)])
    let error: ExtractionRejectedError | null = null
    try {
      validateExtractionOutput(bad, DIGEST)
    } catch (e) {
      error = e as ExtractionRejectedError
    }
    expect(error).toBeInstanceOf(ExtractionRejectedError)
    expect([error!.code, error!.status]).toEqual(["extraction_areas_invalid", 422])
    expect(error!.issues.length).toBeGreaterThanOrEqual(2)
  })

  // Two sheets of one workbook, each numbered from 1: the restart the ZOOMIES bill sheets have. The reader does not apply (Price).
  const twoSheets = () =>
    buildWorkbook([
      { name: "Play Bill 3", rows: [["Item", "Description", "Unit", "Qty", "Price"], ["1.01", "Floor", "m2", 10, 500]] },
      { name: "Vet Bill 3", rows: [["Item", "Description", "Unit", "Qty", "Price"], ["1.01", "Floor", "m2", 4, 300]] },
    ])

  test("a model that copies each sheet's own numbering is refused by createBoq's rule when it names no areas: nothing is created", async () => {
    const h = harness(deterministicModel)
    const { error } = await outcome(h, twoSheets())
    expect(error!.code).toBe("extraction_boq_invalid")
    expect(error!.issues.join(" ")).toContain('duplicate itemCode "1.01"')
    expect(h.calls).toEqual({ createProject: 0, createBoq: 0 })
  })

  test("the same model, naming the areas, is refused by the area rules before createBoq is asked: nothing is created", async () => {
    const naming: ModelCall = async (req) => {
      const a = JSON.parse(await deterministicModel(req)) as { boq: { lineItems: Array<{ category: string; source: { sheet: string } }> }; areas?: string[] }
      a.areas = ["Play Area", "Vet Area"]
      for (const l of a.boq.lineItems) l.category = `${l.source.sheet.startsWith("Play") ? "Play" : "Vet"} Area - Bill 3`
      return JSON.stringify(a)
    }
    const h = harness(naming)
    const { error } = await outcome(h, twoSheets())
    expect(error!.code).toBe("extraction_areas_invalid")
    expect(error!.issues.join(" ")).toContain("must be PLAY-B<bill>-<number>")
    expect(error!.issues.join(" ")).toContain("must be VET-B<bill>-<number>")
    expect(h.calls).toEqual({ createProject: 0, createBoq: 0 })
    expect(h.rows.size).toBe(0)
  })

  test("the reader's convention passes: PLAY-B3-01 and VET-B3-01 are two lines, and the two areas are ONE createBoq call", async () => {
    const conventional: ModelCall = async (req) => {
      const a = JSON.parse(await deterministicModel(req)) as { boq: { lineItems: Array<{ itemCode: string; category: string; source: { sheet: string } }> }; areas?: string[] }
      a.areas = ["Play Area", "Vet Area"]
      for (const l of a.boq.lineItems) {
        const area = l.source.sheet.startsWith("Play") ? "Play" : "Vet"
        l.itemCode = `${area.toUpperCase()}-B3-${l.itemCode.split(".")[1]}`
        l.category = `${area} Area - Bill 3`
      }
      return JSON.stringify(a)
    }
    const h = harness(conventional)
    const { result, error } = await outcome(h, twoSheets())
    expect(error).toBeNull()
    expect(h.calls).toEqual({ createProject: 1, createBoq: 1 })
    expect(h.created.lines.map((l) => [l.itemCode, l.category])).toEqual([["PLAY-B3-01", "Play Area - Bill 3"], ["VET-B3-01", "Vet Area - Bill 3"]])
    expect(result).toMatchObject({ duplicate: false })
  })
})

// ------------------------------------------------------------------------------------------ 3. ZOOMIES, read back from tables

const ORG = "org-areas"
const PRODUCT = "product-construction"
const ACTOR = "user-1"

let h: Awaited<ReturnType<typeof createExtractionPglite>>
let depth = 0
async function tenantDouble<T>(_ctx: unknown, fn: (tx: never) => Promise<T>): Promise<T> {
  if (depth > 0) throw new Error("nested withTenantContext (the real one refuses this too)")
  depth++
  try {
    return await h.db.transaction((tx) => fn(tx as never))
  } finally {
    depth--
  }
}

let svc: typeof import("./document-extraction-service")
let createProject: typeof import("@/lib/services/construction-dashboard-service").createProject
let createBoq: typeof import("@/lib/services/construction-boq-service").createBoq

beforeAll(async () => {
  h = await createExtractionPglite()
  await insertProduct(h, { id: PRODUCT, org_id: ORG })
  await insertUser(h, { id: ACTOR, org_id: ORG })
  mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: tenantDouble }))
  svc = await import("./document-extraction-service")
  createProject = (await import("@/lib/services/construction-dashboard-service")).createProject
  createBoq = (await import("@/lib/services/construction-boq-service")).createBoq
}, 60_000)

afterAll(async () => {
  await h.pg.close()
})

type Row = Record<string, unknown>
const rows = async (sql: string): Promise<Row[]> => (await h.pg.query(sql)).rows as Row[]
const one = async (sql: string): Promise<Row> => (await rows(sql))[0]

describe("AW-113: the ZOOMIES workbook makes one project and ONE BOQ, read back from the tables", () => {
  test("1 project, 1 BOQ, 53 lines with unique area-prefixed codes and categories; the sums are the totals the file prints", async () => {
    const caller = edgeCallerFor(edgeDeps(carefulHumanModel))
    const result = await svc.createProjectFromDocument(
      { orgId: ORG, actorId: ACTOR, productId: PRODUCT, fileName: "zoomies.xlsx", bytes: zoomiesWorkbook(), acknowledgeQuestions: true },
      { callEdge: caller, ledger: svc.createDbProjectSourceLedger({ orgId: ORG, actorId: ACTOR }), createProject, createBoq },
    )
    expect(result).toMatchObject({ duplicate: false, reconciliation: { status: "matched", expected: 1_596_280 } })
    expect(caller.calls.count).toBe(1)

    expect(await one("select count(*)::int as n from compliance.projects")).toEqual({ n: 1 })
    expect(await one("select count(*)::int as n, min(version)::int as v from compliance.construction_boqs")).toEqual({ n: 1, v: 1 })
    expect(await one("select count(*)::int as n from compliance.construction_boq_line_items")).toEqual({ n: 53 })
    expect(await one("select count(distinct item_code)::int as n from compliance.construction_boq_line_items")).toEqual({ n: 53 })

    const codes = (await rows("select item_code from compliance.construction_boq_line_items order by item_code")).map((r) => String(r.item_code))
    expect(codes.every((c) => /^(PLAY|VET)-B[0-9A-Z]+-([0-9]+|LS)$/.test(c))).toBe(true)
    expect(codes.filter((c) => c.startsWith("PLAY-")).length).toBeGreaterThan(0)
    expect(codes.filter((c) => c.startsWith("VET-")).length).toBeGreaterThan(0)
    // Bill 3 exists in both areas and both restart at 1: the codes do not collide.
    expect(codes).toContain("PLAY-B3-01")
    expect(codes).toContain("VET-B3-01")

    const areas = await rows("select split_part(category, ' - ', 1) as area, count(*)::int as n from compliance.construction_boq_line_items group by 1 order by 1")
    expect(areas.map((r) => r.area)).toEqual(["Play Area", "Vet Area"])
    expect(await one("select count(*)::int as n from compliance.construction_boq_line_items where category not like 'Play Area - %' and category not like 'Vet Area - %'")).toEqual({ n: 0 })

    // The stored figures, summed from the rows: quantity x rate of the lines that have no parent.
    const sums = await rows(
      "select split_part(category, ' - ', 1) as area, round(sum(quantity::float8 * rate::float8)::numeric, 2)::float8 as total from compliance.construction_boq_line_items where parent_line_item_id is null group by 1 order by 1",
    )
    expect(sums).toEqual([{ area: "Play Area", total: 1_343_445 }, { area: "Vet Area", total: 252_835 }])
    expect((await one("select round(sum(quantity::float8 * rate::float8)::numeric, 2)::float8 as total from compliance.construction_boq_line_items where parent_line_item_id is null")).total).toBe(1_596_280)
    // No line is priced at 0: the lines the file leaves unpriced are questions, not rows.
    expect(await one("select count(*)::int as n from compliance.construction_boq_line_items where quantity::float8 = 0 or rate::float8 = 0")).toEqual({ n: 0 })

    const project = await one("select id, name, description from compliance.projects")
    expect(String(project.name)).toContain("ZOOMIES")
    expect(String(project.description)).toContain("Currency: AED")
    expect(String(project.description)).toContain("VAT: 5%")
    const boq = await one("select project_id, title from compliance.construction_boqs")
    expect(boq.project_id).toBe(project.id)

    // The ledger row is the job record.
    const ledger = await one("select job_state, linked_entity_id, job_result from compliance.source_object where deleted_at is null")
    expect(ledger.job_state).toBe("created")
    expect(ledger.linked_entity_id).toBe(project.id)
    expect((ledger.job_result as { projectId: string; questions: number }).projectId).toBe(project.id)
    expect((ledger.job_result as { questions: number }).questions).toBe(27)
  })

  test("the sheet names of the file are not in the BOQ: it has areas and bills, not Table 1 to Table 22", async () => {
    const cats = (await rows("select distinct category from compliance.construction_boq_line_items")).map((r) => String(r.category))
    expect(cats.some((c) => /^Table \d+/.test(c))).toBe(false)
    expect(SHARED_SECRET.length).toBeGreaterThan(31)
  })
})
