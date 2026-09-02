// R67 D-34 (R-085/R-091). This file had NO sibling test before this change.
//
// THE FAULT: the roster is where every trade-wise number in this product comes
// from, and it was the least defended write in it. employee_code was blank on
// most rows (the form marked it optional and nothing generated one), so workers
// landed on the list with an ID cell reading "—"; trade was free text, so the
// same job arrived as "Mason", "mason" and "MASON" and split every trade-wise
// total; and a daily rate that was not a number was stringified straight into a
// numeric column.
//
// This does NOT touch a live DB. It exercises the real createRosterEntry() with
// only withTenantContext mocked -- this repo's established pattern (see
// construction-progress-service.test.ts's own header for why that is honest) --
// and the fake below stands in for compliance.construction_employee_code_counters
// the way drizzle/0529_r67_i02 defines it -- seeded on first use from the
// highest 'W-nnnn' actually stored, then incremented by the claim itself -- so
// "a second call returns the next number" is a real sequence, not a canned
// string.
/// <reference types="bun-types" />
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import {
  formatEmployeeCode,
  mergeTrades,
  SEED_TRADES,
  EMPLOYEE_CODE_PREFIX,
} from "./construction-labour-service"

const ORG = "org-d34"
const PROJECT = "project-d34"

let insertedRows: Record<string, unknown>[] = []
// Stands in for the counter ROW, not for a max() query: null until the first
// claim, which seeds it (as 0529 does) from the highest generated code already
// stored and then increments. `executeCalls` proves the service claims the
// number with ONE statement rather than reading and writing.
let counterLastNumber: number | null = null
let executeCalls = 0

const projectRows = [{ id: PROJECT, orgId: ORG }]

const fakeDb = {
  query: {
    projects: {
      findFirst: async () => projectRows[0],
    },
  },
  execute: async () => {
    executeCalls += 1
    if (counterLastNumber === null) {
      counterLastNumber = insertedRows.reduce((max, row) => {
        const match = String(row.employeeCode ?? "").match(/^W-(\d+)$/)
        return match ? Math.max(max, Number.parseInt(match[1], 10)) : max
      }, 0)
    }
    counterLastNumber += 1
    return [{ last_number: counterLastNumber }]
  },
  insert: () => ({
    values: (v: Record<string, unknown>) => ({
      returning: async () => {
        const row = { ...v, id: `roster-${insertedRows.length + 1}` }
        insertedRows.push(row)
        return [row]
      },
    }),
  }),
}

const mockWithTenantContext = mock(async (_ctx: { orgId: string }, fn: (db: unknown) => Promise<unknown>) =>
  fn(fakeDb as unknown as never)
)

const realTenantScoped = await import("@/lib/db/tenant-scoped")
async function restoreRealModules(): Promise<void> {
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
}

beforeEach(() => {
  insertedRows = []
  counterLastNumber = null
  executeCalls = 0
  mockWithTenantContext.mockClear()
})

afterEach(async () => {
  mock.restore()
  await restoreRealModules()
})

describe("employee-code generation (pure)", () => {
  test("formats a sequence as a zero-padded W- code", () => {
    expect(formatEmployeeCode(1)).toBe("W-0001")
    expect(formatEmployeeCode(42)).toBe("W-0042")
  })

  test("a sequence past four digits gets longer rather than wrapping", () => {
    expect(formatEmployeeCode(12345)).toBe("W-12345")
  })

})

describe("createRosterEntry -- R67 D-34 auto ID", () => {
  test("a create with no employeeCode returns one matching /^W-\\d{4}$/, and a second call returns the next number", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { createRosterEntry } = await import("./construction-labour-service")

    const first = await createRosterEntry({ orgId: ORG }, { projectId: PROJECT, name: "Ali", dailyRate: 120 })
    expect(first.employeeCode).toMatch(/^W-\d{4}$/)

    const second = await createRosterEntry({ orgId: ORG }, { projectId: PROJECT, name: "Bilal", dailyRate: 130 })
    expect(second.employeeCode).toMatch(/^W-\d{4}$/)

    const firstNumber = Number.parseInt(first.employeeCode!.slice(EMPLOYEE_CODE_PREFIX.length), 10)
    const secondNumber = Number.parseInt(second.employeeCode!.slice(EMPLOYEE_CODE_PREFIX.length), 10)
    expect(secondNumber).toBe(firstNumber + 1)
  })

  test("no worker can land on the list with a blank ID any more", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { createRosterEntry } = await import("./construction-labour-service")

    await createRosterEntry({ orgId: ORG }, { projectId: PROJECT, name: "Ali", dailyRate: 120 })
    expect(insertedRows[0].employeeCode).toBeTruthy()
  })

  test("a caller's OWN employee code is stored verbatim -- this generates, it never overrides", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { createRosterEntry } = await import("./construction-labour-service")

    const row = await createRosterEntry({ orgId: ORG }, { projectId: PROJECT, name: "Ali", employeeCode: "EMP-001", dailyRate: 120 })
    expect(row.employeeCode).toBe("EMP-001")
  })

  test("a whitespace-only employee code counts as blank and is generated, not stored as spaces", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { createRosterEntry } = await import("./construction-labour-service")

    const row = await createRosterEntry({ orgId: ORG }, { projectId: PROJECT, name: "Ali", employeeCode: "   ", dailyRate: 120 })
    expect(row.employeeCode).toMatch(/^W-\d{4}$/)
  })

  // The reason the read-then-write max(employee_code) this function used to do
  // is gone: lane I's drizzle/0529_r67_i02 put a partial UNIQUE index on
  // (org_id, employee_code), so two creates that read the same max would make
  // the second INSERT raise a unique violation. The number is claimed with ONE
  // statement against the counter table instead.
  test("the number is claimed with a SINGLE statement -- never a read followed by a write", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { createRosterEntry } = await import("./construction-labour-service")

    await createRosterEntry({ orgId: ORG }, { projectId: PROJECT, name: "Ali", dailyRate: 120 })
    expect(executeCalls).toBe(1)
  })

  test("a caller's own code costs no counter number at all -- the sequence is not burned by a verbatim code", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { createRosterEntry } = await import("./construction-labour-service")

    await createRosterEntry({ orgId: ORG }, { projectId: PROJECT, name: "Ali", employeeCode: "EMP-001", dailyRate: 120 })
    expect(executeCalls).toBe(0)

    const generated = await createRosterEntry({ orgId: ORG }, { projectId: PROJECT, name: "Bilal", dailyRate: 130 })
    expect(generated.employeeCode).toBe("W-0001")
  })

  test("the counter is seeded from the highest generated code already on the roster, so it cannot collide with one", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { createRosterEntry } = await import("./construction-labour-service")

    await createRosterEntry({ orgId: ORG }, { projectId: PROJECT, name: "Legacy", employeeCode: "W-0007", dailyRate: 100 })
    const next = await createRosterEntry({ orgId: ORG }, { projectId: PROJECT, name: "Ali", dailyRate: 120 })
    expect(next.employeeCode).toBe("W-0008")
  })
})

describe("createRosterEntry -- rate validation", () => {
  test("a non-numeric daily rate is refused BY NAME, and nothing is written", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { createRosterEntry } = await import("./construction-labour-service")

    await expect(
      createRosterEntry({ orgId: ORG }, { projectId: PROJECT, name: "Ali", dailyRate: Number.NaN })
    ).rejects.toThrow("dailyRate must be a number of 0 or more")
    expect(insertedRows).toHaveLength(0)
  })

  test("a negative daily rate is refused -- it would corrupt every trade-wise cost downstream", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { createRosterEntry } = await import("./construction-labour-service")

    await expect(
      createRosterEntry({ orgId: ORG }, { projectId: PROJECT, name: "Ali", dailyRate: -5 })
    ).rejects.toThrow("dailyRate must be a number of 0 or more")
    expect(insertedRows).toHaveLength(0)
  })

  test("a rate of exactly 0 is legitimate and still writes", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { createRosterEntry } = await import("./construction-labour-service")

    const row = await createRosterEntry({ orgId: ORG }, { projectId: PROJECT, name: "Ali", dailyRate: 0 })
    expect(row.dailyRate).toBe("0")
  })

  test("an empty name is still refused before anything else happens", async () => {
    await mock.module("@/lib/db/tenant-scoped", () => ({ withTenantContext: mockWithTenantContext }))
    const { createRosterEntry } = await import("./construction-labour-service")

    await expect(createRosterEntry({ orgId: ORG }, { projectId: PROJECT, name: "   ", dailyRate: 120 })).rejects.toThrow("name is required")
    expect(insertedRows).toHaveLength(0)
  })
})

describe("mergeTrades", () => {
  test("a brand-new org still gets a vocabulary", () => {
    expect(mergeTrades([])).toEqual([...SEED_TRADES])
  })

  test("a trade the org has actually used is kept, appended after the seeds", () => {
    expect(mergeTrades(["Tiler"])).toEqual([...SEED_TRADES, "Tiler"])
  })

  test("a case variant of a seed is NOT offered twice -- that is exactly what split the totals", () => {
    expect(mergeTrades(["mason", "MASON", "Mason"])).toEqual([...SEED_TRADES])
  })

  test("blank and null trades are dropped from the picklist rather than offered as an empty option", () => {
    expect(mergeTrades([null, undefined, "", "  "])).toEqual([...SEED_TRADES])
  })

  test("extra trades come back in a stable alphabetical order", () => {
    expect(mergeTrades(["Welder", "Tiler", "Rigger"])).toEqual([...SEED_TRADES, "Rigger", "Tiler", "Welder"])
  })
})
