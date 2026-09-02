/// <reference types="bun-types" />
// Same pure/DB-touching split as construction-reports-service.test.ts: the
// pure helpers are tested directly, and the two functions whose whole value is
// a REFUSAL (delete-in-use) or a two-table side effect (rename rewrites the
// lines) are exercised through the real code path with only the DB layer and
// the construction-enablement gate mocked -- a comment claiming "delete is
// refused when in use" is not a test.
import { describe, expect, test, mock, afterEach } from "bun:test"
import { getTableName } from "drizzle-orm"
import { constructionBoqCategories } from "@/lib/db"
import * as realTenantScoped from "@/lib/db/tenant-scoped"
import * as realEnablementService from "./construction-enablement-service"
import {
  DEFAULT_BOQ_CATEGORIES,
  categoryInUseMessage,
  normalizeCategoryName,
} from "./construction-boq-category-service"

describe("normalizeCategoryName", () => {
  test("trims, and treats blank/whitespace/non-string as absent", () => {
    expect(normalizeCategoryName("  Civil  ")).toBe("Civil")
    expect(normalizeCategoryName("")).toBe("")
    expect(normalizeCategoryName("   ")).toBe("")
    expect(normalizeCategoryName(undefined)).toBe("")
    expect(normalizeCategoryName(42)).toBe("")
  })

  test("never case-folds -- the stored casing stays the customer's own", () => {
    expect(normalizeCategoryName("gypsum BOARD")).toBe("gypsum BOARD")
  })
})

describe("categoryInUseMessage", () => {
  test("is the exact wording the item specifies", () => {
    expect(categoryInUseMessage(12)).toBe("Used by 12 BOQ lines")
  })

  test("is singular for one line", () => {
    expect(categoryInUseMessage(1)).toBe("Used by 1 BOQ line")
  })
})

describe("DEFAULT_BOQ_CATEGORIES", () => {
  test("is the seven seeded categories, in the item's own order", () => {
    expect(DEFAULT_BOQ_CATEGORIES).toEqual(["Civil", "Gypsum", "Joinery", "Paint", "Electrical", "Plumbing", "Misc"])
  })
})

// ---------------------------------------------------------------------------
// Real code paths, DB layer mocked.

type FakeCategory = { id: string; orgId: string; name: string; sortOrder: number; isActive: boolean }

const ORG = "org-cat-test"

function buildFakeDb(options: {
  category?: FakeCategory
  clash?: FakeCategory
  lineCount?: number
}) {
  const calls = { updatedCategory: [] as unknown[], updatedLineItems: [] as unknown[], inserted: [] as unknown[] }
  let categoryFindFirstCall = 0
  const db = {
    query: {
      constructionBoqCategories: {
        findFirst: mock(async () => {
          categoryFindFirstCall += 1
          // 1st call resolves the target row, 2nd (rename only) looks for a
          // name clash -- mirrors the real call order in the service.
          return categoryFindFirstCall === 1 ? options.category : options.clash
        }),
        findMany: mock(async () => (options.category ? [options.category] : [])),
      },
    },
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ count: options.lineCount ?? 0, maxSort: 3 }]),
      }),
    }),
    insert: () => ({ values: (v: unknown) => ({ returning: async () => { calls.inserted.push(v); return [{ ...(v as object), id: "new-id" }] } }) }),
    update: (table: unknown) => ({
      set: (v: unknown) => ({
        where: () => {
          const isCategoryTable = getTableName(table as Parameters<typeof getTableName>[0]) === getTableName(constructionBoqCategories)
          const result = {
            returning: async (_cols?: unknown) => {
              if (isCategoryTable) {
                calls.updatedCategory.push(v)
                return [{ ...(options.category as object), ...(v as object) }]
              }
              calls.updatedLineItems.push(v)
              return Array.from({ length: options.lineCount ?? 0 }, (_, i) => ({ id: `line-${i}` }))
            },
          }
          return result
        },
      }),
    }),
  }
  return { db, calls }
}

async function withMockedDb<T>(fake: ReturnType<typeof buildFakeDb>, run: () => Promise<T>): Promise<T> {
  await mock.module("@/lib/db/tenant-scoped", () => ({
    ...realTenantScoped,
    withTenantContext: mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) => fn(fake.db)),
  }))
  await mock.module("./construction-enablement-service", () => ({
    ...realEnablementService,
    requireConstructionEnabled: mock(async () => {}),
  }))
  return run()
}

describe("deleteBoqCategory", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
    await mock.module("./construction-enablement-service", () => realEnablementService)
  })

  test("refuses a category that is in use, with the count in the message and a 409", async () => {
    const fake = buildFakeDb({
      category: { id: "cat-1", orgId: ORG, name: "Civil", sortOrder: 1, isActive: true },
      lineCount: 12,
    })
    await withMockedDb(fake, async () => {
      const { deleteBoqCategory, ServiceError } = await import("./construction-boq-category-service")
      let thrown: unknown
      try {
        await deleteBoqCategory({ orgId: ORG }, "cat-1")
      } catch (err) {
        thrown = err
      }
      expect(thrown).toBeInstanceOf(ServiceError)
      expect((thrown as Error).message).toBe("Used by 12 BOQ lines")
      expect((thrown as { status: number }).status).toBe(409)
      // The refusal must not have re-categorised or removed anything.
      expect(fake.calls.updatedCategory).toEqual([])
      expect(fake.calls.updatedLineItems).toEqual([])
    })
  })

  test("retires an unused category by clearing isActive -- never a row delete", async () => {
    const fake = buildFakeDb({
      category: { id: "cat-2", orgId: ORG, name: "Paint", sortOrder: 4, isActive: true },
      lineCount: 0,
    })
    await withMockedDb(fake, async () => {
      const { deleteBoqCategory } = await import("./construction-boq-category-service")
      const retired = await deleteBoqCategory({ orgId: ORG }, "cat-2")
      expect(retired.isActive).toBe(false)
      expect(fake.calls.updatedCategory.length).toBe(1)
      expect(fake.calls.updatedCategory[0]).toMatchObject({ isActive: false })
    })
  })

  test("404s on a category that does not belong to this org", async () => {
    const fake = buildFakeDb({ category: undefined })
    await withMockedDb(fake, async () => {
      const { deleteBoqCategory } = await import("./construction-boq-category-service")
      let thrown: unknown
      try {
        await deleteBoqCategory({ orgId: ORG }, "cat-elsewhere")
      } catch (err) {
        thrown = err
      }
      expect((thrown as Error).message).toBe("Category not found")
      expect((thrown as { status: number }).status).toBe(404)
    })
  })
})

describe("renameBoqCategory", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
    await mock.module("./construction-enablement-service", () => realEnablementService)
  })

  test("renames the row and rewrites every line that carried its previous name", async () => {
    const fake = buildFakeDb({
      category: { id: "cat-1", orgId: ORG, name: "Civil", sortOrder: 1, isActive: true },
      clash: undefined,
      lineCount: 7,
    })
    await withMockedDb(fake, async () => {
      const { renameBoqCategory } = await import("./construction-boq-category-service")
      const result = await renameBoqCategory({ orgId: ORG }, "cat-1", "  Civil Works  ")
      expect(result.category.name).toBe("Civil Works")
      expect(result.lineItemsUpdated).toBe(7)
      expect(fake.calls.updatedLineItems[0]).toEqual({ category: "Civil Works" })
    })
  })

  test("refuses a rename that would collide with another category, with a 409", async () => {
    const fake = buildFakeDb({
      category: { id: "cat-1", orgId: ORG, name: "Civil", sortOrder: 1, isActive: true },
      clash: { id: "cat-9", orgId: ORG, name: "Gypsum", sortOrder: 2, isActive: true },
    })
    await withMockedDb(fake, async () => {
      const { renameBoqCategory } = await import("./construction-boq-category-service")
      let thrown: unknown
      try {
        await renameBoqCategory({ orgId: ORG }, "cat-1", "gypsum")
      } catch (err) {
        thrown = err
      }
      expect((thrown as Error).message).toBe('"Gypsum" is already a category')
      expect((thrown as { status: number }).status).toBe(409)
      expect(fake.calls.updatedLineItems).toEqual([])
    })
  })

  test("rejects a blank name before touching anything", async () => {
    const fake = buildFakeDb({ category: { id: "cat-1", orgId: ORG, name: "Civil", sortOrder: 1, isActive: true } })
    await withMockedDb(fake, async () => {
      const { renameBoqCategory } = await import("./construction-boq-category-service")
      let thrown: unknown
      try {
        await renameBoqCategory({ orgId: ORG }, "cat-1", "   ")
      } catch (err) {
        thrown = err
      }
      expect((thrown as Error).message).toBe("Category name is required")
      expect(fake.calls.updatedCategory).toEqual([])
    })
  })
})

describe("createBoqCategory", () => {
  afterEach(async () => {
    mock.restore()
    await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
    await mock.module("./construction-enablement-service", () => realEnablementService)
  })

  test("reactivates a retired category of the same name instead of colliding with the unique index", async () => {
    const fake = buildFakeDb({ category: { id: "cat-3", orgId: ORG, name: "Paint", sortOrder: 4, isActive: false } })
    await withMockedDb(fake, async () => {
      const { createBoqCategory } = await import("./construction-boq-category-service")
      const created = await createBoqCategory({ orgId: ORG }, "paint")
      expect(created.isActive).toBe(true)
      expect(fake.calls.inserted).toEqual([])
      expect(fake.calls.updatedCategory[0]).toMatchObject({ isActive: true, name: "paint" })
    })
  })

  test("refuses a duplicate of an ACTIVE category with a 409", async () => {
    const fake = buildFakeDb({ category: { id: "cat-1", orgId: ORG, name: "Civil", sortOrder: 1, isActive: true } })
    await withMockedDb(fake, async () => {
      const { createBoqCategory } = await import("./construction-boq-category-service")
      let thrown: unknown
      try {
        await createBoqCategory({ orgId: ORG }, "CIVIL")
      } catch (err) {
        thrown = err
      }
      expect((thrown as Error).message).toBe('"Civil" is already a category')
      expect((thrown as { status: number }).status).toBe(409)
    })
  })

  test("inserts a genuinely new category at the end of the sort order", async () => {
    const fake = buildFakeDb({ category: undefined })
    await withMockedDb(fake, async () => {
      const { createBoqCategory } = await import("./construction-boq-category-service")
      const created = await createBoqCategory({ orgId: ORG }, "Waterproofing")
      expect(created).toMatchObject({ orgId: ORG, name: "Waterproofing", sortOrder: 4 })
      expect(fake.calls.inserted.length).toBe(1)
    })
  })
})
