/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-27, BR-403 (D-11 as amended by PMD-09 and AM-088): keyset pagination on (boq_id, id) for the BOQ
// line-item list and detail reads. listBoqs() and getBoq() read every line item with no limit or cursor; their paged
// variants listBoqsPage()/getBoqPage() read one page through readBoqLineItemPageWithDb().
//
// FIXTURE. The largest real BOQ (153 lines, live 2026-09-25) as the current revision of a two-revision chain, an
// independent BOQ in the same project and another organisation's BOQ. Line ids are cuid-shaped and random, plus a few
// upper-case and uuid-shaped ones, so byte order differs from insertion order and from a case-insensitive order.
//
// DATABASE. Real SQL on PGlite (in-process Postgres, see __test-helpers__/boq-keyset-pglite.ts); only
// withTenantContext is replaced, by a double that opens one real transaction per call and refuses nesting.
//
// Run: bun test --isolate src/lib/services/construction-boq-service.keyset.test.ts
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test"
import { getTableColumns } from "drizzle-orm"
import * as realTenantScoped from "@/lib/db/tenant-scoped"
import { constructionBoqs } from "@/lib/db/schema"
import {
  BOQ_KEYSET_PAGINATION_FLAG,
  decodeBoqLineCursor,
  encodeBoqLineCursor,
  isBoqKeysetPaginationEnabled,
  parseBoqLinePageLimit,
} from "@/lib/boq-line-keyset"
import { boqRow, createBoqPglite, fakeCuid, insertRows, lineRow, seededRandom } from "./__test-helpers__/boq-keyset-pglite"

const ORG = "org-keyset-a"
const OTHER_ORG = "org-keyset-b"
const PROJECT = "project-keyset-a"
const REV1 = "boq-rev1-keyset"
const REV2 = "boq-rev2-keyset"
const INDEPENDENT = "boq-independent-keyset"
const FOREIGN = "boq-foreign-keyset"

let h: Awaited<ReturnType<typeof createBoqPglite>>
let svc: typeof import("./construction-boq-service")
const rev2Ids: string[] = []
const rev1Ids: string[] = []

beforeAll(async () => {
  h = await createBoqPglite()
  mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: h.withTenantContextDouble }))
  svc = await import("./construction-boq-service")

  const random = seededRandom(153)
  await insertRows(h.pg, "construction_boqs", [
    boqRow({ id: REV1, org_id: ORG, project_id: PROJECT, version: 1, status: "superseded", created_at: "2026-09-01T00:00:00Z" }),
    boqRow({ id: REV2, org_id: ORG, project_id: PROJECT, version: 2, parent_boq_id: REV1, status: "approved", created_at: "2026-09-02T00:00:00Z" }),
    boqRow({ id: INDEPENDENT, org_id: ORG, project_id: PROJECT, version: 1, status: "draft", created_at: "2026-09-03T00:00:00Z" }),
    boqRow({ id: FOREIGN, org_id: OTHER_ORG, project_id: "project-keyset-b", version: 1, status: "approved", created_at: "2026-09-03T00:00:00Z" }),
  ])

  // 153 lines on the current revision: 51 roots with two children each, so moneyView (root lines only) is a real sum.
  const special = ["LA-01", "LA-02", "Zz-top", "0f8fad5b-d9cb-469f-a165-70867728950e", "7c9e6679-7425-40de-944b-e07fc1f90ae7"]
  const lines: Record<string, unknown>[] = []
  for (let k = 0; k < 153; k++) {
    const id = k < special.length ? special[k] : fakeCuid(random)
    rev2Ids.push(id)
    const isRoot = k % 3 === 0
    lines.push(
      lineRow({
        id,
        boq_id: REV2,
        org_id: ORG,
        item_code: `CIV-${String(k).padStart(3, "0")}`,
        parent_line_item_id: isRoot ? null : rev2Ids[k - (k % 3)],
        breakdown_percentage: isRoot ? null : "50",
        qty_project: "10",
        rate_project: "700",
        qty_contract: "10",
        rate_contract: "845",
      })
    )
  }
  for (let k = 0; k < 12; k++) {
    const id = fakeCuid(random)
    rev1Ids.push(id)
    lines.push(lineRow({ id, boq_id: REV1, org_id: ORG, item_code: `CIV-${String(k).padStart(3, "0")}` }))
  }
  for (let k = 0; k < 4; k++) lines.push(lineRow({ id: fakeCuid(random), boq_id: INDEPENDENT, org_id: ORG }))
  for (let k = 0; k < 3; k++) lines.push(lineRow({ id: `foreign-line-${k}`, boq_id: FOREIGN, org_id: OTHER_ORG, description: "ORG-B-SECRET" }))
  await insertRows(h.pg, "construction_boq_line_items", lines)
}, 60_000)

afterAll(async () => {
  await h.pg.close()
})

const byteOrder = (ids: string[]) => [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

/** The rows the keyset statement returned, per call, from the query log. */
function keysetReads(fromIndex: number) {
  return h.queryLog.slice(fromIndex).filter((q) => q.sql.includes('COLLATE "C"'))
}

async function expectServiceError(promise: Promise<unknown>, status: number, message?: RegExp) {
  let caught: unknown
  try {
    await promise
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(svc.ServiceError)
  expect((caught as { status: number }).status).toBe(status)
  if (message) expect((caught as Error).message).toMatch(message)
}

describe("BR-403: listBoqsPage() pages the current revision's 153 lines at limit 50", () => {
  test("pages of 50, 50, 50 and 3 rows, 153 distinct ids in (boq_id, id) byte order, nextCursor null on the last page", async () => {
    const sizes: number[] = []
    const seen: string[] = []
    const hasMore: boolean[] = []
    let cursor: string | null = null
    const logStart = h.queryLog.length
    const callsBefore = h.stats.calls
    for (let guard = 0; guard < 10; guard++) {
      const page: Awaited<ReturnType<typeof svc.listBoqsPage>> = await svc.listBoqsPage({ orgId: ORG }, PROJECT, { cursor, limit: "50" })
      expect(page.revision).toBe(REV2)
      const current = page.boqs.find((b) => b.id === REV2)!
      sizes.push(current.lineItems!.length)
      seen.push(...current.lineItems!.map((l) => l.id))
      hasMore.push(page.hasMore)
      cursor = page.nextCursor
      if (cursor === null) break
    }
    expect(sizes).toEqual([50, 50, 50, 3])
    expect(hasMore).toEqual([true, true, true, false])
    expect(cursor).toBeNull()
    expect(new Set(seen).size).toBe(153)
    expect(seen).toEqual(byteOrder(rev2Ids))
    // The database was asked for at most limit + 1 rows each time, never for the whole BOQ.
    expect(keysetReads(logStart).map((q) => q.rows)).toEqual([51, 51, 51, 3])
    // One transaction per call, never nested.
    expect(h.stats.calls - callsBefore).toBe(4)
    expect(h.stats.maxDepth).toBe(1)
  })

  test("the response is the current revision's chain: every header column kept, only the current revision carries lineItems", async () => {
    const page = await svc.listBoqsPage({ orgId: ORG }, PROJECT)
    expect(page.limit).toBe(50)
    expect(page.boqs.map((b) => b.id)).toEqual([REV2, REV1])
    const [current, older] = page.boqs
    expect(current.lineItems!.length).toBe(50)
    expect("lineItems" in older).toBe(false)
    const columns = Object.keys(getTableColumns(constructionBoqs))
    expect(columns.length).toBeGreaterThan(15)
    for (const header of page.boqs) {
      for (const column of columns) expect(column in header).toBe(true)
      expect("moneyView" in header && "costCoverage" in header).toBe(true)
    }
    // moneyView is the whole revision (51 root lines x 10 x 845 contract), not the page.
    const moneyView = (current as unknown as { moneyView: { contractValue: number; rootLineCount: number } }).moneyView
    expect(moneyView.rootLineCount).toBe(51)
    expect(moneyView.contractValue).toBe(51 * 10 * 845)
    expect(JSON.stringify(page)).not.toContain("ORG-B-SECRET")
    expect(page.boqs.some((b) => b.id === INDEPENDENT)).toBe(false)
  })

  test("?revision= pages another BOQ of the project; its chain comes with it", async () => {
    const page = await svc.listBoqsPage({ orgId: ORG }, PROJECT, { revision: REV1 })
    expect(page.revision).toBe(REV1)
    expect(page.boqs.map((b) => b.id)).toEqual([REV2, REV1])
    expect(page.boqs.find((b) => b.id === REV1)!.lineItems!.map((l) => l.id)).toEqual(byteOrder(rev1Ids))
    expect("lineItems" in page.boqs.find((b) => b.id === REV2)!).toBe(false)
    expect(page.nextCursor).toBeNull()
    expect(page.hasMore).toBe(false)

    const independent = await svc.listBoqsPage({ orgId: ORG }, PROJECT, { revision: INDEPENDENT })
    expect(independent.boqs.map((b) => b.id)).toEqual([INDEPENDENT])
  })

  test("a project with no BOQ is an empty page, not an error; a cursor on it is 400", async () => {
    expect(await svc.listBoqsPage({ orgId: ORG }, "project-with-no-boq")).toEqual({
      boqs: [],
      revision: null,
      limit: 50,
      nextCursor: null,
      hasMore: false,
    })
    const cursor = encodeBoqLineCursor({ boqId: REV2, id: rev2Ids[0] })
    await expectServiceError(svc.listBoqsPage({ orgId: ORG }, "project-with-no-boq", { cursor }), 400, /does not belong/)
  })

  test("limit 1 and limit 200 are accepted; 200 returns all 153 in one page", async () => {
    const one = await svc.listBoqsPage({ orgId: ORG }, PROJECT, { limit: "1" })
    expect(one.boqs[0].lineItems!.length).toBe(1)
    expect(one.hasMore).toBe(true)
    const all = await svc.listBoqsPage({ orgId: ORG }, PROJECT, { limit: 200 })
    expect(all.boqs[0].lineItems!.length).toBe(153)
    expect(all.nextCursor).toBeNull()
  })
})

describe("BR-403: getBoqPage() pages the detail read the same way", () => {
  test("pages of 50, 50, 50 and 3, the same 153 ids, whole-BOQ moneyView on every page", async () => {
    const whole = await svc.getBoq({ orgId: ORG }, REV2)
    expect(whole.lineItems.length).toBe(153)
    const sizes: number[] = []
    const seen: string[] = []
    let cursor: string | null = null
    for (let guard = 0; guard < 10; guard++) {
      const page: Awaited<ReturnType<typeof svc.getBoqPage>> = await svc.getBoqPage({ orgId: ORG }, REV2, { cursor, limit: "50" })
      sizes.push(page.lineItems.length)
      seen.push(...page.lineItems.map((l) => l.id))
      expect(page.moneyView).toEqual(whole.moneyView)
      expect(page.costCoverage).toEqual(whole.costCoverage)
      expect(page.hasConfirmedBaseline).toBe(false)
      cursor = page.nextCursor
      if (cursor === null) break
    }
    expect(sizes).toEqual([50, 50, 50, 3])
    expect(seen).toEqual(byteOrder(rev2Ids))
  })

  test("a cursor minted for another BOQ is refused with 400", async () => {
    const first = await svc.getBoqPage({ orgId: ORG }, REV2, { limit: "50" })
    await expectServiceError(svc.getBoqPage({ orgId: ORG }, REV1, { cursor: first.nextCursor }), 400, /different BOQ/)
  })
})

describe("BR-403: readBoqLineItemPageWithDb() keys on (boq_id, id), across BOQs too", () => {
  test("two BOQs read at limit 50 give every line exactly once, in (boq_id, id) byte order, across the BOQ boundary", async () => {
    const expected = [...byteOrder(rev1Ids).map((id) => `${REV1}/${id}`), ...byteOrder(rev2Ids).map((id) => `${REV2}/${id}`)]
    const orderedBoqs = byteOrder([REV1, REV2])
    expect(orderedBoqs).toEqual([REV1, REV2])
    const seen: string[] = []
    let after: { boqId: string; id: string } | null = null
    const sizes: number[] = []
    for (let guard = 0; guard < 10; guard++) {
      const page: Awaited<ReturnType<typeof svc.readBoqLineItemPageWithDb>> = await h.db.transaction((tx) =>
        svc.readBoqLineItemPageWithDb(tx as never, [REV2, REV1], { after, limit: 50 })
      )
      sizes.push(page.rows.length)
      seen.push(...page.rows.map((r) => `${r.boqId}/${r.id}`))
      if (!page.nextCursor) break
      after = decodeBoqLineCursor(page.nextCursor)
    }
    expect(sizes).toEqual([50, 50, 50, 15])
    expect(seen).toEqual(expected)
  })
})

describe("BR-403: the cursor and the page size are validated strictly (HTTP 400, never a crash or a wider read)", () => {
  test("a malformed cursor is 400 and no line item is read", async () => {
    const good = (await svc.listBoqsPage({ orgId: ORG }, PROJECT)).nextCursor!
    const decodedGood = JSON.parse(Buffer.from(good, "base64url").toString("utf8"))
    const variants = [
      "not a cursor",
      "%%%",
      good + "=",
      good.slice(0, -2),
      Buffer.from(JSON.stringify({ i: decodedGood.i, b: decodedGood.b })).toString("base64url"),
      Buffer.from(JSON.stringify({ ...decodedGood, o: ORG })).toString("base64url"),
      Buffer.from(JSON.stringify({ b: decodedGood.b })).toString("base64url"),
      Buffer.from(JSON.stringify({ b: 1, i: 2 })).toString("base64url"),
      Buffer.from(JSON.stringify({ b: "", i: "" })).toString("base64url"),
      Buffer.from(JSON.stringify([decodedGood.b, decodedGood.i])).toString("base64url"),
      Buffer.from(JSON.stringify({ b: decodedGood.b, i: "x\u0000" })).toString("base64url"),
      encodeBoqLineCursor({ boqId: REV2, id: "x".repeat(129) }),
    ]
    for (const cursor of variants) {
      const logStart = h.queryLog.length
      await expectServiceError(svc.listBoqsPage({ orgId: ORG }, PROJECT, { cursor }), 400, /cursor/)
      expect(keysetReads(logStart)).toEqual([])
    }
  })

  test("a well-formed cursor naming another organisation's BOQ is 400, and that BOQ's lines are never read", async () => {
    const logStart = h.queryLog.length
    const cursor = encodeBoqLineCursor({ boqId: FOREIGN, id: "foreign-line-0" })
    await expectServiceError(svc.listBoqsPage({ orgId: ORG }, PROJECT, { cursor }), 400, /does not belong/)
    expect(keysetReads(logStart)).toEqual([])
    expect(h.queryLog.slice(logStart).some((q) => q.sql.includes("construction_boq_line_items"))).toBe(false)
  })

  test("a cursor for one revision with ?revision= naming another is 400; an unknown ?revision= is 404", async () => {
    const cursor = (await svc.listBoqsPage({ orgId: ORG }, PROJECT)).nextCursor
    await expectServiceError(svc.listBoqsPage({ orgId: ORG }, PROJECT, { cursor, revision: REV1 }), 400, /different revision/)
    await expectServiceError(svc.listBoqsPage({ orgId: ORG }, PROJECT, { revision: "no-such-boq" }), 404)
    await expectServiceError(svc.listBoqsPage({ orgId: ORG }, PROJECT, { revision: FOREIGN }), 404)
  })

  test("limit outside 1 to 200, or not a whole number, is 400", async () => {
    for (const limit of ["0", "201", "-1", "1.5", "abc", "1e2", " 5", "0050"]) {
      await expectServiceError(svc.listBoqsPage({ orgId: ORG }, PROJECT, { limit }), 400, /limit/)
    }
    expect(parseBoqLinePageLimit(undefined)).toBe(50)
    expect(parseBoqLinePageLimit("")).toBe(50)
    expect(parseBoqLinePageLimit("200")).toBe(200)
    expect(parseBoqLinePageLimit(201)).toBeNull()
  })

  test("the cursor is opaque base64url of the last row's boq_id and id only: no organisation, no project", async () => {
    const cursor = (await svc.listBoqsPage({ orgId: ORG }, PROJECT)).nextCursor!
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/)
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
    expect(Object.keys(decoded).sort()).toEqual(["b", "i"])
    expect(decoded.b).toBe(REV2)
    expect(decoded.i).toBe(byteOrder(rev2Ids)[49])
    const text = Buffer.from(cursor, "base64url").toString("utf8")
    expect(text).not.toContain(ORG)
    expect(text).not.toContain(PROJECT)
    // Any id this server can mint (128 characters, multi-byte) decodes back to itself.
    const wide = { boqId: "ह".repeat(128), id: "€".repeat(128) }
    expect(decodeBoqLineCursor(encodeBoqLineCursor(wide))).toEqual(wide)
  })
})

describe("BUILD001_BOQ_KEYSET_PAGINATION is read at call time; the unpaged reads are unchanged", () => {
  test("the flag follows process.env on every call", () => {
    const original = process.env[BOQ_KEYSET_PAGINATION_FLAG]
    try {
      delete process.env[BOQ_KEYSET_PAGINATION_FLAG]
      expect(isBoqKeysetPaginationEnabled()).toBe(false)
      for (const on of ["1", "true", "TRUE", "yes"]) {
        process.env[BOQ_KEYSET_PAGINATION_FLAG] = on
        expect(isBoqKeysetPaginationEnabled()).toBe(true)
      }
      for (const off of ["0", "false", "", "on-ish"]) {
        process.env[BOQ_KEYSET_PAGINATION_FLAG] = off
        expect(isBoqKeysetPaginationEnabled()).toBe(false)
      }
    } finally {
      if (original === undefined) delete process.env[BOQ_KEYSET_PAGINATION_FLAG]
      else process.env[BOQ_KEYSET_PAGINATION_FLAG] = original
    }
  })

  test("listBoqs() and getBoq() still read every line of every BOQ of the project (no limit, no cursor)", async () => {
    const list = await svc.listBoqs({ orgId: ORG }, PROJECT, { include: "lineItems" })
    expect(list.map((b) => b.id)).toEqual([REV2, INDEPENDENT, REV1])
    expect(list.map((b) => b.lineItems!.length)).toEqual([153, 4, 12])
    expect((await svc.getBoq({ orgId: ORG }, REV2)).lineItems.length).toBe(153)
  })
})
