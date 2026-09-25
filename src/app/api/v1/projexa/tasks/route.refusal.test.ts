/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-49 -- register row BR-221, the tasks route: a Level 1
// refusal answers HTTP 200 with the records attached, not HTTP 400 with the
// bare sentence.
//
// THE BRANCH THAT WAS BROKEN is {rawInput, execute:true}: it calls
// runSubmission(), whose gate refusal used to escape to this route's catch as
// HTTP 400 {error: NO_COMMENTARY_SENTENCE} with nothing Level 0 had resolved
// attached. It now answers 200 with the full result -- the resolved line run
// and its result, the rest as gaps -- and the sentence last in chatMessages.
//
// The typed verdict (no flags) and {dryRun:true} branches already answered a
// refusal with 200 (dry-run.ts, R67 B-05); they are pinned here too, with the
// records they carry (an answered read's rows, beside the sentence). U-49 also
// changed how they reach the gate: a refusal no longer throws out of the lane,
// so a reuse-cache or fuzzy answer is kept rather than discarded with it.
// Bad input, unauthorised and a faulted read keep their codes.
//
// WHAT IS REAL: the route, the acting-person lookup, runSubmission,
// submitForVerdict, proposeSubmission, dryRunSubmission, Level 0, validate(),
// the executor, runLevel1 and the gate. WHAT IS FAKED: the database, the users
// lookup, the auth entry points, the claude-cli provider (counts calls, maps
// nothing) and the dashboard read (src/lib/pipeline/__test-helpers__/pipeline-store-double.ts).
//
// Falsifiability (R74-RULING-03 (c)): with level1RunnerFor returning the bare
// runLevel1 again, the execute:true refusal cases fail with 400 -- see the U-49 report.
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

const ORG = "org_u49_k";
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

// PROJEXA's composer names the person with a body actorEmail on this route.
async function post(body: Record<string, unknown>, person: PersonRow | null = MEMBER) {
  const res = await POST(jsonPost("https://x/api/v1/projexa/tasks", person ? { ...body, actorEmail: person.email } : body));
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

const TWO_LINES = { rawInput: `${HIT}\n${MISS}`, projectId: PROJECT };

describe("BR-221 -- tasks {execute:true}: a Level 1 refusal is HTTP 200 with the records", () => {
  test("the resolved line ran and its result is attached beside the gap, with the sentence -- not a 400", async () => {
    const { status, body } = await post({ ...TWO_LINES, execute: true });

    expect(status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.level1Outcome).toBe("refused");
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0]).toMatchObject({ functionId: "get_construction_project_dashboard", status: "done", segmentText: HIT });
    expect(body.tasks[0].result).toMatchObject({ projectName: "Cedar Heights Villa", progressPercent: 41 });
    expect(body.gaps.map((g: { text: string }) => g.text)).toEqual([MISS]);
    expect(body.chatMessages.at(-1)).toBe(NO_COMMENTARY_SENTENCE);
    expect(classifyCalls).toHaveLength(0);

    const tasks = rowsIn(store, "pipeline_tasks");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe("done");
    expect(rowsIn(store, "submissions")[0]).toMatchObject({ id: body.submissionId, level1Outcome: "refused", level1RefusalCode: "provider_not_allowed" });
  });

  test("a key naming nobody: still 200, the gap and the sentence", async () => {
    const { status, body } = await post({ rawInput: MISS, projectId: PROJECT, execute: true }, null);

    expect(status).toBe(200);
    expect(body.tasks).toEqual([]);
    expect(body.gaps).toEqual([expect.objectContaining({ text: MISS })]);
    expect(body.chatMessages.at(-1)).toBe(NO_COMMENTARY_SENTENCE);
    expect(rowsIn(store, "submissions")[0]).toMatchObject({ level1Outcome: "refused", level1RefusalCode: "user_not_permitted" });
  });

  test("control: the owner is not refused -- 201, and no apology in the reply", async () => {
    const { status, body } = await post({ ...TWO_LINES, execute: true }, OWNER);

    expect(status).toBe(201);
    expect(body.level1Outcome).toBe("resolved");
    expect(body.chatMessages).not.toContain(NO_COMMENTARY_SENTENCE);
    expect(classifyCalls).toHaveLength(1);
  });
});

describe("BR-221 -- tasks, the typed verdict and dryRun: a refusal is 200 with the rows the read returned", () => {
  test("typed verdict: the answered read carries its rows AND the sentence; the miss is a gap with a destination", async () => {
    const { status, body } = await post(TWO_LINES);

    expect(status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.verdicts).toHaveLength(2);
    expect(body.verdicts[0]).toMatchObject({ status: "answered", understood: { functionId: "get_construction_project_dashboard" } });
    expect(body.verdicts[0].answer.rows).toMatchObject({ projectName: "Cedar Heights Villa", progressPercent: 41 });
    expect(body.verdicts[0].answer.text).toBe(NO_COMMENTARY_SENTENCE);
    expect(body.verdicts[1]).toMatchObject({ status: "gap", verdict: "gap" });
    expect(body.verdicts[1].links.length).toBeGreaterThan(0);
    // A verdict mints no task; its row records the refusal.
    expect(rowsIn(store, "pipeline_tasks")).toHaveLength(0);
    expect(rowsIn(store, "submissions")[0]).toMatchObject({ id: body.submissionId, level1Outcome: "refused", level1RefusalCode: "provider_not_allowed" });
  });

  test("dryRun: the same records and the same sentence, nothing written", async () => {
    const { status, body } = await post({ ...TWO_LINES, dryRun: true });

    expect(status).toBe(200);
    expect(body.proposals).toHaveLength(2);
    expect(body.proposals[0].status).toBe("answered");
    expect(body.proposals[0].answer.rows).toMatchObject({ progressPercent: 41 });
    expect(body.proposals[0].answer.text).toBe(NO_COMMENTARY_SENTENCE);
    expect(body.proposals[1].status).toBe("gap");
    expect(body.telemetry.level1Outcome).toBe("refused");
    expect(store.committed).toHaveLength(0);
  });
});

describe("BR-221 -- tasks: genuine errors keep their status codes", () => {
  test("neither functionId nor rawInput stays 400", async () => {
    const { status, body } = await post({ projectId: PROJECT });
    expect(status).toBe(400);
    expect(body.error).toBe("Provide either functionId (the pill path) or rawInput (the typed path)");
  });

  test("dryRun without rawInput, and confirm without submissionId, stay 400", async () => {
    expect((await post({ dryRun: true })).status).toBe(400);
    expect((await post({ confirm: true })).status).toBe(400);
  });

  test("unauthorised stays 401", async () => {
    auth = { orgId: null, dbUser: null, apiKey: null, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
    expect((await post({ ...TWO_LINES, execute: true })).status).toBe(401);
  });

  test("a faulted read in the Level 1 lane on execute:true stays 400 with its own message, not the sentence", async () => {
    store.failReads.add("reuseCache");
    const { status, body } = await post({ ...TWO_LINES, execute: true });
    expect(status).toBe(400);
    expect(body.error).toBe("reuseCache read failed");
  });
});
