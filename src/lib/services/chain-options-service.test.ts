/// <reference types="bun-types" />
// R67 lane B (B-03). Every level is exercised against a FIXTURE project
// through the injectable ChainOptionsRepo -- the same seam level0.ts's
// L0Repo and derive-chain.ts's ChainRepo already use in this codebase, so
// the shape of every answer is proven without a database.
import { describe, expect, test } from "bun:test"
import {
  CHAIN_OPTION_LEGENDS,
  buildChainOptions,
  type BoqLineRow,
  type ChainOptionsRepo,
} from "./chain-options-service"

const PROJECT = "project_cedar"

// A real-shaped BOQ: one parent with two children, plus a standalone leaf.
// "Parent" is "some other line points at it", not "parentLineItemId is null"
// -- the same rule construction-progress-service.ts enforces at write time.
const LINES: BoqLineRow[] = [
  { id: "l_parent", itemCode: "EX-00", description: "Earthwork", unit: "cum", childCount: 2 },
  { id: "l_child_1", itemCode: "EX-01", description: "Excavation in ordinary soil", unit: "cum", childCount: 0 },
  { id: "l_child_2", itemCode: "EX-02", description: "Excavation in hard rock", unit: "cum", childCount: 0 },
  { id: "l_flat", itemCode: "PC-01", description: "PCC bedding", unit: "cum", childCount: 0 },
]

function repoWith(overrides: Partial<ChainOptionsRepo> = {}): ChainOptionsRepo {
  return {
    latestBoqLines: async () => ({ boqId: "boq_1", version: 2, lines: LINES }),
    boqVersions: async () => [
      { id: "boq_2", version: 2, title: "Cedar Heights Villa BOQ", status: "approved" },
      { id: "boq_1", version: 1, title: "Cedar Heights Villa BOQ", status: "superseded" },
    ],
    roster: async () => [
      { id: "w1", name: "Ramesh", trade: "Civil", employeeCode: "C-01" },
      { id: "w2", name: "Suresh", trade: "Civil", employeeCode: null },
      { id: "w3", name: "Anil", trade: "Electrical", employeeCode: "E-07" },
    ],
    ...overrides,
  }
}

describe("level 0 -- the module list", () => {
  test("an empty path returns the modules, none of them leaves", async () => {
    const r = await buildChainOptions({ path: [], projectId: PROJECT }, repoWith())
    expect(r.kind).toBe("module")
    expect(r.legend).toBe(CHAIN_OPTION_LEGENDS.module)
    expect(r.options.map((o) => o.id)).toContain("work_progress")
    expect(r.options.map((o) => o.id)).toContain("manpower")
    expect(r.options.every((o) => o.isLeaf === false)).toBe(true)
  })

  test("an unknown module falls back to the module list rather than an empty level", async () => {
    const r = await buildChainOptions({ path: ["not_a_module"], projectId: PROJECT }, repoWith())
    expect(r.kind).toBe("module")
  })
})

describe("level 1 -- the module's verbs", () => {
  test("work_progress returns its verbs", async () => {
    const r = await buildChainOptions({ path: ["work_progress"], projectId: PROJECT }, repoWith())
    expect(r.kind).toBe("verb")
    expect(r.legend).toBe(CHAIN_OPTION_LEGENDS.verb)
    expect(r.options.map((o) => o.id)).toEqual(["record_progress", "view_progress"])
  })

  test("a verb that opens a route is marked as a leaf and carries the route", async () => {
    const r = await buildChainOptions({ path: ["manpower"], projectId: PROJECT }, repoWith())
    const view = r.options.find((o) => o.id === "view_roster")
    expect(view?.isLeaf).toBe(true)
    expect(view?.route).toBe("/labour")
  })

  test("a write verb carries its card schema so the client never hard-codes field names", async () => {
    const r = await buildChainOptions({ path: ["work_progress"], projectId: PROJECT }, repoWith())
    const record = r.options.find((o) => o.id === "record_progress")
    expect(record?.functionId).toBe("record_work_progress")
    expect(record?.schema?.primaryLabel).toBe("Save progress")
    expect(record?.schema?.fields.map((f) => f.key)).toContain("itemCode")
  })
})

// ── B-03's acceptance ──────────────────────────────────────────────────────
describe("level 2 -- ['work_progress','record_progress'] returns the project's BOQ lines", () => {
  test("the legend is exactly 'Which BOQ line?'", async () => {
    const r = await buildChainOptions({ path: ["work_progress", "record_progress"], projectId: PROJECT }, repoWith())
    expect(r.legend).toBe("Which BOQ line?")
    expect(r.kind).toBe("record")
  })

  test("every option is either a leaf or carries a non-empty unavailableReason", async () => {
    const r = await buildChainOptions({ path: ["work_progress", "record_progress"], projectId: PROJECT }, repoWith())
    expect(r.options.length).toBe(LINES.length)
    for (const o of r.options) {
      expect(o.isLeaf === true || (typeof o.unavailableReason === "string" && o.unavailableReason.length > 0)).toBe(true)
    }
  })

  test("a parent line is listed, disabled, and says how many sub-items to pick from", async () => {
    const r = await buildChainOptions({ path: ["work_progress", "record_progress"], projectId: PROJECT }, repoWith())
    const parent = r.options.find((o) => o.id === "l_parent")
    expect(parent?.isLeaf).toBe(false)
    expect(parent?.unavailableReason).toBe("Parent line - pick one of its 2 sub-items")
    // A disabled option must not carry a runnable function.
    expect(parent?.functionId).toBeUndefined()
  })

  test("a leaf line resolves to {functionId, params} tasks/route.ts understands", async () => {
    const r = await buildChainOptions({ path: ["work_progress", "record_progress"], projectId: PROJECT }, repoWith())
    const leaf = r.options.find((o) => o.id === "l_child_1")
    expect(leaf?.isLeaf).toBe(true)
    expect(leaf?.functionId).toBe("record_work_progress")
    expect(leaf?.params).toEqual({ projectId: PROJECT, boqLineItemId: "l_child_1", itemCode: "EX-01" })
    expect(leaf?.next).toBe("card")
  })

  test("a project with no BOQ gets a real next step, not an empty list", async () => {
    const r = await buildChainOptions(
      { path: ["work_progress", "record_progress"], projectId: PROJECT },
      repoWith({ latestBoqLines: async () => null })
    )
    expect(r.options).toHaveLength(1)
    expect(r.options[0].unavailableReason).toBe("This project has no BOQ yet")
    expect(r.options[0].route).toBe("/scope/new")
  })

  test("with no project selected it asks for one instead of reading nothing", async () => {
    let read = false
    const r = await buildChainOptions(
      { path: ["work_progress", "record_progress"], projectId: null },
      repoWith({
        latestBoqLines: async () => {
          read = true
          return null
        },
      })
    )
    expect(read).toBe(false)
    expect(r.options[0].unavailableReason).toBe("Pick a project in the top rail first")
  })
})

describe("level 2 -- ['manpower','mark_attendance'] returns the roster", () => {
  test("grouped by trade, multi:true, everybody preselected", async () => {
    const r = await buildChainOptions({ path: ["manpower", "mark_attendance"], projectId: PROJECT }, repoWith())
    expect(r.legend).toBe("Which worker?")
    expect(r.multi).toBe(true)
    expect(r.options.map((o) => o.group)).toEqual(["Civil", "Civil", "Electrical"])
    expect(r.options.every((o) => o.selected === true)).toBe(true)
    expect(r.options.every((o) => o.isLeaf === true)).toBe(true)
  })

  test("each worker carries the params the attendance write needs", async () => {
    const r = await buildChainOptions({ path: ["manpower", "mark_attendance"], projectId: PROJECT }, repoWith())
    const first = r.options[0]
    expect(first.functionId).toBe("record_attendance")
    expect(first.params).toMatchObject({ projectId: PROJECT, rosterId: "w1", status: "present" })
    expect(String(first.params?.attendanceDate)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test("an empty roster offers the way to fill it", async () => {
    const r = await buildChainOptions(
      { path: ["manpower", "mark_attendance"], projectId: PROJECT },
      repoWith({ roster: async () => [] })
    )
    expect(r.options[0].route).toBe("/labour/new")
    expect(r.options[0].unavailableReason).toBe("This project has nobody on its roster yet")
  })
})

describe("level 2 -- ['scope','new_revision'] returns the BOQ versions", () => {
  test("the legend is 'From which version?' and each option routes to the real revise screen", async () => {
    const r = await buildChainOptions({ path: ["scope", "new_revision"], projectId: PROJECT }, repoWith())
    expect(r.legend).toBe("From which version?")
    expect(r.kind).toBe("version")
    expect(r.options[0]).toMatchObject({
      id: "boq_2",
      label: "Cedar Heights Villa BOQ (v2)",
      isLeaf: true,
      next: "route",
      route: "/scope/boq_2/revise",
    })
  })
})

describe("level 2 -- ['reports','work_progress_report'] opens already answered", () => {
  test("parameter chips with this month preselected", async () => {
    const r = await buildChainOptions({ path: ["reports", "work_progress_report"], projectId: PROJECT }, repoWith())
    expect(r.kind).toBe("parameter")
    expect(r.options.map((o) => o.id)).toEqual(["this_month", "last_month"])
    expect(r.options[0].selected).toBe(true)
    expect(r.options[0].route).toContain("/work-progress?tab=report")
    expect(String(r.defaults?.from)).toMatch(/^\d{4}-\d{2}-01$/)
  })
})

describe("a verb that finishes the chain by itself", () => {
  test("review_budget comes back as one leaf carrying the project", async () => {
    const r = await buildChainOptions({ path: ["budget", "review_budget"], projectId: PROJECT }, repoWith())
    expect(r.options).toHaveLength(1)
    expect(r.options[0]).toMatchObject({
      id: "review_budget",
      isLeaf: true,
      next: "ask",
      functionId: "review_budget",
      params: { projectId: PROJECT },
    })
  })
})

describe("one read per request", () => {
  test("a BOQ-line level touches the BOQ read only, never the roster or version reads", async () => {
    const calls: string[] = []
    const repo = repoWith({
      latestBoqLines: async () => {
        calls.push("latestBoqLines")
        return { boqId: "boq_1", version: 2, lines: LINES }
      },
      roster: async () => {
        calls.push("roster")
        return []
      },
      boqVersions: async () => {
        calls.push("boqVersions")
        return []
      },
    })
    await buildChainOptions({ path: ["work_progress", "record_progress"], projectId: PROJECT }, repo)
    expect(calls).toEqual(["latestBoqLines"])
  })
})
