/// <reference types="bun-types" />
// R67 lane B (B-03). Every level is exercised against a FIXTURE project
// through the injectable ChainOptionsRepo -- the same seam level0.ts's
// L0Repo and derive-chain.ts's ChainRepo already use in this codebase, so
// the shape of every answer is proven without a database.
import { describe, expect, test } from "bun:test"
import {
  CHAIN_LEVEL_LEGENDS,
  CHAIN_OPTION_LEGENDS,
  buildChainOptions,
  matchSegments,
  parseValueInput,
  resolveChainLevel,
  type BoqLineRow,
  type ChainOptionsRepo,
} from "./chain-options-service"

const PROJECT = "project_cedar"

// A real-shaped BOQ: one parent with two children, plus a standalone leaf.
// "Parent" is "some other line points at it", not "parentLineItemId is null"
// -- the same rule construction-progress-service.ts enforces at write time.
const LINES: BoqLineRow[] = [
  { id: "l_parent", itemCode: "EX-00", description: "Earthwork", unit: "cum", quantity: 120, childCount: 2 },
  { id: "l_child_1", itemCode: "EX-01", description: "Excavation in ordinary soil", unit: "cum", quantity: 80, childCount: 0 },
  { id: "l_child_2", itemCode: "EX-02", description: "Excavation in hard rock", unit: "cum", quantity: 40, childCount: 0 },
  { id: "l_flat", itemCode: "PC-01", description: "PCC bedding", unit: "cum", quantity: 15, childCount: 0 },
  // The demo project's own line, spelled as B-11's acceptance quotes it. Its
  // unit and quantity are what make "2 nos" a real value chip.
  { id: "l_doors", itemCode: "R66-1009b", description: "Flush door shutters", unit: "nos", quantity: 5, childCount: 0 },
]

function repoWith(overrides: Partial<ChainOptionsRepo> = {}): ChainOptionsRepo {
  return {
    latestBoqLines: async () => ({ boqId: "boq_1", version: 2, lines: LINES }),
    projects: async () => [
      { id: PROJECT, name: "Cedar Heights Villa - Phase 1" },
      { id: "project_oakwood", name: "Oakwood Residence" },
    ],
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
    expect(String(first.params?.date)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
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

// ═══════════════════════════════════════════════════════════════════════════
// B-11 -- { level, missing:[field], options, done }
// ═══════════════════════════════════════════════════════════════════════════

describe("B-11 -- segment matching accepts what the composer actually sends", () => {
  test("hyphenated module and a bare verb reach the real catalogue entry", () => {
    const m = matchSegments(["work-progress", "record"])
    expect(m.moduleDef?.id).toBe("work_progress")
    expect(m.verb?.id).toBe("record_progress")
  })

  test("the catalogue's own ids still match", () => {
    expect(matchSegments(["work_progress", "record_progress"]).verb?.id).toBe("record_progress")
  })

  test("an alias reaches the same verb", () => {
    expect(matchSegments(["labour", "attendance"]).verb?.id).toBe("mark_attendance")
  })

  test("an unknown module matches nothing rather than guessing", () => {
    expect(matchSegments(["not_a_module", "record"]).moduleDef).toBeUndefined()
  })
})

describe("B-11 -- the value vocabulary", () => {
  test("'2 nos' is a quantity, '40 %' is a percent, a bare number is a percent", () => {
    expect(parseValueInput("2 nos")).toEqual({ quantityDone: 2 })
    expect(parseValueInput("40 %")).toEqual({ percent: 40 })
    expect(parseValueInput("40%")).toEqual({ percent: 40 })
    expect(parseValueInput("40")).toEqual({ percent: 40 })
  })

  test("anything that is not a number is not a value", () => {
    expect(parseValueInput("done")).toBeNull()
    expect(parseValueInput("")).toBeNull()
  })
})

describe("B-11 acceptance -- work-progress > record on Cedar Heights", () => {
  const SEGMENTS = ["work-progress", "record"]

  test("missing is ['boqLine'] and the project's own lines are the options", async () => {
    const r = await resolveChainLevel({ segments: SEGMENTS, projectId: PROJECT, resolved: {} }, repoWith())
    expect(r.level).toBe("boqLine")
    expect(r.missing).toEqual(["boqLine"])
    expect(r.done).toBe(false)
    expect(r.legend).toBe("Which BOQ line?")
    expect(r.options.some((o) => o.label.startsWith("R66-1009b"))).toBe(true)
    expect(r.options.every((o) => o.kind === "boqLine")).toBe(true)
  })

  test("adding boqLine returns missing ['value'] with '2 nos' and '40 %' among the chips", async () => {
    const r = await resolveChainLevel(
      { segments: SEGMENTS, projectId: PROJECT, resolved: { boqLine: "l_doors" } },
      repoWith()
    )
    expect(r.level).toBe("value")
    expect(r.missing).toEqual(["value"])
    expect(r.done).toBe(false)
    expect(r.legend).toBe(CHAIN_LEVEL_LEGENDS.value)
    const labels = r.options.map((o) => o.label)
    expect(labels).toContain("2 nos")
    expect(labels).toContain("40 %")
    // A quantity chip may never exceed the line's own quantity (5 nos here).
    expect(labels).not.toContain("10 nos")
    expect(r.allowsFreeText).toBe(true)
  })

  test("adding the value returns done true, the card schema and the params tasks POST receives", async () => {
    const r = await resolveChainLevel(
      { segments: SEGMENTS, projectId: PROJECT, resolved: { boqLine: "l_doors", value: "40 %" } },
      repoWith()
    )
    expect(r.done).toBe(true)
    expect(r.missing).toEqual([])
    expect(r.level).toBe("confirm")
    expect(r.card?.primaryLabel).toBe("Save progress")
    expect(r.functionId).toBe("record_work_progress")
    expect(r.params).toEqual({
      projectId: PROJECT,
      boqLineItemId: "l_doors",
      itemCode: "R66-1009b",
      percent: 40,
    })
    // Rule 3: the chain is DERIVED (derive-chain's nav path), not composed here.
    expect(r.chain).toBe("Work Progress > New entry")
  })

  test("a quantity answers the value level as well as a percent does", async () => {
    const r = await resolveChainLevel(
      { segments: SEGMENTS, projectId: PROJECT, resolved: { boqLine: "l_doors", value: "2 nos" } },
      repoWith()
    )
    expect(r.done).toBe(true)
    expect(r.params).toMatchObject({ quantityDone: 2 })
    expect(r.params?.percent).toBeUndefined()
  })

  test("a BOQ line that is not in this project's BOQ is asked again, with the code", async () => {
    const r = await resolveChainLevel(
      { segments: SEGMENTS, projectId: PROJECT, resolved: { boqLine: "l_from_another_project", value: "40 %" } },
      repoWith()
    )
    expect(r.done).toBe(false)
    expect(r.missing).toEqual(["boqLine"])
    expect(r.code).toBe("BOQ_LINE_NOT_FOUND")
  })

  test("a percent outside 0..100 is refused by validate(), not confirmed", async () => {
    const r = await resolveChainLevel(
      { segments: SEGMENTS, projectId: PROJECT, resolved: { boqLine: "l_doors", value: "140 %" } },
      repoWith()
    )
    expect(r.done).toBe(false)
    expect(r.missing).toEqual(["value"])
    expect(r.code).toBe("VALUE_OUT_OF_RANGE")
  })
})

describe("B-11 -- field order is project -> record -> value", () => {
  test("with no project the first level is the project, with the org's real projects", async () => {
    const r = await resolveChainLevel(
      { segments: ["work-progress", "record"], projectId: null, resolved: {} },
      repoWith()
    )
    expect(r.level).toBe("project")
    expect(r.missing).toEqual(["project"])
    expect(r.legend).toBe("Which project?")
    expect(r.options.map((o) => o.label)).toEqual(["Cedar Heights Villa - Phase 1", "Oakwood Residence"])
  })

  test("the project level never reads records -- it returns before the BOQ read", async () => {
    const calls: string[] = []
    const repo = repoWith({
      projects: async () => {
        calls.push("projects")
        return [{ id: PROJECT, name: "Cedar Heights Villa - Phase 1" }]
      },
      latestBoqLines: async () => {
        calls.push("latestBoqLines")
        return null
      },
    })
    await resolveChainLevel({ segments: ["work-progress", "record"], projectId: null, resolved: {} }, repo)
    expect(calls).toEqual(["projects"])
  })

  test("answering the project at the level itself moves straight on to the record", async () => {
    const r = await resolveChainLevel(
      { segments: ["work-progress", "record"], projectId: null, resolved: { project: PROJECT } },
      repoWith()
    )
    expect(r.missing).toEqual(["boqLine"])
  })

  test("an account with no projects gets a real next step, not an empty level", async () => {
    const r = await resolveChainLevel(
      { segments: ["work-progress", "record"], projectId: null, resolved: {} },
      repoWith({ projects: async () => [] })
    )
    expect(r.options).toHaveLength(1)
    expect(r.options[0].route).toBe("/projects/new")
    expect(r.options[0].unavailableReason).toBe("This account has no projects yet")
  })
})

describe("B-11 -- every other level", () => {
  test("no segments at all asks for the module", async () => {
    const r = await resolveChainLevel({ segments: [], projectId: PROJECT, resolved: {} }, repoWith())
    expect(r.level).toBe("module")
    expect(r.missing).toEqual(["module"])
    expect(r.options.map((o) => o.id)).toContain("work_progress")
  })

  test("a module alone asks for the verb", async () => {
    const r = await resolveChainLevel({ segments: ["manpower"], projectId: PROJECT, resolved: {} }, repoWith())
    expect(r.level).toBe("verb")
    expect(r.missing).toEqual(["verb"])
  })

  test("attendance asks for the worker, then for the date with Today preselected", async () => {
    const worker = await resolveChainLevel(
      { segments: ["manpower", "mark-attendance"], projectId: PROJECT, resolved: {} },
      repoWith()
    )
    expect(worker.missing).toEqual(["worker"])
    expect(worker.multi).toBe(true)

    const date = await resolveChainLevel(
      { segments: ["manpower", "mark-attendance"], projectId: PROJECT, resolved: { worker: "w1" } },
      repoWith()
    )
    expect(date.missing).toEqual(["date"])
    expect(date.options.map((o) => o.label)).toEqual(["Today", "Yesterday"])
    expect(date.options[0].selected).toBe(true)

    const done = await resolveChainLevel(
      { segments: ["manpower", "mark-attendance"], projectId: PROJECT, resolved: { worker: "w1", date: "2026-09-02" } },
      repoWith()
    )
    expect(done.done).toBe(true)
    expect(done.card?.primaryLabel).toBe("Save attendance")
    expect(done.params).toEqual({ projectId: PROJECT, rosterId: "w1", date: "2026-09-02" })
  })

  test("a BOQ revision asks for the version and then opens the real revise route", async () => {
    const version = await resolveChainLevel(
      { segments: ["scope", "new-revision"], projectId: PROJECT, resolved: {} },
      repoWith()
    )
    expect(version.missing).toEqual(["boqVersion"])

    const done = await resolveChainLevel(
      { segments: ["scope", "new-revision"], projectId: PROJECT, resolved: { boqVersion: "boq_2" } },
      repoWith()
    )
    expect(done.done).toBe(true)
    expect(done.route).toBe("/scope/boq_2/revise")
  })

  test("the report asks for its period and then carries the run route", async () => {
    const period = await resolveChainLevel(
      { segments: ["reports", "work_progress_report"], projectId: PROJECT, resolved: {} },
      repoWith()
    )
    expect(period.missing).toEqual(["date"])
    expect(period.options.map((o) => o.id)).toEqual(["this_month", "last_month"])

    const done = await resolveChainLevel(
      { segments: ["reports", "work_progress_report"], projectId: PROJECT, resolved: { date: "this_month" } },
      repoWith()
    )
    expect(done.done).toBe(true)
    expect(done.route).toContain("/work-progress?tab=report")
  })

  test("a navigation leaf is done as soon as it is picked", async () => {
    const r = await resolveChainLevel({ segments: ["manpower", "view_roster"], projectId: null, resolved: {} }, repoWith())
    expect(r.done).toBe(true)
    expect(r.route).toBe("/labour")
    expect(r.missing).toEqual([])
  })

  test("Review Budget needs a project and is done once it has one", async () => {
    const asks = await resolveChainLevel({ segments: ["budget", "review_budget"], projectId: null, resolved: {} }, repoWith())
    expect(asks.missing).toEqual(["project"])

    const done = await resolveChainLevel(
      { segments: ["budget", "review_budget"], projectId: PROJECT, resolved: {} },
      repoWith()
    )
    expect(done.done).toBe(true)
    expect(done.functionId).toBe("review_budget")
    expect(done.chain).toBe("Budget")
  })
})

describe("B-11 -- the three rules the contract must never break", () => {
  const CASES: Array<{ segments: string[]; projectId: string | null; resolved: Record<string, string> }> = [
    { segments: [], projectId: PROJECT, resolved: {} },
    { segments: ["work-progress"], projectId: PROJECT, resolved: {} },
    { segments: ["work-progress", "record"], projectId: null, resolved: {} },
    { segments: ["work-progress", "record"], projectId: PROJECT, resolved: {} },
    { segments: ["work-progress", "record"], projectId: PROJECT, resolved: { boqLine: "l_doors" } },
    { segments: ["work-progress", "record"], projectId: PROJECT, resolved: { boqLine: "l_doors", value: "40 %" } },
    { segments: ["manpower", "mark-attendance"], projectId: PROJECT, resolved: {} },
    { segments: ["manpower", "mark-attendance"], projectId: PROJECT, resolved: { worker: "w1" } },
    { segments: ["scope", "new-revision"], projectId: PROJECT, resolved: {} },
    { segments: ["reports", "work_progress_report"], projectId: PROJECT, resolved: {} },
    { segments: ["budget", "review_budget"], projectId: PROJECT, resolved: {} },
  ]

  // The D-03 vocabulary's own keys are camelCase ("boqLine"), so the rule is
  // not "no capitals" -- it is that `missing` never leaks the pipeline's OWN
  // parameter names, which is what a client rendering it directly would show.
  const INTERNAL_PARAM_NAMES = [
    "itemCode",
    "boqLineItemId",
    "percent",
    "quantityDone",
    "rosterId",
    "projectId",
    "boqId",
    "scheduledAt",
    "entryDate",
    "externalUrl",
    "activityId",
  ]

  test("no `missing` entry is ever a pipeline parameter name or a function id", async () => {
    for (const c of CASES) {
      const r = await resolveChainLevel(c, repoWith())
      for (const field of r.missing) {
        expect(INTERNAL_PARAM_NAMES).not.toContain(field)
        expect(field).not.toContain("_")
      }
      // `missing` is empty exactly when the level is done -- there is no
      // third state where the client would have neither a question to ask
      // nor a card to show.
      expect(r.missing.length === 0).toBe(r.done)
    }
  })

  test("`missing` only ever names a key the projexa dictionary can render", async () => {
    const RENDERABLE = new Set([
      "module",
      "verb",
      "project",
      "boqLine",
      "boqVersion",
      "value",
      "date",
      "worker",
      "material",
      "task",
    ])
    for (const c of CASES) {
      const r = await resolveChainLevel(c, repoWith())
      for (const field of r.missing) expect(RENDERABLE.has(field)).toBe(true)
    }
  })

  test("every level does at most ONE repo read, and a done level does none it did not need", async () => {
    for (const c of CASES) {
      const calls: string[] = []
      const repo = repoWith({
        latestBoqLines: async () => {
          calls.push("latestBoqLines")
          return { boqId: "boq_1", version: 2, lines: LINES }
        },
        roster: async () => {
          calls.push("roster")
          return [{ id: "w1", name: "Ramesh", trade: "Civil", employeeCode: "C-01" }]
        },
        boqVersions: async () => {
          calls.push("boqVersions")
          return [{ id: "boq_2", version: 2, title: "Cedar Heights Villa BOQ", status: "approved" }]
        },
        projects: async () => {
          calls.push("projects")
          return [{ id: PROJECT, name: "Cedar Heights Villa - Phase 1" }]
        },
      })
      await resolveChainLevel(c, repo)
      expect(calls.length).toBeLessThanOrEqual(1)
    }
  })

  test("the whole ladder resolves well inside the 300 ms budget once the read is in hand", async () => {
    const started = Date.now()
    for (const c of CASES) await resolveChainLevel(c, repoWith())
    expect(Date.now() - started).toBeLessThan(300)
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
