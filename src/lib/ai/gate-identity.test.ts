/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-49 -- register row BR-219 (restated for Phase 3 as
// BR-304): the Level 1 provider gate compares the ACTING PERSON, never the org
// API key.
//
// THE DEFECT (GATE_2_8_FINDINGS, F-A06-2). assertAiProviderAllowed() refuses
// every identity but RAJAT_USER_ID when Level 1 resolves to claude-cli or
// claude-cli-remote (one individual's subscription). The PROJEXA proxy calls
// with one API key per org, and the routes handed the pipeline
// `ctx.dbUser?.id ?? ctx.apiKey!.id` -- the KEY's id -- as the identity. So
// the owner could never pass through PROJEXA, and a RAJAT_USER_ID equal to
// that key id would have let every person of the org through. Each route now
// resolves the person (acting-role.ts resolvePipelineActor, the lookup the
// construction money redaction already makes) and the pipeline hands only
// that person's compliance.users id to the gate.
//
// WHAT IS REAL: the assistant, submissions, tasks and classify route handlers,
// resolvePipelineActor and resolveActingUser, runSubmission, submitForVerdict,
// classifyOnly, the Level 0 tiers, the reuse and fuzzy tiers, runLevel1 and
// assertAiProviderAllowed. WHAT IS FAKED (see
// src/lib/pipeline/__test-helpers__/pipeline-store-double.ts): the database
// (tenant transactions, and the raw users lookup), the two auth entry points,
// and the claude-cli provider -- a classify() that counts its calls and maps
// nothing, so "the gate let it through" is exactly one model call.
//
// The assertions re-read the persisted compliance.submissions row from the fake
// store (level1_outcome, level1_refusal_code, model_calls). /classify writes no
// submissions row, so for it the response body is what is read.
//
// Falsifiability (R74-RULING-03 (c)): with the pipeline's gate identity put
// back to the key id (run-submission.ts level1Context personId: input.userId,
// dry-run.ts and classify-only.ts likewise), the RAJAT_USER_ID-equals-key-id
// cases fail on every surface -- see the U-49 report for the recorded run.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
  aiEnvSnapshot,
  fakeWithTenantContext,
  jsonPost,
  makePipelineStore,
  mapsNothingProvider,
  rowsIn,
  usersLookupDouble,
  type ClassifyCall,
  type PersonRow,
  type PipelineStore,
} from "@/lib/pipeline/__test-helpers__/pipeline-store-double";

const ORG = "org_u49";
const KEY_ID = "key_projexa_org";
const OWNER: PersonRow = { id: "user_owner", orgId: ORG, email: "owner@example.test", authUserId: "projexa-owner", role: "admin", isActive: true, name: "Rajat" };
const MEMBER: PersonRow = { id: "user_member", orgId: ORG, email: "member@example.test", authUserId: "projexa-member", role: "member", isActive: true, name: "Arjun" };
// No Level 0 tier recognises it, so every request below reaches the gate.
const MISS = "arrange the site handover paperwork";

let store: PipelineStore;
let authCtx: { dbUser: PersonRow | null; apiKey: { id: string; name: string; scopes: string[] } | null };
const classifyCalls: ClassifyCall[] = [];

const KEY_CTX = { dbUser: null, apiKey: { id: KEY_ID, name: "PROJEXA (provisioned)", scopes: ["read", "write"] } };

const realDb = await import("@/lib/db");
const realTenantScoped = await import("@/lib/db/tenant-scoped");
const realAuthGuard = await import("@/lib/supabase/auth-guard");
const realClaudeCli = await import("@/lib/ai/providers/claude-cli");

mock.module("@/lib/db", () => ({
  ...realDb,
  db: { query: { users: { findFirst: mock(usersLookupDouble(() => [OWNER, MEMBER])) } } },
}));
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(fakeWithTenantContext(() => store)) }));
mock.module("@/lib/supabase/auth-guard", () => ({
  ...realAuthGuard,
  requireAuthOrApiKey: mock(async () => ({ orgId: ORG, response: null, ...authCtx })),
  requireRoleOrScope: mock(() => null),
}));
mock.module("@/lib/ai/providers/claude-cli", () => ({ ...realClaudeCli, claudeCliProvider: mapsNothingProvider(classifyCalls) }));

const env = aiEnvSnapshot();
let silenced: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
  store = makePipelineStore();
  classifyCalls.length = 0;
  env.clear();
  process.env.AI_PROVIDER_PIPELINE_L1 = "claude-cli";
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
  await mock.module("@/lib/ai/providers/claude-cli", () => realClaudeCli);
  await mock.module("@/lib/supabase/auth-guard", () => realAuthGuard);
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped);
  await mock.module("@/lib/db", () => realDb);
});

type Handler = (req: Request) => Promise<Response>;
const handlers: Record<"assistant" | "submissions" | "tasks" | "classify", Handler> = {} as never;
beforeAll(async () => {
  handlers.assistant = ((await import("@/app/api/v1/projexa/assistant/route")) as unknown as { POST: Handler }).POST;
  handlers.submissions = ((await import("@/app/api/v1/projexa/submissions/route")) as unknown as { POST: Handler }).POST;
  handlers.tasks = ((await import("@/app/api/v1/projexa/tasks/route")) as unknown as { POST: Handler }).POST;
  handlers.classify = ((await import("@/app/api/v1/projexa/classify/route")) as unknown as { POST: Handler }).POST;
});

type Telemetry = { level1Outcome: unknown; level1RefusalCode: unknown; modelCalls: unknown };

/**
 * Each surface a typed message reaches Level 1 through. `reread` is what the
 * surface PERSISTED: the one submissions row it wrote, re-read from the store.
 * /classify persists no such row, so its telemetry is read from its response.
 */
const SURFACES: Array<{
  name: string;
  send: (body: Record<string, unknown>, headers?: Record<string, string>) => Promise<Response>;
  reread: (response: Record<string, unknown>) => Telemetry & { userId?: unknown };
}> = [
  {
    name: "POST /api/v1/projexa/assistant {rawInput}",
    send: (body, headers) => handlers.assistant(jsonPost("https://x/api/v1/projexa/assistant", body, headers)),
    reread: () => onlySubmissionRow(),
  },
  {
    name: "POST /api/v1/projexa/submissions",
    send: (body, headers) => handlers.submissions(jsonPost("https://x/api/v1/projexa/submissions", body, headers)),
    reread: () => onlySubmissionRow(),
  },
  {
    name: "POST /api/v1/projexa/tasks {execute:true}",
    send: (body, headers) => handlers.tasks(jsonPost("https://x/api/v1/projexa/tasks", { ...body, execute: true }, headers)),
    reread: () => onlySubmissionRow(),
  },
  {
    name: "POST /api/v1/projexa/tasks (the typed verdict)",
    send: (body, headers) => handlers.tasks(jsonPost("https://x/api/v1/projexa/tasks", body, headers)),
    reread: () => onlySubmissionRow(),
  },
  {
    name: "POST /api/v1/projexa/classify",
    send: (body, headers) => handlers.classify(jsonPost("https://x/api/v1/projexa/classify", body, headers)),
    reread: (response) => {
      expect(rowsIn(store, "submissions")).toHaveLength(0);
      return { level1Outcome: response.level1Outcome, level1RefusalCode: response.level1RefusalCode, modelCalls: response.modelCalls };
    },
  },
];

function onlySubmissionRow() {
  const rows = rowsIn(store, "submissions");
  expect(rows).toHaveLength(1);
  return rows[0] as unknown as Telemetry & { userId: unknown };
}

async function run(surface: (typeof SURFACES)[number], body: Record<string, unknown>, headers?: Record<string, string>) {
  const res = await surface.send(body, headers);
  const json = (await res.json()) as Record<string, unknown>;
  // A gate refusal is never an error on any of these surfaces (BR-221).
  expect(res.status).not.toBe(400);
  expect(json.error).toBeUndefined();
  return { status: res.status, telemetry: surface.reread(json) };
}

describe("BR-219 -- RAJAT_USER_ID equal to the org key id does NOT let a non-owner through", () => {
  for (const surface of SURFACES) {
    test(`${surface.name}: key names a non-owner person -> refused / provider_not_allowed, no model call`, async () => {
      process.env.RAJAT_USER_ID = KEY_ID;
      authCtx = KEY_CTX;

      const { telemetry } = await run(surface, { rawInput: MISS }, { "x-acting-user-email": MEMBER.email });

      expect(telemetry.level1Outcome).toBe("refused");
      expect(telemetry.level1RefusalCode).toBe("provider_not_allowed");
      expect(telemetry.modelCalls).toBe(0);
      expect(classifyCalls).toHaveLength(0);
      // Only the gate's identity changed: the row is still keyed by the caller's userId, the key.
      if (telemetry.userId !== undefined) expect(telemetry.userId).toBe(KEY_ID);
    });
  }
});

describe("BR-219 -- the owner, named by the org key, IS let through", () => {
  for (const surface of SURFACES) {
    test(`${surface.name}: key names the owner (X-Acting-User) -> resolved, one model call`, async () => {
      process.env.RAJAT_USER_ID = OWNER.id;
      authCtx = KEY_CTX;

      const { telemetry } = await run(surface, { rawInput: MISS }, { "x-acting-user": OWNER.authUserId! });

      expect(telemetry.level1Outcome).toBe("resolved");
      expect(telemetry.level1RefusalCode).toBeNull();
      expect(telemetry.modelCalls).toBe(1);
      expect(classifyCalls).toHaveLength(1);
      expect(classifyCalls[0].segments).toEqual([MISS]);
    });
  }

  test("the owner named by a body actorEmail (what PROJEXA's composer sends) is let through too", async () => {
    process.env.RAJAT_USER_ID = OWNER.id;
    authCtx = KEY_CTX;

    const { telemetry } = await run(SURFACES[0], { rawInput: MISS, actorEmail: OWNER.email });

    expect(telemetry.level1Outcome).toBe("resolved");
    expect(classifyCalls).toHaveLength(1);
  });
});

describe("BR-219 -- a key call with no resolvable person fails closed, with its own code", () => {
  for (const surface of SURFACES) {
    test(`${surface.name}: key names nobody -> refused / user_not_permitted, even with RAJAT_USER_ID = the key id`, async () => {
      process.env.RAJAT_USER_ID = KEY_ID;
      authCtx = KEY_CTX;

      const { telemetry } = await run(surface, { rawInput: MISS });

      expect(telemetry.level1Outcome).toBe("refused");
      expect(telemetry.level1RefusalCode).toBe("user_not_permitted");
      expect(classifyCalls).toHaveLength(0);
    });

    test(`${surface.name}: key names an email with no VERIDIAN user -> refused / user_not_permitted, the request still answered`, async () => {
      process.env.RAJAT_USER_ID = OWNER.id;
      authCtx = KEY_CTX;

      const { telemetry } = await run(surface, { rawInput: MISS }, { "x-acting-user-email": "nobody@example.test" });

      expect(telemetry.level1Outcome).toBe("refused");
      expect(telemetry.level1RefusalCode).toBe("user_not_permitted");
      expect(classifyCalls).toHaveLength(0);
    });
  }
});

describe("BR-219 -- a signed-in session user is unchanged", () => {
  for (const surface of SURFACES) {
    test(`${surface.name}: the owner's own session -> resolved; a non-owner's session -> refused / provider_not_allowed`, async () => {
      process.env.RAJAT_USER_ID = OWNER.id;

      authCtx = { dbUser: OWNER, apiKey: null };
      const owner = await run(surface, { rawInput: MISS });
      expect(owner.telemetry.level1Outcome).toBe("resolved");
      expect(classifyCalls).toHaveLength(1);

      store = makePipelineStore();
      authCtx = { dbUser: MEMBER, apiKey: null };
      const member = await run(surface, { rawInput: MISS });
      expect(member.telemetry.level1Outcome).toBe("refused");
      expect(member.telemetry.level1RefusalCode).toBe("provider_not_allowed");
      expect(classifyCalls).toHaveLength(1);
    });
  }
});
