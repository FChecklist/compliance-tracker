/// <reference types="bun-types" />
// Audit 37 point 12 (proof test #1, ai-os/audit37/C_internal_ai.md): the internal AI acts per the
// asking person's ROLE, proven through the real assistant route handler.
//
// A member asking for the project's figures gets the answer with every money field redacted
// (null) -- both in the HTTP reply AND in the persisted pipeline_tasks row (re-read from the
// store, R74-RULING-03 (e)). A manager asking the same thing gets the figures. A caller with no
// resolvable acting person (org API key alone) is treated as not-manager: figures redacted.
//
// WHAT IS REAL: the route, resolvePipelineActor/resolveActingUser, runSubmission, Level 0, the
// executor and its financialsAllowedForRole() redaction. WHAT IS FAKED: the database and users
// lookup (pipeline-store-double), the two auth entry points, the Level 1 provider and the
// construction dashboard read (returns a real-looking budget).
//
// Falsifiability (R74-RULING-03 (c)): make financialsAllowedForRole() return true for every role
// (construction-tools.ts) and the member / no-actor cases below fail on the non-null budget.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
const savedInternalAiFlag = process.env.PROJEXA_INTERNAL_AI_ENABLED;
beforeAll(() => { process.env.PROJEXA_INTERNAL_AI_ENABLED = "1" });
afterAll(() => { if (savedInternalAiFlag === undefined) delete process.env.PROJEXA_INTERNAL_AI_ENABLED; else process.env.PROJEXA_INTERNAL_AI_ENABLED = savedInternalAiFlag });
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

const ORG = "org_a37_roles";
const PROJECT = "proj_cedar";
const OWNER: PersonRow = { id: "user_owner", orgId: ORG, email: "owner@example.test", authUserId: null, role: "admin", isActive: true, name: "Rajat" };
const MANAGER: PersonRow = { id: "user_manager", orgId: ORG, email: "manager@example.test", authUserId: null, role: "manager", isActive: true, name: "Meera" };
const MEMBER: PersonRow = { id: "user_member", orgId: ORG, email: "member@example.test", authUserId: null, role: "member", isActive: true, name: "Arjun" };
const BUDGET_PHRASE = "show project budget";
const DASHBOARD = { projectId: PROJECT, projectName: "Cedar Heights Villa", progressPercent: 41, delayedTaskCount: 2, budget: 4_200_000 };

let store: PipelineStore;
const classifyCalls: ClassifyCall[] = [];
const KEY_AUTH = { orgId: ORG, dbUser: null, apiKey: { id: "key_org", name: "PROJEXA (provisioned)", scopes: ["read", "write"] }, response: null };

const realDb = await import("@/lib/db");
const realTenantScoped = await import("@/lib/db/tenant-scoped");
const realAuthGuard = await import("@/lib/supabase/auth-guard");
const realClaudeCli = await import("@/lib/ai/providers/claude-cli");
const realDashboard = await import("@/lib/services/construction-dashboard-service");

mock.module("@/lib/db", () => ({ ...realDb, db: { query: { users: { findFirst: mock(usersLookupDouble(() => [OWNER, MANAGER, MEMBER])) } } } }));
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(fakeWithTenantContext(() => store)) }));
mock.module("@/lib/supabase/auth-guard", () => ({
  ...realAuthGuard,
  requireAuthOrApiKey: mock(async () => KEY_AUTH),
  requireRoleOrScope: mock(() => null),
}));
// The Level 1 model stand-in: by default maps nothing; a test can make it hostile (an id outside the candidate set).
let hostileFunctionId: string | null = null;
const nothing = mapsNothingProvider(classifyCalls);
const stubProvider = {
  ...nothing,
  classify: async (segments: string[], candidates: string[]) => {
    if (hostileFunctionId === null) return nothing.classify(segments, candidates);
    classifyCalls.push({ segments, candidateFunctionIds: candidates });
    return segments.map(() => ({ functionId: hostileFunctionId, params: { code: "print('hi')" }, missingParams: [], confidence: 0.99 }));
  },
};
const dashboardRead = mock(async () => ({ ...DASHBOARD }));
mock.module("@/lib/ai/providers/claude-cli", () => ({ ...realClaudeCli, claudeCliProvider: stubProvider }));
mock.module("@/lib/services/construction-dashboard-service", () => ({ ...realDashboard, getProjectDashboard: dashboardRead }));

const env = aiEnvSnapshot();
let silenced: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
  store = makePipelineStore();
  store.projects.set(PROJECT, { id: PROJECT, name: "Cedar Heights Villa" });
  promotePhrase(store, BUDGET_PHRASE, "get_construction_project_dashboard");
  classifyCalls.length = 0;
  hostileFunctionId = null;
  dashboardRead.mockClear();
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

async function ask(rawInput: string, headers: Record<string, string>) {
  const res = await POST(jsonPost("https://x/api/v1/projexa/assistant", { rawInput, projectId: PROJECT }, headers));
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe("Audit 37 #12 -- the assistant acts per the asking person's role", () => {
  test("member asks for the project budget: answered, but money is redacted in the reply AND in the persisted row", async () => {
    const { status, body } = await ask(BUDGET_PHRASE, { "x-acting-user-email": MEMBER.email });

    expect(status).toBe(201);
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].result).toMatchObject({ projectName: "Cedar Heights Villa", progressPercent: 41 });
    expect(body.tasks[0].result.budget).toBeNull();
    expect(JSON.stringify(body)).not.toContain("4200000");

    // Re-read what was persisted: no money in the stored result either.
    const persisted = rowsIn(store, "pipeline_tasks");
    expect(persisted).toHaveLength(1);
    expect((persisted[0].result as Record<string, unknown>).budget).toBeNull();
    expect(JSON.stringify(persisted[0])).not.toContain("4200000");
  });

  test("manager asks the same thing: the figures come back and are persisted", async () => {
    const { status, body } = await ask(BUDGET_PHRASE, { "x-acting-user-email": MANAGER.email });

    expect(status).toBe(201);
    expect(body.tasks[0].result.budget).toBe(4_200_000);
    const persisted = rowsIn(store, "pipeline_tasks");
    expect(persisted).toHaveLength(1);
    expect((persisted[0].result as Record<string, unknown>).budget).toBe(4_200_000);
  });

  test("no code: the model answers 'write_code' (outside the candidate set) -> a gap, zero executor runs, nothing persisted as a task", async () => {
    hostileFunctionId = "write_code";
    const { status, body } = await ask("write me a python script to scrape the budget", { "x-acting-user-email": OWNER.email });

    expect(status).toBe(201);
    expect(classifyCalls).toHaveLength(1);
    expect(classifyCalls[0].candidateFunctionIds).not.toContain("write_code");
    expect(body.tasks).toEqual([]);
    expect(body.gaps).toHaveLength(1);
    expect(dashboardRead).not.toHaveBeenCalled();
    expect(rowsIn(store, "pipeline_tasks")).toHaveLength(0);
  });

  test("no acting person named (org key alone): treated as not-manager, money redacted", async () => {
    const { body } = await ask(BUDGET_PHRASE, {});

    for (const t of body.tasks ?? []) expect(t.result?.budget ?? null).toBeNull();
    expect(JSON.stringify(body)).not.toContain("4200000");
    for (const row of rowsIn(store, "pipeline_tasks")) expect(JSON.stringify(row)).not.toContain("4200000");
  });
});
