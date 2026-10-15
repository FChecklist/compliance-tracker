// G-14 (2026-10-06): two laptops edited the same BOQ line category while offline; both were accepted one after the other and the later one
// silently replaced the earlier. updateLineItemBudget now takes `expectedCategory` (what the caller SAW). A different stored value is a
// 409 EditConflictError carrying what is stored, checked before the write AND inside the update (so a writer in between cannot slip through).
// No expectedCategory = the behaviour every older caller has.
/// <reference types="bun-types" />
import { afterEach, describe, expect, mock, test } from "bun:test"
import * as realTenantScoped from "@/lib/db/tenant-scoped"
import { EditConflictError } from "./construction-boq-service"

describe("updateLineItemBudget -- expectedCategory (G-14)", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  })

  /** `stored` is what the first read sees; `racedTo` (optional) is what is there when the update runs: the update then matches no row. */
  function mount(stored: string | null, racedTo?: string | null) {
    const setCalls: Record<string, unknown>[] = []
    let reads = 0
    const line = (category: string | null) => ({ id: "line-1", boqId: "boq-1", category, amount: "10", quantity: "1", rate: "10" })
    const fakeDb = {
      query: {
        constructionBoqLineItems: { findFirst: mock(async () => { reads += 1; return line(reads === 1 ? stored : racedTo === undefined ? stored : racedTo) }) },
        constructionBoqs: { findFirst: mock(async () => ({ id: "boq-1", orgId: "org-1" })) },
      },
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => ({
            returning: async () => {
              if (racedTo !== undefined) return [] // the where (id AND category = expected) matched nothing: someone wrote in between
              setCalls.push(values)
              return [{ ...line(stored), ...values }]
            },
          }),
        }),
      }),
    }
    return { fakeDb, setCalls }
  }

  async function patch(stored: string | null, input: Record<string, unknown>, racedTo?: string | null) {
    const { fakeDb, setCalls } = mount(stored, racedTo)
    await mock.module("@/lib/db/tenant-scoped", () => ({
      ...realTenantScoped,
      withTenantContext: mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => fn(fakeDb)),
    }))
    const { updateLineItemBudget } = await import("./construction-boq-service")
    return { run: () => updateLineItemBudget({ orgId: "org-1" }, "line-1", input), setCalls }
  }

  test("the field changed since the caller saw it: 409 EDIT_CONFLICT with what is stored, and NOTHING is written", async () => {
    const { run, setCalls } = await patch("CONF-A", { category: "CONF-B", expectedCategory: null })
    const err = await run().catch((e) => e)
    expect(err).toBeInstanceOf(EditConflictError)
    expect(err.status).toBe(409)
    expect(err.code).toBe("EDIT_CONFLICT")
    expect(err.current).toEqual({ category: "CONF-A" })
    expect(setCalls).toEqual([])
  })

  test("the field is what the caller saw: the edit is applied", async () => {
    const { run, setCalls } = await patch("CONF-A", { category: "CONF-B", expectedCategory: "CONF-A" })
    const updated = await run()
    expect(setCalls[0]).toEqual({ category: "CONF-B" })
    expect(updated.category).toBe("CONF-B")
  })

  test("no expectedCategory (every older caller): applied exactly as before, whatever is stored", async () => {
    const { run, setCalls } = await patch("CONF-A", { category: "CONF-B" })
    await run()
    expect(setCalls[0]).toEqual({ category: "CONF-B" })
  })

  test("blank and null are the same 'no category', and surrounding spaces do not matter", async () => {
    const a = await patch(null, { category: "X", expectedCategory: "  " })
    await a.run()
    expect(a.setCalls[0]).toEqual({ category: "X" })
    const b = await patch("Civil", { category: "X", expectedCategory: " Civil " })
    await b.run()
    expect(b.setCalls[0]).toEqual({ category: "X" })
  })

  test("a writer slips in between the read and the write: the update matches no row and that is the same 409, with the value now stored", async () => {
    const { run, setCalls } = await patch(null, { category: "CONF-B", expectedCategory: null }, "CONF-A")
    const err = await run().catch((e) => e)
    expect(err).toBeInstanceOf(EditConflictError)
    expect(err.current).toEqual({ category: "CONF-A" })
    expect(setCalls).toEqual([])
  })
})
