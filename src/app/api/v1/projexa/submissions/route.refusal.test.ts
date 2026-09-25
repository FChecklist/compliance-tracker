/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-49 -- register row BR-221, the submissions route: a Level
// 1 refusal answers HTTP 200 with the records attached, not HTTP 400 with the
// bare sentence.
//
// Same defect and same fix as the assistant route (see its route.refusal.test.ts
// header): the refusal thrown inside runLevel1() used to escape runSubmission()
// and reach this route's catch as HTTP 400 {error: NO_COMMENTARY_SENTENCE}, with
// nothing that Level 0 had already resolved attached. The pipeline now turns it
// into "nothing resolved" for the texts that needed the model, the rest runs,
// and this route answers 200 with the full result and the sentence last in
// chatMessages. Bad input, unauthorised and a faulted read keep their codes.
//
// WHAT IS REAL / FAKED: as the assistant's refusal test -- the route, the
// acting-person lookup, runSubmission, Level 0, the executor, runLevel1 and the
// gate are real; the database, the users lookup, the auth entry points, the
// claude-cli provider and the dashboard read are faked.
//
// Falsifiability (R74-RULING-03 (c)): with level1RunnerFor returning the bare
// runLevel1 again, the refusal cases fail with 400 -- see the U-49 report.
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

const ORG = "org_u49_s";
const PROJECT = "proj_cedar";
const OWNER: PersonRow = { id: "user_owner", orgId: ORG, email: "owner@example.test", authUserId: null, role: "admin", isActive: true, name: "Rajat" };
const MEMBER: PersonRow = { id: "user_member", orgId: ORG, email: "member@example.test", authUserId: null, role: "member", isActive: true, name: "Arjun" };
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
const realClaudeCliRemote = await import("@/lib/ai/providers/claude-cli-remote");
const realDashboard = await import("@/lib/services/construction-dashboard-service");

mock.module("@/lib/db", () => ({ ...realDb, db: { query: { users: { findFirst: mock(usersLookupDouble(() => [OWNER, MEMBER])) } } } }));
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(fakeWithTenantContext(() => store)) }));
mock.module("@/lib/supabase/auth-guard", () => ({
  ...realAuthGuard,
  requireAuthOrApiKey: mock(async () => auth),
  requireRoleOrScope: mock(() => null),
}));
// Level 1 runs on claude-cli-remote in this file: the stand-in means no tunnel is ever contacted.
mock.module("@/lib/ai/providers/claude-cli-remote", () => ({ ...realClaudeCliRemote, claudeCliRemoteProvider: mapsNothingProvider(classifyCalls) }));
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
  process.env.AI_PROVIDER_PIPELINE_L1 = "claude-cli-remote";
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
  await mock.module("@/lib/ai/providers/claude-cli-remote", () => realClaudeCliRemote);
  await mock.module("@/lib/supabase/auth-guard", () => realAuthGuard);
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped);
  await mock.module("@/lib/db", () => realDb);
});

let POST: (req: Request) => Promise<Response>;
beforeAll(async () => {
  ({ POST } = (await import("./route")) as unknown as { POST: typeof POST });
});

async function submit(body: Record<string, unknown>, headers: Record<string, string> = { "x-acting-user-email": MEMBER.email }) {
  const res = await POST(jsonPost("https://x/api/v1/projexa/submissions", body, headers));
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe("BR-221 -- submissions: a Level 1 refusal is HTTP 200 with the records", () => {
  // claude-cli-remote: the owner's subscription tunnelled from the laptop. The
  // gate treats it exactly like claude-cli, so the refusal is the same.
  test("the resolved line's records come back beside the gap, with the sentence -- not a 400", async () => {
    const { status, body } = await submit({ rawInput: `${HIT}\n${MISS}`, projectId: PROJECT });

    expect(status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.level1Outcome).toBe("refused");
    expect(body.status).toBe("partial");
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0]).toMatchObject({ functionId: "get_construction_project_dashboard", status: "done", segmentText: HIT });
    expect(body.tasks[0].result).toMatchObject({ projectName: "Cedar Heights Villa", progressPercent: 41 });
    expect(body.gaps.map((g: { text: string }) => g.text)).toEqual([MISS]);
    expect(body.chatMessages.at(-1)).toBe(NO_COMMENTARY_SENTENCE);
    expect(classifyCalls).toHaveLength(0);

    const tasks = rowsIn(store, "pipeline_tasks");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe("done");
    expect(rowsIn(store, "submissions")[0]).toMatchObject({ id: body.submissionId, status: "partial", level1Outcome: "refused" });
  });

  test("a message nothing but the model could answer: still 200, the gap and the sentence", async () => {
    const { status, body } = await submit({ rawInput: MISS, projectId: PROJECT });

    expect(status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.tasks).toEqual([]);
    expect(body.gaps).toEqual([expect.objectContaining({ text: MISS })]);
    expect(body.chatMessages.at(-1)).toBe(NO_COMMENTARY_SENTENCE);
  });

  test("control: the owner is not refused -- 201, and no apology in the reply", async () => {
    const { status, body } = await submit({ rawInput: `${HIT}\n${MISS}`, projectId: PROJECT }, { "x-acting-user-email": OWNER.email });

    expect(status).toBe(201);
    expect(body.level1Outcome).toBe("resolved");
    expect(body.chatMessages).not.toContain(NO_COMMENTARY_SENTENCE);
    expect(classifyCalls).toHaveLength(1);
  });
});

describe("BR-221 -- submissions: genuine errors keep their status codes", () => {
  test("an empty rawInput stays 400 with its own message", async () => {
    const { status, body } = await submit({ rawInput: "   " });
    expect(status).toBe(400);
    expect(body.error).toBe("rawInput is required and must be a non-empty string");
  });

  test("unauthorised stays 401", async () => {
    auth = { orgId: null, dbUser: null, apiKey: null, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
    const { status } = await submit({ rawInput: `${HIT}\n${MISS}` });
    expect(status).toBe(401);
  });

  test("a faulted read in the Level 1 lane stays 400 with its own message, not the sentence", async () => {
    store.failReads.add("reuseCache");
    const { status, body } = await submit({ rawInput: `${HIT}\n${MISS}`, projectId: PROJECT });
    expect(status).toBe(400);
    expect(body.error).toBe("reuseCache read failed");
  });
});
