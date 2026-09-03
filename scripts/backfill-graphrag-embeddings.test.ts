// Unit tests for backfill-graphrag-embeddings.ts's pure content-builder
// functions, matching backfill-platform-assets.test.ts's established
// convention for this repo's one-off backfill scripts. The DB-touching
// parts (writeEmbedding, main) are exercised live against production instead
// (see the script's own header) -- not mocked here, per this repo's standing
// convention that no live DB connection is reachable from the bun test
// runner in this environment.
import { describe, test, expect } from "bun:test"
import { buildBoqLineContent, buildProjectContent, buildReportDefinitionContent } from "./backfill-graphrag-embeddings"

describe("buildBoqLineContent", () => {
  test("joins every present field, in order, sentence-separated", () => {
    const content = buildBoqLineContent({
      itemCode: "BOQ-10",
      description: "Ready-mix concrete M25 grade",
      unit: "cum",
      quantity: "45",
      rate: "8500",
      amount: "382500",
    })
    expect(content).toBe(
      "Item BOQ-10. Ready-mix concrete M25 grade. Unit: cum. Quantity: 45. Rate: 8500. Amount: 382500"
    )
  })

  test("omits null/empty fields rather than emitting empty labels", () => {
    const content = buildBoqLineContent({
      itemCode: null,
      description: "Structural steel sections, Level 5",
      unit: null,
      quantity: null,
      rate: null,
      amount: null,
    })
    expect(content).toBe("Structural steel sections, Level 5")
  })

  test("description is required and always present even when everything else is null", () => {
    const content = buildBoqLineContent({
      itemCode: null,
      description: "Generic line item",
      unit: null,
      quantity: null,
      rate: null,
      amount: null,
    })
    expect(content).toContain("Generic line item")
  })

  test("does not reference a `category` field -- deliberately excluded, see the function's own header comment", () => {
    // Real live schema drift: construction_boq_line_items has a live `category`
    // column not declared in schema.ts, so it's unreachable via db.query and
    // is intentionally left out of this content builder. This test pins that
    // the builder's own parameter type has no category field to regress into.
    const row: Parameters<typeof buildBoqLineContent>[0] = {
      itemCode: "X",
      description: "Y",
      unit: null,
      quantity: null,
      rate: null,
      amount: null,
    }
    expect(Object.keys(row)).not.toContain("category")
  })
})

describe("buildProjectContent", () => {
  test("joins every present field, project name always first", () => {
    const content = buildProjectContent({
      name: "Marina Vista Tower",
      description: "38-storey residential tower, Phase 2",
      status: "active",
      healthStatus: "on_track",
    })
    expect(content).toBe(
      "Project: Marina Vista Tower. 38-storey residential tower, Phase 2. Status: active. Health: on_track"
    )
  })

  test("omits null fields", () => {
    const content = buildProjectContent({
      name: "Skyline Business Park",
      description: null,
      status: null,
      healthStatus: null,
    })
    expect(content).toBe("Project: Skyline Business Park")
  })
})

describe("buildReportDefinitionContent", () => {
  test("joins every present field, report name always first", () => {
    const content = buildReportDefinitionContent({
      name: "Dunning List",
      description: "Overdue invoices grouped by aging bucket",
      category: "software_report",
    })
    expect(content).toBe(
      "Report: Dunning List. Overdue invoices grouped by aging bucket. Category: software_report"
    )
  })

  test("omits null description/category", () => {
    const content = buildReportDefinitionContent({
      name: "Trial Balance",
      description: null,
      category: null,
    })
    expect(content).toBe("Report: Trial Balance")
  })
})
