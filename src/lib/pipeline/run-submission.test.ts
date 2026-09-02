/// <reference types="bun-types" />
// R65 Part C Phase 3: unit tests for run-submission.ts's own memory-pipeline
// wiring. Only buildTaskResultMemoryContent() -- a pure formatter -- is
// tested here, matching this file's pre-existing (zero) test coverage
// convention for everything else in run-submission.ts: every other function
// here is withTenantContext/DB-backed (segment/classify/deriveChain/
// executeTask, all real DB round-trips) and none of it has ever had a
// mocked-DB unit test in this repo (unlike executor.ts/classify.ts/
// level0.ts/segment.ts, which do). captureTaskResultMemory() itself (the
// withTenantContext + createMemoryRecord() call this phase adds) is
// therefore a disclosed gap, not a silently-skipped one -- see this PR's
// own description.
//
// R65 Part D Phase 3 (2026-09) adds markInProgress() to this same file, for
// the same reason and under the same disclosed gap: it is a one-line
// withTenantContext DB write with no pure logic of its own to extract and
// unit test (unlike buildTaskResultMemoryContent()'s real string
// formatting), so it is exercised by this repo's real-DB-backed
// integration/E2E surface, not a mocked-DB unit test here.
//
// R65 Part D (2026-09, reuse_cache wiring) wires resolveAll()'s two
// runLevel1() call sites through resolveMissesWithReuseCache() and
// constructs a real makeReuseCacheRepo() -- both DB-backed, same disclosed
// gap as above, not unit tested from this file. The actual NEW logic (cache
// hit skips the model, cache miss falls through and records the result) is
// NOT part of that gap: it lives in resolveMissesWithReuseCache() itself,
// which takes an injectable fake repo AND an injectable fake runLevel1Fn
// (same seam pattern level0.ts's L0Repo already established) and has real,
// dedicated coverage in reuse-cache.test.ts.
import { describe, expect, test } from "bun:test"
import { buildTaskResultMemoryContent } from "./run-submission"

describe("buildTaskResultMemoryContent -- R65 Part C Phase 3 task memory", () => {
  test("includes the segment text and function id", () => {
    const content = buildTaskResultMemoryContent("record_work_progress", "PP1 is 50% done", { itemCode: "PP1", percent: 50 })
    expect(content).toContain("PP1 is 50% done")
    expect(content).toContain("record_work_progress")
  })

  test("includes a plain key=value param summary", () => {
    const content = buildTaskResultMemoryContent("record_work_progress", "PP1 is 50% done", { itemCode: "PP1", percent: 50 })
    expect(content).toContain("itemCode=\"PP1\"")
    expect(content).toContain("percent=50")
  })

  test("omits the parenthesised param summary entirely when there are no params", () => {
    const content = buildTaskResultMemoryContent("record_work_progress", "mark it done", {})
    expect(content).toBe('Task completed: "mark it done" -> record_work_progress')
    expect(content).not.toContain("()")
  })
})

// ── R67 B-05: the dry run (the proposal step) ─────────────────────────────
// dryRunSubmission() lives in dry-run.ts and is re-exported from
// run-submission.ts, so this file covers it: it is the same public surface a
// route imports. Every dependency is injected, so each branch is proven with
// no database and no model call.
import { readFileSync } from "node:fs"
import { dryRunSubmission, NO_COMMENTARY_SENTENCE } from "./run-submission"
import { gapAnswer, type DryRunDeps } from "./dry-run"
import type { L0Repo } from "./level0"
import type { ReuseCacheRepo } from "./reuse-cache"

const BOQ_OPTIONS = [
  { id: "EX-01", label: "EX-01 Excavation in ordinary soil" },
  { id: "EX-02", label: "EX-02 Excavation in hard rock" },
]

function depsFor(phrase: Record<string, { functionId: string; fixedParams: Record<string, unknown> | null }>, over: Partial<DryRunDeps> = {}): DryRunDeps {
  const l0Repo: L0Repo = {
    findPhraseMapMatch: async (_orgId, normalised) => phrase[normalised] ?? null,
    findLastPillUse: async () => null,
  }
  const reuseRepo: ReuseCacheRepo = {
    findReuseHit: async () => null,
    recordReuseHit: async () => {
      throw new Error("the dry run must not reach the model on a phrase-map hit")
    },
  }
  return {
    l0Repo,
    reuseRepo,
    chainRepo: { findScreen: async () => null },
    rootLabel: "Cedar Heights Villa - Phase 1",
    boqLineOptions: async () => BOQ_OPTIONS,
    runRead: async () => ({ success: true, result: { rows: [{ activity: "Excavation", percent: 40 }] } }),
    providerAvailable: () => true,
    ...over,
  }
}

const BASE = {
  orgId: "org_1",
  userId: "user_1",
  mode: "Projects",
  projectId: "p1",
  candidateFunctionIds: ["record_work_progress", "get_construction_project_dashboard"],
}

describe("B-05 -- a WRITE proposal asks for what is missing and mints nothing", () => {
  const deps = depsFor({
    "record 50% progress on excavation": { functionId: "record_work_progress", fixedParams: { percent: 50 } },
  })

  test("kind is 'write' and `missing` names the BOQ line in words", async () => {
    const r = await dryRunSubmission({ ...BASE, rawInput: "record 50% progress on excavation" }, deps)
    expect(r.dryRun).toBe(true)
    expect(r.kind).toBe("write")
    expect(r.status).toBe("needs_input")
    expect(r.missing).toContainEqual(
      expect.objectContaining({ name: "itemCode", label: "BOQ line", code: "BOQ_LINE_REQUIRED" })
    )
  })

  test("the missing BOQ line comes with the project's real lines as chips, not 'please retype it'", async () => {
    const r = await dryRunSubmission({ ...BASE, rawInput: "record 50% progress on excavation" }, deps)
    expect(r.missing[0].options).toEqual(BOQ_OPTIONS)
  })

  test("it returns the derived chain and the human label, never a function id to print", async () => {
    const r = await dryRunSubmission({ ...BASE, rawInput: "record 50% progress on excavation" }, deps)
    expect(r.chain?.full).toBe("Cedar Heights Villa - Phase 1 > Work Progress > New entry")
    expect(r.label).toBe("Record progress")
  })

  test("it carries the card schema so the client renders the card from the server's fields", async () => {
    const r = await dryRunSubmission({ ...BASE, rawInput: "record 50% progress on excavation" }, deps)
    expect(r.schema?.primaryLabel).toBe("Save progress")
  })

  test("NO pipeline_tasks row is created -- the module has no path to the table at all", async () => {
    const r = await dryRunSubmission({ ...BASE, rawInput: "record 50% progress on excavation" }, deps)
    expect(JSON.stringify(r)).not.toContain("taskId")
    // Structural proof, not a spy: dry-run.ts imports neither the tasks table
    // nor a transaction, so there is no code path that could insert one.
    const source = readFileSync(new URL("./dry-run.ts", import.meta.url).pathname.replace(/^\//, ""), "utf8")
    expect(source).not.toContain("pipelineTasks")
    expect(source).not.toContain("withTenantContext")
  })
})

describe("B-05 -- an ASK answers from the records even when the model will not", () => {
  const phrase = {
    "show me the project dashboard": { functionId: "get_construction_project_dashboard", fixedParams: null },
  }

  test("provider unavailable: rows plus the sentence, never a bare refusal", async () => {
    const r = await dryRunSubmission(
      { ...BASE, rawInput: "show me the project dashboard" },
      depsFor(phrase, { providerAvailable: () => false })
    )
    expect(r.kind).toBe("ask")
    expect(r.status).toBe("answered")
    expect(r.answer?.rows).toEqual({ rows: [{ activity: "Excavation", percent: 40 }] })
    expect(r.answer?.text?.startsWith("VERI can't add commentary right now")).toBe(true)
    expect(r.answer?.text).toBe(NO_COMMENTARY_SENTENCE)
    expect(r.answer?.text).not.toContain("not available for this account")
  })

  test("provider available: the same rows, with nothing apologised for", async () => {
    const r = await dryRunSubmission({ ...BASE, rawInput: "show me the project dashboard" }, depsFor(phrase))
    expect(r.status).toBe("answered")
    expect(r.answer?.text).toBeNull()
    expect(r.answer?.chain).toContain("Cedar Heights Villa")
  })

  test("a read that fails for a missing parameter becomes needs_input, not a blocked task", async () => {
    const r = await dryRunSubmission(
      { ...BASE, projectId: null, rawInput: "show me the project dashboard" },
      depsFor(phrase, {
        runRead: async () => ({ success: false, failure: { code: "PROJECT_REQUIRED", missing: ["projectId"], picker: "project" } }),
      })
    )
    expect(r.status).toBe("needs_input")
    expect(r.missing[0]).toMatchObject({ name: "projectId", label: "Project", code: "PROJECT_REQUIRED" })
  })
})

describe("B-05 -- a GAP is an answer with a destination", () => {
  test("the exact sentence for a capability that is not wired", () => {
    expect(gapAnswer("create a customer called ABC Ltd")).toEqual({
      message: "Creating customers from chat is not enabled for this workspace - Open Customers",
      route: "/customers",
    })
  })

  test("a recognised module without a create verb still gets its screen", () => {
    expect(gapAnswer("what about our vendors").route).toBe("/vendors")
  })

  test("an unrecognised request never invents a promise", () => {
    const answer = gapAnswer("do the thing with the stuff")
    expect(answer.message).toBe("That is not enabled for this workspace yet - Open Home")
    expect(answer.route).toBe("/dashboard")
  })

  test("no gap sentence ever says 'not available for this account'", () => {
    for (const text of ["create a customer", "raise an invoice", "add an employee", "nonsense"]) {
      expect(gapAnswer(text).message).not.toContain("not available for this account")
    }
  })

  test("an unresolved segment comes back as a gap with a route, not as a task", async () => {
    const r = await dryRunSubmission(
      { ...BASE, rawInput: "create a customer called ABC Ltd" },
      depsFor({}, { reuseRepo: { findReuseHit: async () => null, recordReuseHit: async () => {} } })
    )
    expect(r.status).toBe("gap")
    expect(r.functionId).toBeNull()
    expect(r.route).toBe("/customers")
  })
})

// ── R67 B-06: a transport failure is a RETRY, not a blocked task ──────────
import { statusForFailure } from "./run-submission"
import { pipelineFailure } from "./error-codes"

describe("B-06 -- statusForFailure keeps a transport failure out of the blocked half", () => {
  test("BACKEND_UNAVAILABLE is recorded as waiting, never blocked", () => {
    expect(statusForFailure(pipelineFailure("BACKEND_UNAVAILABLE"))).toBe("waiting")
  })

  test("a real user-fixable failure is still blocked", () => {
    expect(statusForFailure(pipelineFailure("BOQ_LINE_REQUIRED", ["boqLine"]))).toBe("blocked")
    expect(statusForFailure(pipelineFailure("PROJECT_REQUIRED", ["projectId"]))).toBe("blocked")
    expect(statusForFailure(pipelineFailure("NOT_PERMITTED"))).toBe("blocked")
  })

  test("an application bug is blocked -- retrying it changes nothing", () => {
    expect(statusForFailure(pipelineFailure("INTERNAL_ERROR"))).toBe("blocked")
  })
})

// ── R67 B-07: the submission answers with a VERDICT and mints nothing ─────
// submitForVerdict() itself is the DB wiring (insert one submissions row,
// propose, update its status); the DECISION -- what the verdict is, what is
// missing, and whether anything is confirmable -- is toVerdictResult() over
// dryRunSubmission()'s output, and both are pure with every dependency
// injected. That composition is exactly what the route returns, so it is
// what is proved here, with no database and no model call.
import { toVerdict, toVerdictResult } from "./verdict"

describe("B-07 -- a task that cannot be completed comes back as a question, not a blocked row", () => {
  const deps = depsFor({
    "record 50% progress on excavation": { functionId: "record_work_progress", fixedParams: { percent: 50 } },
  })

  test("verdict 'task' with missing [{name:'boqLineItemId', code:'BOQ_LINE_REQUIRED'}]", async () => {
    const proposal = await dryRunSubmission({ ...BASE, rawInput: "record 50% progress on excavation" }, deps)
    const v = toVerdictResult(proposal, "sub_1")
    expect(v.verdict).toBe("task")
    expect(v.status).toBe("needs_input")
    expect(v.missing).toContainEqual(
      expect.objectContaining({ name: "boqLineItemId", code: "BOQ_LINE_REQUIRED" })
    )
    // and it is NOT offered as something to confirm -- there is nothing to run
    expect(v.confirmable).toBe(false)
    expect(v.submissionId).toBe("sub_1")
  })

  test("the missing field is named in the D-03 vocabulary, never as a parameter", async () => {
    const proposal = await dryRunSubmission({ ...BASE, rawInput: "record 50% progress on excavation" }, deps)
    const v = toVerdictResult(proposal, "sub_1")
    expect(v.missing[0].field).toBe("boqLine")
    expect(v.missing[0].label).toBe("BOQ line")
  })

  test("`understood` names the function in words and carries the rail's project", async () => {
    const proposal = await dryRunSubmission({ ...BASE, rawInput: "record 50% progress on excavation" }, deps)
    const v = toVerdictResult(proposal, "sub_1")
    expect(v.understood).toMatchObject({ functionId: "record_work_progress", label: "Record progress", projectId: "p1" })
    // the chain is always returned, so the client can print "Understood: <chain>"
    expect(typeof v.chain).toBe("string")
  })

  test("the chips it offers are the project's real lines, addressed by their record id", async () => {
    const withIds = depsFor(
      { "record 50% progress on excavation": { functionId: "record_work_progress", fixedParams: { percent: 50 } } },
      { boqLineOptions: async () => [{ id: "EX-01", label: "EX-01 Excavation", lineItemId: "line_9" }] }
    )
    const proposal = await dryRunSubmission({ ...BASE, rawInput: "record 50% progress on excavation" }, withIds)
    const v = toVerdictResult(proposal, "sub_1")
    expect(v.missing[0].options).toEqual([{ id: "line_9", label: "EX-01 Excavation" }])
  })

  test("NOTHING in the verdict path can insert a pipeline_tasks row", () => {
    // The structural proof, stronger than a spy: neither module can reach the
    // table or a tenant transaction at all, so there is no code path -- taken
    // or untaken -- that could mint a row.
    for (const file of ["./src/lib/pipeline/dry-run.ts", "./src/lib/pipeline/verdict.ts"]) {
      const source = readFileSync(file, "utf8")
      expect(source).not.toContain("pipelineTasks")
      expect(source).not.toContain("withTenantContext")
    }
  })
})

describe("B-07 -- a fully-resolved write is offered for confirmation, never run outright", () => {
  const deps = depsFor({
    "record 50% progress on ex-01": { functionId: "record_work_progress", fixedParams: { percent: 50, itemCode: "EX-01" } },
  })

  test("status 'ready' and confirmable true", async () => {
    const proposal = await dryRunSubmission({ ...BASE, rawInput: "record 50% progress on EX-01" }, deps)
    const v = toVerdictResult(proposal, "sub_2")
    expect(v.status).toBe("ready")
    expect(v.confirmable).toBe(true)
    expect(v.missing).toEqual([])
    // the card the client renders comes from the server's own field list
    expect(v.schema?.primaryLabel).toBe("Save progress")
  })
})

describe("B-07 -- a gap answers with a destination and is never confirmable", () => {
  test("the sentence and the link", async () => {
    const proposal = await dryRunSubmission(
      { ...BASE, rawInput: "create a customer called ABC Ltd" },
      depsFor({}, { reuseRepo: { findReuseHit: async () => null, recordReuseHit: async () => {} } })
    )
    const v = toVerdictResult(proposal, "sub_3")
    expect(v.verdict).toBe("gap")
    expect(v.confirmable).toBe(false)
    expect(v.understood).toBeNull()
    expect(v.links).toEqual([{ label: "Open Customers", route: "/customers" }])
  })
})

describe("B-07 -- the per-segment verdict is never collapsed", () => {
  test("an empty proposal set still returns a well-formed envelope", () => {
    const v = toVerdictResult({ dryRun: true, proposals: [], status: "chat", verdict: "chat", kind: "ask", functionId: null, label: null, params: {}, missing: [], chain: null }, null)
    expect(v.verdicts).toEqual([])
    expect(v.status).toBe("chat")
    expect(v.confirmable).toBe(false)
  })

  test("toVerdict maps one proposal on its own", () => {
    const v = toVerdict({
      segmentText: "hello",
      status: "chat",
      verdict: "chat",
      kind: "ask",
      functionId: null,
      label: null,
      params: {},
      missing: [],
      chain: null,
    })
    expect(v.understood).toBeNull()
    expect(v.missing).toEqual([])
  })
})
