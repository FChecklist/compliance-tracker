/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-49 -- register row BR-221, the assistant route: a Level 1
// refusal answers HTTP 200 with the records attached, not HTTP 400 with the
// bare sentence.
//
// THE DEFECT (GATE_2_8_FINDINGS, F-A06-4). When the provider gate refused
// (Level 1 on claude-cli / claude-cli-remote, caller not RAJAT_USER_ID), the
// AiProviderRefusalError thrown inside runLevel1() escaped runSubmission() and
// this route's catch turned it into HTTP 400 {error: NO_COMMENTARY_SENTENCE}
// -- "VERI can't add commentary right now - here is what the records say" --
// with no records at all, and threw away whatever Level 0 had already
// resolved in the same message. Now the pipeline turns the refusal into
// "nothing resolved" for the texts that needed the model
// (level1.ts refusalAsUnresolved): the rest still resolves and runs, the
// result carries it, chatMessages ends with the sentence, and this route
// answers 200. Real errors (unauthorised, a faulted read) keep their codes.
//
// WHAT IS REAL: the route, resolvePipelineActor/resolveActingUser,
// runSubmission, the Level 0 tiers, validate(), the executor, runLevel1 and
// the gate. WHAT IS FAKED: the database and the users lookup
// (src/lib/pipeline/__test-helpers__/pipeline-store-double.ts), the two auth
// entry points, the claude-cli provider (counts calls, maps nothing) and the
// construction dashboard read the executor makes.
//
// Falsifiability (R74-RULING-03 (c)): with the pipeline's refusal thrown again
// (run-submission.ts level1RunnerFor returning the bare runLevel1), the refusal
// cases fail with 400 {error: NO_COMMENTARY_SENTENCE} -- see the U-49 report.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { NO_COMMENTARY_SENTENCE } from "@/lib/ai/refusal";
import {
  aiEnvSnapshot,
  fakeWithTenantContext,
  jsonPost,
  makePipelineStore,
  mapsNothingProvider,
  promotePhrase,
  rowsIn,
  usersLookupDouble,
  type ClassifyCall,
  type PersonRow,
  type PipelineStore,
} from "@/lib/pipeline/__test-helpers__/pipeline-store-double";

const ORG = "org_u49_a";
const PROJECT = "proj_cedar";
const OWNER: PersonRow = { id: "user_owner", orgId: ORG, email: "owner@example.test", authUserId: null, role: "admin", isActive: true, name: "Rajat" };
const MEMBER: PersonRow = { id: "user_member", orgId: ORG, email: "member@example.test", authUserId: null, role: "member", isActive: true, name: "Arjun" };
// Level 0 answers the first line (a promoted phrase); nothing answers the second.
const HIT = "how is the project doing";
const MISS = "arrange the site handover paperwork";
const DASHBOARD = { projectId: PROJECT, projectName: "Cedar Heights Villa", progressPercent: 41, delayedTaskCount: 2, budget: 4_200_000 };

let store: PipelineStore;
let auth: Record<string, unknown>;
const classifyCalls: ClassifyCall[] = [];
const KEY_AUTH = { orgId: ORG, dbUser: null, apiKey: { id: "key_org", name: "PROJEXA (provisioned)", scopes: ["read", "write"] }, response: null };

const realDb = await import("@/lib/db");
const realTenantScoped = await import("@/lib/db/tenant-scoped");
const realAuthGuard = await import("@/lib/supabase/auth-guard");
const realClaudeCli = await import("@/lib/ai/providers/claude-cli");
const realDashboard = await import("@/lib/services/construction-dashboard-service");

mock.module("@/lib/db", () => ({ ...realDb, db: { query: { users: { findFirst: mock(usersLookupDouble(() => [OWNER, MEMBER])) } } } }));
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(fakeWithTenantContext(() => store)) }));
mock.module("@/lib/supabase/auth-guard", () => ({
  ...realAuthGuard,
  requireAuthOrApiKey: mock(async () => auth),
  requireRoleOrScope: mock(() => null),
}));
mock.module("@/lib/ai/providers/claude-cli", () => ({ ...realClaudeCli, claudeCliProvider: mapsNothingProvider(classifyCalls) }));
mock.module("@/lib/services/construction-dashboard-service", () => ({ ...realDashboard, getProjectDashboard: mock(async () => ({ ...DASHBOARD })) }));

const env = aiEnvSnapshot();
let silenced: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
  store = makePipelineStore();
  store.projects.set(PROJECT, { id: PROJECT, name: "Cedar Heights Villa" });
  promotePhrase(store, HIT, "get_construction_project_dashboard");
  classifyCalls.length = 0;
  auth = KEY_AUTH;
  env.clear();
  process.env.AI_PROVIDER_PIPELINE_L1 = "claude-cli";
  process.env.RAJAT_USER_ID = OWNER.id;
  silenced = [
    spyOn(console, "error").mockImplementation(() => {}),
    spyOn(console, "warn").mockImplementation(() => {}),
    spyOn(console, "info").mockImplementation(() => {}),
  ];
});

afterEach(() => {
  for (const s of silenced) s.mockRestore();
  env.restore();
});

afterAll(async () => {
  mock.restore();
  await mock.module("@/lib/services/construction-dashboard-service", () => realDashboard);
  await mock.module("@/lib/ai/providers/claude-cli", () => realClaudeCli);
  await mock.module("@/lib/supabase/auth-guard", () => realAuthGuard);
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped);
  await mock.module("@/lib/db", () => realDb);
});

let POST: (req: Request) => Promise<Response>;
beforeAll(async () => {
  ({ POST } = (await import("./route")) as unknown as { POST: typeof POST });
});

async function ask(rawInput: string, headers: Record<string, string> = { "x-acting-user-email": MEMBER.email }) {
  const res = await POST(jsonPost("https://x/api/v1/projexa/assistant", { rawInput, projectId: PROJECT }, headers));
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe("BR-221 -- assistant: a Level 1 refusal is HTTP 200 with the records", () => {
  test("the resolved line's records come back beside the gap, with the sentence -- not a 400", async () => {
    const { status, body } = await ask(`${HIT}\n${MISS}`);

    expect(status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.level1Outcome).toBe("refused");
    // The records: Level 0's line ran for real and its result is attached.
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0]).toMatchObject({ functionId: "get_construction_project_dashboard", status: "done", segmentText: HIT });
    expect(body.tasks[0].result).toMatchObject({ projectName: "Cedar Heights Villa", progressPercent: 41, delayedTaskCount: 2 });
    // A member's figures stay redacted (U-01) on the refusal path too.
    expect(body.tasks[0].result.budget).toBeNull();
    // What needed the model is an honest gap, and the sentence closes the reply.
    expect(body.gaps.map((g: { text: string }) => g.text)).toEqual([MISS]);
    expect(body.chatMessages.at(-1)).toBe(NO_COMMENTARY_SENTENCE);
    expect(body.chatMessages.filter((m: string) => m === NO_COMMENTARY_SENTENCE)).toHaveLength(1);
    expect(classifyCalls).toHaveLength(0);

    // Re-read what was persisted: the task ran and the row records the refusal.
    const tasks = rowsIn(store, "pipeline_tasks");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe("done");
    expect(tasks[0].result).toMatchObject({ progressPercent: 41 });
    expect(rowsIn(store, "submissions")[0]).toMatchObject({ id: body.submissionId, level1Outcome: "refused", level1RefusalCode: "provider_not_allowed" });
  });

  test("a message nothing but the model could answer: still 200, the gap and the sentence, never a bare error", async () => {
    const { status, body } = await ask(MISS, {});

    expect(status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.level1Outcome).toBe("refused");
    expect(body.tasks).toEqual([]);
    expect(body.gaps).toEqual([expect.objectContaining({ text: MISS })]);
    expect(body.chatMessages.at(-1)).toBe(NO_COMMENTARY_SENTENCE);
    expect(rowsIn(store, "submissions")[0]).toMatchObject({ level1Outcome: "refused", level1RefusalCode: "user_not_permitted" });
  });

  test("control: the owner is not refused -- 201, and no apology in the reply", async () => {
    const { status, body } = await ask(`${HIT}\n${MISS}`, { "x-acting-user-email": OWNER.email });

    expect(status).toBe(201);
    expect(body.level1Outcome).toBe("resolved");
    expect(body.chatMessages).not.toContain(NO_COMMENTARY_SENTENCE);
    expect(classifyCalls).toHaveLength(1);
  });
});

describe("BR-221 -- assistant: genuine errors keep their status codes", () => {
  test("unauthorised stays 401", async () => {
    auth = { orgId: null, dbUser: null, apiKey: null, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
    const { status, body } = await ask(`${HIT}\n${MISS}`);
    expect(status).toBe(401);
    expect(body).toEqual({ error: "Unauthorized" });
  });

  test("a faulted read in the Level 1 lane stays 400 with its own message, not the sentence", async () => {
    store.failReads.add("reuseCache");
    const { status, body } = await ask(`${HIT}\n${MISS}`);
    expect(status).toBe(400);
    expect(body.error).toBe("reuseCache read failed");
  });
});
