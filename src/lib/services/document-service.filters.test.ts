// R62 B7 -- regression test for fault_id R60_T2_DOCUMENTS_TYPE_FILTER_REGRESSION
// (platform.r43_faults, closed=true, wf_test now true).
//
// GET /api/v1/documents?linkedEntityId=X (linkedEntityType omitted) was
// flagged by R60 T2's live UAT re-run as a possible regression: it now
// returns the matching document instead of an empty result. A follow-up
// live re-verification (R62 B4, same fault row) confirmed this is NOT a
// regression -- it is documented Wave 61 design: listDocuments() builds
// independent, composable AND-conditions, so omitting linkedEntityType
// simply skips that one condition rather than forcing an empty match, and
// supplying it (correct or wrong) genuinely constrains the result.
//
// This test codifies that live-verified behavior against the real
// buildDocumentFilterConditions() the route actually calls (see
// document-service.ts / api/v1/documents/route.ts), by rendering the
// conditions to real SQL text via drizzle's own PgDialect -- no live DB
// connection required, matching this repo's established
// don't-touch-a-live-DB-from-a-.test.ts convention (see
// document-classification-service.test.ts's header comment).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { and } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import { buildDocumentFilterConditions } from "./document-service"

const dialect = new PgDialect()

function renderWhere(orgId: string, filters: Parameters<typeof buildDocumentFilterConditions>[1]) {
  const conditions = buildDocumentFilterConditions(orgId, filters)
  const { sql, params } = dialect.sqlToQuery(and(...conditions)!)
  return { sql, params }
}

const ORG = "org_test_r62b7"
const ENTITY_ID = "ugr8i7taaawxz3wrnybr5f86" // same id R62 B4's live re-verification anchored on

describe("buildDocumentFilterConditions -- AND-filter shape (R60/R62 documents type-filter fault)", () => {
  test("omitting linkedEntityType builds a WHERE with linked_entity_id but WITHOUT linked_entity_type -- matches by ID alone, across types, by design", () => {
    const { sql, params } = renderWhere(ORG, { linkedEntityId: ENTITY_ID })
    expect(sql).toContain("linked_entity_id")
    expect(sql).not.toContain("linked_entity_type")
    expect(params).toContain(ENTITY_ID)
  })

  test("supplying the correct linkedEntityType alongside linkedEntityId adds a real AND-condition on both columns with the exact values given", () => {
    const { sql, params } = renderWhere(ORG, { linkedEntityId: ENTITY_ID, linkedEntityType: "site_instruction" })
    expect(sql).toContain("linked_entity_id")
    expect(sql).toContain("linked_entity_type")
    expect(params).toContain(ENTITY_ID)
    expect(params).toContain("site_instruction")
  })

  test("supplying the WRONG linkedEntityType still constrains on that exact (wrong) value -- the type filter is a real AND, not a no-op, whenever it is supplied", () => {
    const { sql, params } = renderWhere(ORG, { linkedEntityId: ENTITY_ID, linkedEntityType: "boq" })
    expect(sql).toContain("linked_entity_type")
    expect(params).toContain("boq")
    // the built condition constrains to 'boq' specifically -- a document
    // whose real linked_entity_type is 'site_instruction' cannot satisfy an
    // AND that requires linked_entity_type = 'boq', so this correctly
    // excludes it (proven at the DB layer by R62 B4's live control call
    // returning documents: []).
    expect(params).not.toContain("site_instruction")
  })

  test("category and linkedEntityType are independent conditions -- one being present never implies or requires the other", () => {
    const withOnlyCategory = renderWhere(ORG, { category: "site_instruction_attachment" })
    expect(withOnlyCategory.sql).toContain("category")
    expect(withOnlyCategory.sql).not.toContain("linked_entity_type")
    expect(withOnlyCategory.sql).not.toContain("linked_entity_id")

    const withAll = renderWhere(ORG, { category: "site_instruction_attachment", linkedEntityId: ENTITY_ID, linkedEntityType: "site_instruction" })
    expect(withAll.sql).toContain("category")
    expect(withAll.sql).toContain("linked_entity_id")
    expect(withAll.sql).toContain("linked_entity_type")
  })

  test("org scoping (orgId) is always present regardless of which optional filters are supplied", () => {
    const { sql, params } = renderWhere(ORG, {})
    expect(sql).toContain("org_id")
    expect(params).toContain(ORG)
  })

  test("latestOnly defaults to true (is_latest_version constrained) unless explicitly set to false", () => {
    expect(renderWhere(ORG, {}).sql).toContain("is_latest_version")
    expect(renderWhere(ORG, { latestOnly: false }).sql).not.toContain("is_latest_version")
  })
})
