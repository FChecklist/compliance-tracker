/// <reference types="bun-types" />
// Audit 100 A4 follow-ups (2026-10-05), found live by scripts/verify/awl-live/internal-ai-chat.live.test.ts (#2076):
//
// (1) THE MODEL WAS GIVEN ONLY FUNCTION NAMES. Level 1 saw `candidateFunctions` (ids) and nothing about their fields, so Claude Code
//     guessed: it put a schedule task's name under `name` instead of `title`, listed the optional finish date as missing, and scored
//     itself 0.6. runLevel1 now puts each candidate's parameter names from the registry in the classify context (functionParams).
// (2) A BELOW-THE-FLOOR ANSWER WAS TOLD A LIE. A 0.6 answer naming a real function fell through to dry-run.ts's gapAnswer(), which
//     said "That is not enabled for this workspace yet". It now says NOT_SURE_SENTENCE, with no screen link.
//
// WHAT IS REAL: the tasks route (typed verdict), the acting-person lookup, submitForVerdict, the dry run, Level 0, runLevel1 and its
// re-validation, the provider gate, the registry. WHAT IS FAKED: the database, the users lookup, the auth entry points, and the
// claude-cli provider, which records the context it was handed and answers what each test programs.
//
// Falsifiability (R74-RULING-03 (c)), seen 2026-10-05: with `functionParams: functionParamsFor(...)` removed from level1.ts the first
// test fails (context.functionParams undefined); with the isBelowConfidenceFloorReason() branch removed from gapAnswer() the second
// fails (message "That is not enabled for this workspace yet - Open Home").
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
mock.module("@/lib/ai/internal-ai-org-allowance", () => ({ INTERNAL_AI_BRANCH_KEY: "internal_ai", isInternalAiAllowedForOrg: async () => true, isInternalAiAllowedForOrgWithDb: async () => true }))
;
const savedInternalAiFlag = process.env.PROJEXA_INTERNAL_AI_ENABLED;
beforeAll(() => { process.env.PROJEXA_INTERNAL_AI_ENABLED = "1" });
afterAll(() => { if (savedInternalAiFlag === undefined) delete process.env.PROJEXA_INTERNAL_AI_ENABLED; else process.env.PROJEXA_INTERNAL_AI_ENABLED = savedInternalAiFlag });
import {
  aiEnvSnapshot,
  fakeWithTenantContext,
  jsonPost,
  makePipelineStore,
  rowsIn,
  usersLookupDouble,
  type PersonRow,
  type PipelineStore,
} from "@/lib/pipeline/__test-helpers__/pipeline-store-double";

const ORG = "org_a4_l1";
const PROJECT = "proj_cedar";
const OWNER: PersonRow = { id: "user_owner", orgId: ORG, email: "owner@example.test", authUserId: null, role: "admin", isActive: true, name: "Rajat" };
const SENTENCE = "jot a job onto the programme: pour the roof slab starting 2026-10-20";

type Answer = { functionId: string | null; params: Record<string, unknown>; missingParams: string[]; confidence: number; unmappedIntent: string | null };
let store: PipelineStore;
let answer: Answer;
const seen: { candidates: string[]; context: Record<string, any> }[] = [];
const KEY_AUTH = { orgId: ORG, dbUser: null, apiKey: { id: "key_org", name: "PROJEXA (provisioned)", scopes: ["read", "write"] }, response: null };

const realDb = await import("@/lib/db");
const realTenantScoped = await import("@/lib/db/tenant-scoped");
const realAuthGuard = await import("@/lib/supabase/auth-guard");
const realClaudeCli = await import("@/lib/ai/providers/claude-cli");

mock.module("@/lib/db", () => ({ ...realDb, db: { query: { users: { findFirst: mock(usersLookupDouble(() => [OWNER])) } } } }));
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(fakeWithTenantContext(() => store)) }));
mock.module("@/lib/supabase/auth-guard", () => ({ ...realAuthGuard, requireAuthOrApiKey: mock(async () => KEY_AUTH), requireRoleOrScope: mock(() => null) }));
mock.module("@/lib/ai/providers/claude-cli", () => ({
  ...realClaudeCli,
  claudeCliProvider: {
    classify: async (segments: string[], candidates: string[], context: Record<string, any>) => {
      seen.push({ candidates, context });
      return segments.map(() => ({ ...answer }));
    },
    analyse: async () => [],
  },
}));

const env = aiEnvSnapshot();
let silenced: Array<{ mockRestore: () => void }> = [];
beforeEach(() => {
  store = makePipelineStore();
  store.projects.set(PROJECT, { id: PROJECT, name: "Cedar Heights Villa" });
  seen.length = 0;
  env.clear();
  process.env.AI_PROVIDER_PIPELINE_L1 = "claude-cli";
  process.env.RAJAT_USER_ID = OWNER.id;
  silenced = [spyOn(console, "error").mockImplementation(() => {}), spyOn(console, "warn").mockImplementation(() => {}), spyOn(console, "info").mockImplementation(() => {})];
});
afterEach(() => {
  for (const s of silenced) s.mockRestore();
  env.restore();
});
afterAll(async () => {
  mock.restore();
  await mock.module("@/lib/ai/providers/claude-cli", () => realClaudeCli);
  await mock.module("@/lib/supabase/auth-guard", () => realAuthGuard);
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped);
  await mock.module("@/lib/db", () => realDb);
});

let POST: (req: Request) => Promise<Response>;
beforeAll(async () => {
  ({ POST } = (await import("./route")) as unknown as { POST: typeof POST });
});

async function typed() {
  const res = await POST(jsonPost("https://x/api/v1/projexa/tasks", { rawInput: SENTENCE, projectId: PROJECT, actorEmail: OWNER.email }));
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const { NOT_SURE_SENTENCE } = await import("@/lib/pipeline/level1");

describe("Audit 100 A4 -- Level 1 is told each candidate's field names", () => {
  test("the classify context carries create_schedule_task's real names; a 0.9 answer using them is ready to confirm", async () => {
    answer = { functionId: "create_schedule_task", params: { title: "Pour the roof slab", startDate: "2026-10-20" }, missingParams: [], confidence: 0.9, unmappedIntent: null };
    const { status, body } = await typed();

    expect(seen).toHaveLength(1);
    expect(seen[0].candidates).toContain("create_schedule_task");
    const params = seen[0].context.functionParams?.create_schedule_task;
    expect(params).toBeDefined();
    expect(params.required).toEqual(["title", "startDate"]);
    expect(params.optional).toContain("dueDate");
    expect(params.optional).not.toContain("name");
    expect(params.required).not.toContain("projectId");
    // Every candidate is described, nothing outside the candidate set is.
    expect(Object.keys(seen[0].context.functionParams).every((id) => seen[0].candidates.includes(id))).toBe(true);

    expect(status).toBe(200);
    expect(body.verdicts[0]).toMatchObject({ status: "ready", confirmable: true, understood: { functionId: "create_schedule_task" } });
  });
});

describe("Audit 100 A4 -- a below-the-floor answer is told the truth, not 'not enabled'", () => {
  test("0.6 on a real function: the plain not-sure sentence, no screen link, nothing confirmable or written", async () => {
    answer = { functionId: "create_schedule_task", params: { name: "Pour the roof slab" }, missingParams: ["dueDate"], confidence: 0.6, unmappedIntent: null };
    const { status, body } = await typed();

    expect(status).toBe(200);
    expect(body.verdicts[0]).toMatchObject({ status: "gap", confirmable: false, message: NOT_SURE_SENTENCE });
    expect(body.verdicts[0].message).not.toContain("not enabled");
    expect(body.verdicts[0].links).toBeUndefined();
    expect(NOT_SURE_SENTENCE).toBe("I was not sure what you meant: please say it again with the name and the date");
    expect(rowsIn(store, "pipeline_tasks")).toHaveLength(0);
  });

  test("control: a model that maps nothing still gets the old destination answer", async () => {
    answer = { functionId: null, params: {}, missingParams: [], confidence: 0, unmappedIntent: "nothing fits" };
    const { body } = await typed();
    expect(body.verdicts[0]).toMatchObject({ status: "gap", message: "That is not enabled for this workspace yet - Open Home" });
  });
});
