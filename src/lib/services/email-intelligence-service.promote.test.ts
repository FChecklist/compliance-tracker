/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-31, register row BR-414 (PMD-05: an email-triggered action is never a write). Promoting a BOQ
// line-item suggestion of an email stores 1 submission proposal (compliance.submissions, through submitForVerdict(), which
// runs proposeSubmission()), 0 tasks rows and 0 construction_boq_line_items rows; confirmSubmission() on that proposal then
// writes the line item, through the create_boq registry entry (U-28, PR 1869) with the one nested line.
//
// Also proven, because they are what "only a proposal" and "every other promote behaviour unchanged" mean:
//   - the proposal carries the line exactly as the suggestion gave it (description, unit, quantity, rate, item code), so
//     the person who confirms writes what the email said, re-read from the stored row rather than from the return value;
//   - the BOQ is recorded under the person who confirmed;
//   - a BOQ suggestion with no project, or with another organisation's project, is refused and writes nothing;
//   - a non-BOQ suggestion keeps today's path: 1 tasks row, 1 email_intelligence_action_items row, the task engine runs it
//     once, and no submission is stored;
//   - a "boq_line_item" entry without a usable line is read exactly as sanitizeSuggestedWorkItems reads it (a follow_up),
//     and the shared sanitizer ticket-intelligence-service.ts reuses is unchanged.
//
// WHAT IS REAL: email-intelligence-service.ts, logActivity, run-submission.ts (submitForVerdict, proposeSubmission,
// confirmSubmission, runDirectTask), the dry run, Level 0, validate(), executor.ts, function-registry.ts and createBoq().
// WHAT IS FAKED: @/lib/db/tenant-scoped, by src/lib/pipeline/__test-helpers__/boq-store-double.ts (the double the BR-406 test
// uses: it evaluates the real compiled where clauses against fixture rows and commits a transaction's writes only when it
// resolves), and the task engine's executeTask (it would plan the task with a model). Level 0 answers "new boq" from a
// promoted phrase_map row, as the BR-406 pipeline test does, so no model is asked anything.
//
// Run: bun test --isolate src/lib/services/email-intelligence-service.promote.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { fakeWithTenantContext, makeBoqStore, rowsOf, seedRows, type BoqStore, type Row } from "@/lib/pipeline/__test-helpers__/boq-store-double"
import { normaliseForMatch } from "@/lib/pipeline/classify"

const ORG = "org_1"
const OTHER_ORG = "org_2"
const PROJECT_A = "project_a"
const PROJECT_OTHER_ORG = "project_x"
const PERSON = "person_1"
const ITEM = "eii_1"

let store: BoqStore

const realTenantScoped = await import("@/lib/db/tenant-scoped")
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: fakeWithTenantContext(() => store) }))

let engineCalls: Array<{ taskId: string; title: string }> = []
const realEngine = await import("@/lib/task-execution-engine")
mock.module("@/lib/task-execution-engine", () => ({
  ...realEngine,
  executeTask: async (_orgId: string, _userId: string, taskId: string, title: string) => {
    engineCalls.push({ taskId, title })
    return { success: true }
  },
}))

let service: typeof import("./email-intelligence-service")
let confirmSubmission: typeof import("@/lib/pipeline/run-submission").confirmSubmission
beforeAll(async () => {
  service = await import("./email-intelligence-service")
  ;({ confirmSubmission } = await import("@/lib/pipeline/run-submission"))
})

/** The BOQ line suggestion as analyzeInboundEmail stores it (sanitizeEmailSuggestedWorkItems's output shape). */
const BOQ_SUGGESTION = {
  title: "Add BOQ line: Excavation in ordinary soil",
  category: "boq_line_item",
  assignee: null,
  dueDateHint: null,
  boqLineItem: { projectId: PROJECT_A, boqTitle: "Villa 21 - Tender BOQ", itemCode: "1.01", description: "Excavation in ordinary soil", unit: "cum", quantity: 120, rate: 450 },
}
const TASK_SUGGESTION = { title: "Send the revised drawings to the site", category: "commitment", assignee: null, dueDateHint: "Friday" }

function fixtures(suggestions: unknown[] = [TASK_SUGGESTION, BOQ_SUGGESTION]): BoqStore {
  const s = makeBoqStore()
  seedRows(s, "projects", [
    { id: PROJECT_A, orgId: ORG, name: "Cedar Heights" },
    { id: PROJECT_OTHER_ORG, orgId: OTHER_ORG, name: "Elsewhere" },
  ])
  seedRows(s, "users", [{ id: PERSON, orgId: ORG, isActive: true, role: "manager", name: "Asha M", email: "asha@example.test" }])
  // Level 0 resolves the stored words to create_boq, the same promoted phrase the BR-406 pipeline test uses.
  seedRows(s, "phrase_map", [
    { orgId: ORG, normalisedPhrase: normaliseForMatch("new boq"), functionId: "create_boq", fixedParams: null, promotedAt: new Date() },
  ])
  seedRows(s, "email_intelligence_items", [
    {
      id: ITEM,
      orgId: ORG,
      submittedById: PERSON,
      subject: "BOQ for Villa 21",
      senderEmail: "site@vendor.test",
      body: "Please add excavation, 120 cum at 450.",
      status: "proposed",
      aiSuggestedWorkItems: suggestions,
    },
  ])
  return s
}

const dbUser = { id: PERSON, orgId: ORG, name: "Asha M", email: "asha@example.test", role: "manager", isActive: true } as never
const ctx = () => ({ orgId: ORG, userId: PERSON, dbUser })
const tableCounts = () =>
  Object.fromEntries(
    ["submissions", "tasks", "construction_boqs", "construction_boq_line_items", "pipeline_tasks", "email_intelligence_action_items"].map((t) => [t, rowsOf(store, t).length])
  )

let silenced: Array<{ mockRestore: () => void }> = []
beforeEach(() => {
  store = fixtures()
  engineCalls = []
  silenced = [
    spyOn(console, "error").mockImplementation(() => {}),
    spyOn(console, "warn").mockImplementation(() => {}),
    spyOn(console, "info").mockImplementation(() => {}),
  ]
})
afterEach(() => {
  for (const s of silenced) s.mockRestore()
})
afterAll(async () => {
  mock.restore()
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
  await mock.module("@/lib/task-execution-engine", () => realEngine)
})

describe("BR-414: promoting a BOQ line-item suggestion stores a proposal and writes nothing else (PMD-05)", () => {
  test("*** THE ROW: 1 submission proposal, 0 tasks rows, 0 construction_boq_line_items rows ***", async () => {
    const result = (await service.promoteEmailIntelligenceItem(ctx(), ITEM, { suggestedIndex: 1 })) as { proposal: { submissionId: string; staged: boolean; functionId: string } }

    // Re-read from the store, not from the return value.
    expect(tableCounts()).toEqual({
      submissions: 1,
      tasks: 0,
      construction_boqs: 0,
      construction_boq_line_items: 0,
      pipeline_tasks: 0,
      email_intelligence_action_items: 0,
    })
    const [submission] = rowsOf(store, "submissions")
    expect(submission.id).toBe(result.proposal.submissionId)
    expect([submission.orgId, submission.projectId, submission.userId, submission.rawInput, submission.mode]).toEqual([ORG, PROJECT_A, PERSON, "new boq", "Projects"])
    // The verdict left the ball with the person: a proposal, not closed and not executed.
    expect(submission.status).toBe("in_progress")
    expect(result.proposal.staged).toBe(true)
    expect(result.proposal.functionId).toBe("create_boq")
    // The line travels in the stored row, exactly as the email's suggestion gave it.
    expect(submission.selectedChain).toEqual({
      source: "email_intelligence",
      emailIntelligenceItemId: ITEM,
      suggestedIndex: 1,
      functionId: "create_boq",
      params: {
        projectId: PROJECT_A,
        title: "Villa 21 - Tender BOQ",
        lineItems: [{ itemCode: "1.01", description: "Excavation in ordinary soil", unit: "cum", quantity: 120, rate: 450 }],
      },
    })
    // The task engine was not asked to run anything, and the promote is on the audit trail.
    expect(engineCalls).toEqual([])
    expect(rowsOf(store, "audit_logs").map((a) => [a.action, a.entityId, a.userId])).toEqual([["email_intelligence.proposed", ITEM, PERSON]])
  })

  test("confirmSubmission on that proposal writes 1 line item equal to the suggestion, under the confirming person", async () => {
    await service.promoteEmailIntelligenceItem(ctx(), ITEM, { suggestedIndex: 1 })
    const [stored] = rowsOf(store, "submissions")
    const chain = stored.selectedChain as { functionId: string; params: Record<string, unknown> }

    const outcome = await confirmSubmission({
      orgId: ORG,
      userId: PERSON,
      submissionId: stored.id as string,
      functionId: chain.functionId,
      params: chain.params,
      role: "manager",
      actorUserId: PERSON,
    })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.result.status).toBe("done")
    // Still one submission (the confirm runs on the proposal's own row), still no tasks row.
    expect(tableCounts()).toMatchObject({ submissions: 1, tasks: 0, construction_boqs: 1, construction_boq_line_items: 1, pipeline_tasks: 1 })
    const [boq] = rowsOf(store, "construction_boqs")
    expect([boq.orgId, boq.projectId, boq.title, boq.createdById]).toEqual([ORG, PROJECT_A, "Villa 21 - Tender BOQ", PERSON])
    const [line] = rowsOf(store, "construction_boq_line_items") as Row[]
    expect([line.boqId, line.orgId, line.itemCode, line.description, line.unit, Number(line.quantity), Number(line.rate)]).toEqual([
      boq.id,
      ORG,
      "1.01",
      "Excavation in ordinary soil",
      "cum",
      120,
      450,
    ])
    expect(engineCalls).toEqual([])
  })

  test("the project may come from the promote call when the suggestion names none", async () => {
    store = fixtures([{ ...BOQ_SUGGESTION, boqLineItem: { ...BOQ_SUGGESTION.boqLineItem, projectId: null } }])

    await service.promoteEmailIntelligenceItem(ctx(), ITEM, { suggestedIndex: 0, projectId: PROJECT_A })

    expect(tableCounts()).toMatchObject({ submissions: 1, tasks: 0, construction_boq_line_items: 0 })
    expect((rowsOf(store, "submissions")[0].selectedChain as { params: { projectId: string } }).params.projectId).toBe(PROJECT_A)
  })

  test("no project anywhere -> 400, and nothing is written", async () => {
    store = fixtures([{ ...BOQ_SUGGESTION, boqLineItem: { ...BOQ_SUGGESTION.boqLineItem, projectId: null } }])
    const before = JSON.stringify(store.tables)

    await expect(service.promoteEmailIntelligenceItem(ctx(), ITEM, { suggestedIndex: 0 })).rejects.toMatchObject({ status: 400 })
    expect(JSON.stringify(store.tables)).toBe(before)
  })

  test("another organisation's project -> 404 (reads as absent), and nothing is written", async () => {
    store = fixtures([{ ...BOQ_SUGGESTION, boqLineItem: { ...BOQ_SUGGESTION.boqLineItem, projectId: PROJECT_OTHER_ORG } }])
    const before = JSON.stringify(store.tables)

    await expect(service.promoteEmailIntelligenceItem(ctx(), ITEM, { suggestedIndex: 0 })).rejects.toMatchObject({ status: 404 })
    expect(JSON.stringify(store.tables)).toBe(before)
  })
})

describe("BR-414: every other promote keeps today's behaviour", () => {
  test("a non-BOQ suggestion: 1 tasks row, 1 action item linked to it, the task engine runs it once, no submission", async () => {
    const result = (await service.promoteEmailIntelligenceItem(ctx(), ITEM, { suggestedIndex: 0, dueDate: "2026-10-02" })) as { taskId: string; task: Row }

    expect(tableCounts()).toEqual({
      submissions: 0,
      tasks: 1,
      construction_boqs: 0,
      construction_boq_line_items: 0,
      pipeline_tasks: 0,
      email_intelligence_action_items: 1,
    })
    const [task] = rowsOf(store, "tasks")
    expect([task.orgId, task.userId, task.assignedById, task.title, task.status]).toEqual([ORG, PERSON, PERSON, TASK_SUGGESTION.title, "in_progress"])
    expect(task.description).toBe('Detected from email "BOQ for Villa 21" (from site@vendor.test): commitment')
    const [actionItem] = rowsOf(store, "email_intelligence_action_items")
    expect([actionItem.emailIntelligenceItemId, actionItem.suggestedIndex, actionItem.taskId]).toEqual([ITEM, 0, task.id])
    expect(result.taskId).toBe(task.id as string)
    expect(engineCalls).toEqual([{ taskId: task.id as string, title: TASK_SUGGESTION.title }])
    expect(rowsOf(store, "audit_logs").map((a) => a.action)).toEqual(["email_intelligence.promoted"])
  })

  test('a "boq_line_item" entry without a usable line is read as sanitizeSuggestedWorkItems reads it, and promotes to a task', async () => {
    const noUnit = { ...BOQ_SUGGESTION, boqLineItem: { ...BOQ_SUGGESTION.boqLineItem, unit: "" } }
    expect(service.sanitizeEmailSuggestedWorkItems([noUnit])).toEqual(service.sanitizeSuggestedWorkItems([noUnit]))
    expect(service.sanitizeEmailSuggestedWorkItems([noUnit])[0].category).toBe("follow_up")

    store = fixtures([noUnit])
    await service.promoteEmailIntelligenceItem(ctx(), ITEM, { suggestedIndex: 0 })
    expect(tableCounts()).toMatchObject({ submissions: 0, tasks: 1, construction_boq_line_items: 0 })
  })

  test("the email reading keeps a usable BOQ line; the shared sanitizer (ticket-intelligence-service.ts) is unchanged", () => {
    const raw = [TASK_SUGGESTION, { ...BOQ_SUGGESTION, quantity: undefined }, { title: "" }, { ...BOQ_SUGGESTION, boqLineItem: { ...BOQ_SUGGESTION.boqLineItem, quantity: "120" } }]
    const email = service.sanitizeEmailSuggestedWorkItems(raw)
    const shared = service.sanitizeSuggestedWorkItems(raw)
    // Same entries in the same order, so a suggestedIndex means the same entry in both.
    expect(email.map((e) => e.title)).toEqual(shared.map((e) => e.title))
    expect(email.map((e) => e.category)).toEqual(["commitment", "boq_line_item", "boq_line_item"])
    expect(shared.map((e) => e.category)).toEqual(["commitment", "follow_up", "follow_up"])
    expect(shared.every((e) => !("boqLineItem" in e))).toBe(true)
    expect((email[2] as { boqLineItem: { quantity: number } }).boqLineItem.quantity).toBe(120)
  })
})
