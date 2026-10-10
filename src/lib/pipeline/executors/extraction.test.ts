/// <reference types="bun-types" />
// PROJEXA-BUILD-002 WP-02: create_project_from_document as a pipeline function for the internal AI.
//
// WHAT IS PROVEN
//   1. It is a registered write that needs no project (it makes one), it has an executor in EXECUTORS (one import line in executor.ts),
//      and it is on NO project link: not in the link registry the generator emits, and not named in the generator's reviewed sets.
//   2. The executor's gates, in order, before any file is read: the registry's required parameters (VALUE_REQUIRED in the D-03
//      vocabulary), an identified acting person (never the api key's id), and a member role or above.
//   3. The document must be the organisation's own and usable; a workbook the service refuses is a REQUEST_REJECTED failure that
//      carries the service's stable code in `reason` and its status; a stored document of another organisation reads as absent.
//   4. What the service answers becomes the outcome: created (id, route, and a record without project-side cost fields), pending
//      (questions and reconciliation come back as a SUCCESS, nothing created), duplicate (the first project); the two faults that
//      leave a project behind name it. Only a real boolean true acknowledges a question or a shortfall.
//   5. Through executeTask() (the real EXECUTORS map) a task with no document is refused with the registry's own failure and touches
//      no database.
//
// Run: bun test --isolate src/lib/pipeline/executors/extraction.test.ts
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { EXECUTABLE_FUNCTION_IDS, executeTask, functionWrites, hasExecutor, type ExecutableTask } from "../executor"
import { functionSpec } from "../function-registry"
import { executeCreateProjectFromDocument, type ExtractionExecutorDeps } from "./extraction"
import { EXCLUDED_REASONS, LINK_FUNCTIONS } from "../../../../scripts/gen-ai-link-registry.data"
import { ExtractionRejectedError } from "@/lib/services/document-extraction-schema"

const task = (over: Partial<ExecutableTask> = {}): ExecutableTask => ({
  orgId: "org-1",
  userId: "api-key-1",
  projectId: null,
  functionId: "create_project_from_document",
  params: { documentId: "doc-1", productId: "product-1" },
  role: "member",
  actorUserId: "person-1",
  ...over,
})

type RunInput = Parameters<ExtractionExecutorDeps["run"]>[0]
function fakeDeps(over: Partial<ExtractionExecutorDeps> = {}) {
  const calls = { read: 0, run: [] as RunInput[] }
  const deps: ExtractionExecutorDeps = {
    readDocument: async () => {
      calls.read++
      return { fileName: "book.xlsx", bytes: new Uint8Array([0x50, 0x4b, 3, 4]) }
    },
    run: async (input) => {
      calls.run.push(input)
      return {
        duplicate: false,
        projectId: "project-9",
        project: { id: "project-9", name: "Zoomies", projectValue: 5, variance: 7 },
        boq: { id: "boq-9", totalValue: 1_596_280, lineItems: [{ id: "l1", rateProject: 3, qtyProject: 4 }] },
        extraction: { sheets: 22, rows: 300, lines: 53 },
        questions: [],
        reconciliation: { status: "matched", expected: 1, actual: 1, difference: 0, tolerance: 1, source: "reader", byArea: [] },
      } as never
    },
    ...over,
  }
  return { deps, calls }
}

describe("registration", () => {
  test("a registered write that needs no project, with an executor", () => {
    const spec = functionSpec("create_project_from_document")!
    expect(spec).toMatchObject({ kind: "write", writes: true, requiresProject: false, module: "scope" })
    expect(spec.requiredParams.map((p) => [p.name, p.code, p.field])).toEqual([
      ["documentId", "VALUE_REQUIRED", "value"],
      ["productId", "VALUE_REQUIRED", "value"],
    ])
    expect(hasExecutor("create_project_from_document")).toBe(true)
    expect(EXECUTABLE_FUNCTION_IDS).toContain("create_project_from_document")
    expect(functionWrites("create_project_from_document")).toBe(true)
  })

  test("it is on no project link: not named for links, not excluded-with-a-reason, and absent from the emitted link registry", () => {
    expect("create_project_from_document" in LINK_FUNCTIONS).toBe(false)
    expect("create_project_from_document" in EXCLUDED_REASONS).toBe(false)
    const emitted = readFileSync(new URL("../../../../supabase/functions/ai-work-link/function-registry.generated.json", import.meta.url), "utf8")
    expect(emitted).not.toContain("create_project_from_document")
  })

  test("the executor file says why in its own header", () => {
    const source = readFileSync(new URL("./extraction.ts", import.meta.url), "utf8")
    expect(source).toContain("NOT ON ANY PROJECT LINK")
  })
})

describe("the gates run before any file is read", () => {
  test("a missing document or product is VALUE_REQUIRED in the registry's vocabulary", async () => {
    for (const params of [{ productId: "p" }, { documentId: "d" }, { documentId: "  ", productId: "p" }, {}]) {
      const { deps, calls } = fakeDeps()
      const out = await executeCreateProjectFromDocument(task({ params }), deps)
      expect(out.success).toBe(false)
      if (!out.success) expect([out.failure.code, out.failure.missing]).toEqual(["VALUE_REQUIRED", ["value"]])
      expect(calls.read).toBe(0)
      expect(calls.run).toHaveLength(0)
    }
  })

  test("no acting person: refused, never the api key's id", async () => {
    for (const actorUserId of [null, undefined, ""]) {
      const { deps, calls } = fakeDeps()
      const out = await executeCreateProjectFromDocument(task({ actorUserId }), deps)
      expect(out.success).toBe(false)
      if (!out.success) expect([out.failure.code, out.failure.context]).toEqual(["NOT_PERMITTED", { reason: "unidentified_actor" }])
      expect(calls.read).toBe(0)
    }
  })

  test("below member: refused; member, manager and admin are let through", async () => {
    for (const role of ["viewer", null, undefined, "stranger"]) {
      const { deps, calls } = fakeDeps()
      const out = await executeCreateProjectFromDocument(task({ role }), deps)
      expect(out.success).toBe(false)
      if (!out.success) expect([out.failure.code, out.failure.context]).toEqual(["NOT_PERMITTED", { reason: "role" }])
      expect(calls.read).toBe(0)
    }
    for (const role of ["member", "manager", "admin"]) {
      const { deps } = fakeDeps()
      expect((await executeCreateProjectFromDocument(task({ role }), deps)).success).toBe(true)
    }
  })
})

describe("the document", () => {
  test("another organisation's document reads as absent, an external link or an oversize file is a rejected request", async () => {
    const absent = await executeCreateProjectFromDocument(task(), fakeDeps({ readDocument: async () => "not_found" }).deps)
    expect(absent.success).toBe(false)
    if (!absent.success) expect([absent.failure.code, absent.failure.context]).toEqual(["RECORD_NOT_FOUND", { status: 404, functionId: "create_project_from_document" }])
    const unusable = await executeCreateProjectFromDocument(task(), fakeDeps({ readDocument: async () => "not_usable" }).deps)
    expect(unusable.success).toBe(false)
    if (!unusable.success) expect([unusable.failure.code, unusable.failure.context]).toEqual(["REQUEST_REJECTED", { status: 400, functionId: "create_project_from_document" }])
  })

  test("the service's refusal is a REQUEST_REJECTED failure with its status and its stable code as the reason", async () => {
    const { deps } = fakeDeps({
      run: async () => {
        throw new ExtractionRejectedError("extraction_total_mismatch", "short", ["a"])
      },
    })
    const out = await executeCreateProjectFromDocument(task(), deps)
    expect(out.success).toBe(false)
    if (!out.success) expect([out.failure.code, out.failure.context]).toEqual(["REQUEST_REJECTED", { status: 422, functionId: "create_project_from_document", reason: "extraction_total_mismatch" }])
  })
})

describe("what the service answers becomes the outcome", () => {
  test("created: the id, the route, and a record without project-side cost fields; the input names the acting person and the document's bytes", async () => {
    const { deps, calls } = fakeDeps()
    const out = await executeCreateProjectFromDocument(task({ params: { documentId: "doc-1", productId: "product-1", name: " Zoomies " } }), deps)
    expect(out.success).toBe(true)
    if (!out.success) return
    const result = out.result as { id: string; route: string; record: { project: Record<string, unknown>; boq: Record<string, unknown>; extraction: unknown } }
    expect([result.id, result.route]).toEqual(["project-9", "/projects/project-9"])
    expect(result.record.project.name).toBe("Zoomies")
    // The project-side cost fields (cost-visibility-service PROJECT_SIDE_COST_FIELDS) are left out, at any depth.
    expect("projectValue" in result.record.project).toBe(false)
    expect("variance" in result.record.project).toBe(false)
    expect(result.record.boq).toEqual({ id: "boq-9", totalValue: 1_596_280, lineItems: [{ id: "l1" }] })
    expect(result.record.extraction).toEqual({ sheets: 22, rows: 300, lines: 53 })
    expect(calls.run).toHaveLength(1)
    expect(calls.run[0]).toMatchObject({ orgId: "org-1", actorId: "person-1", productId: "product-1", fileName: "book.xlsx", projectName: "Zoomies", mode: "create" })
    expect(calls.run[0].bytes).toEqual(new Uint8Array([0x50, 0x4b, 3, 4]))
  })

  test("pending: nothing is created and the questions come back as a success, so the person is asked", async () => {
    const questions = [{ kind: "no_rate", sheet: "Table 6", row: 12, text: "What is the rate?" }]
    const { deps } = fakeDeps({
      run: async () => ({ duplicate: false, pending: true, state: "needs_answers", jobId: "job-1", questions, reconciliation: { status: "matched" }, extraction: { sheets: 1, rows: 2, lines: 3 } }) as never,
    })
    const out = await executeCreateProjectFromDocument(task(), deps)
    expect(out).toEqual({
      success: true,
      result: { pending: true, state: "needs_answers", jobId: "job-1", questions, reconciliation: { status: "matched" }, extraction: { sheets: 1, rows: 2, lines: 3 } },
    })
  })

  test("duplicate: the first project", async () => {
    const { deps } = fakeDeps({ run: async () => ({ duplicate: true, projectId: "project-1" }) })
    expect(await executeCreateProjectFromDocument(task(), deps)).toEqual({
      success: true,
      result: { id: "project-1", route: "/projects/project-1", record: { duplicate: true, projectId: "project-1" } },
    })
  })

  test("only a real boolean true acknowledges; mode prepare is passed on; any other mode creates", async () => {
    const seen = async (params: Record<string, unknown>) => {
      const { deps, calls } = fakeDeps()
      await executeCreateProjectFromDocument(task({ params: { documentId: "d", productId: "p", ...params } }), deps)
      return calls.run[0]
    }
    expect(await seen({ acknowledgeQuestions: true, acknowledgeShortfall: true })).toMatchObject({ acknowledgeQuestions: true, acknowledgeShortfall: true, mode: "create" })
    expect(await seen({ acknowledgeQuestions: "true", acknowledgeShortfall: 1 })).toMatchObject({ acknowledgeQuestions: false, acknowledgeShortfall: false })
    expect(await seen({ mode: "prepare" })).toMatchObject({ mode: "prepare" })
    expect(await seen({ mode: "delete" })).toMatchObject({ mode: "create" })
  })

  test("a project left behind by a fault is named in the failure, with the reason", async () => {
    const { ProjectCreatedWithoutBoqError, ProjectCreatedUnlinkedError } = await import("@/lib/services/document-extraction-schema")
    for (const [error, reason] of [
      [new ProjectCreatedWithoutBoqError("project-5", new Error("db")), "boq_create_failed"],
      [new ProjectCreatedUnlinkedError("project-6", new Error("db")), "project_link_failed"],
    ] as const) {
      const { deps } = fakeDeps({
        run: async () => {
          throw error
        },
      })
      const out = await executeCreateProjectFromDocument(task(), deps)
      expect(out.success).toBe(false)
      if (!out.success) {
        expect(out.failure.code).toBe("INTERNAL_ERROR")
        expect(out.failure.context).toEqual({ functionId: "create_project_from_document", projectId: error.projectId, reason })
        expect(out.debug).toContain(error.projectId)
      }
    }
  })

  test("an unexpected fault is not swallowed: it reaches executeTask's own handler", async () => {
    const { deps } = fakeDeps({
      run: async () => {
        throw new Error("boom")
      },
    })
    await expect(executeCreateProjectFromDocument(task(), deps)).rejects.toThrow("boom")
  })
})

describe("through the real EXECUTORS map", () => {
  test("a task with no document is refused with the registry's own failure, before any database is touched", async () => {
    const out = await executeTask({ orgId: "org-1", userId: "k", projectId: null, functionId: "create_project_from_document", params: {}, role: "member", actorUserId: "person-1" })
    expect(out.success).toBe(false)
    if (!out.success) expect([out.failure.code, out.failure.missing]).toEqual(["VALUE_REQUIRED", ["value"]])
  })
})
