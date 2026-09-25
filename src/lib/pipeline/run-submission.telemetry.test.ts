/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-49 -- register row BR-220: Level 1 telemetry is non-null
// on re-read for the assistant, submissions, classify, AI-link (MCP) and tasks
// {execute:true} paths.
//
// THE DEFECT (GATE_2_8_FINDINGS, F-A06-3). compliance.submissions has seven
// telemetry columns (drizzle/0571: level, source, l0_hit_rate, model_calls,
// cache_hits, level1_outcome, level1_refusal_code) and only submitForVerdict()
// wrote them. runSubmission() -- behind the assistant, submissions, tasks
// {execute:true} and AI-link routes -- inserted rows and left all seven NULL:
// 51 of 58 live rows unmeasured on 2026-09-25. It now writes them in the same
// update that sets the row's status (run-submission.ts level1Columns), with
// the four outcomes submitForVerdict() already uses:
//   not_needed  every segment answered by Level 0
//   resolved    the Level 1 lane ran and returned (a model call, or -- on the
//               AI link, whose own AI is Level 1 -- none)
//   refused     the provider gate switched the model off for this caller
//   error       the lane faulted; the route keeps its error status
//
// /classify IS THE ONE PATH WITH NO ROW TO RE-READ. It writes no submissions
// row (its contract: nothing but gap_log) and gap_log has no telemetry
// columns, so the only record it can give is its response -- asserted below,
// together with the fact that no row was written. Persisting it would need a
// column (or a row) that does not exist; per the U-49 brief no migration was
// added, and that gap is reported rather than papered over.
//
// WHAT IS REAL / FAKED: as src/lib/ai/gate-identity.test.ts -- the routes, the
// pipeline, runLevel1 and the gate are real; the database, the two auth entry
// points, the link-token lookup and the claude-cli provider (counts calls,
// maps nothing) are faked (src/lib/pipeline/__test-helpers__/pipeline-store-double.ts).
//
// Falsifiability (R74-RULING-03 (c)): with runSubmission()'s final update
// writing only {status, classification, selectedChain} again, every row-backed
// case below fails -- see the U-49 report for the recorded run.
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
} from "./__test-helpers__/pipeline-store-double";

const ORG = "org_u49_t";
const KEY_ID = "key_projexa_org";
const OWNER: PersonRow = { id: "user_owner", orgId: ORG, email: "owner@example.test", authUserId: "projexa-owner", role: "admin", isActive: true, name: "Rajat" };
const MEMBER: PersonRow = { id: "user_member", orgId: ORG, email: "member@example.test", authUserId: "projexa-member", role: "member", isActive: true, name: "Arjun" };
const MISS = "arrange the site handover paperwork";
// Answered by Level 0's structural tier (item code + percent); with no project
// named it then fails validation, so nothing reads a business table.
const L0_HIT = "PP1 is 50% done";

let store: PipelineStore;
const classifyCalls: ClassifyCall[] = [];
const KEY_CTX = { dbUser: null, apiKey: { id: KEY_ID, name: "PROJEXA (provisioned)", scopes: ["read", "write"] } };

const realDb = await import("@/lib/db");
const realTenantScoped = await import("@/lib/db/tenant-scoped");
const realAuthGuard = await import("@/lib/supabase/auth-guard");
const realClaudeCli = await import("@/lib/ai/providers/claude-cli");
const realUserLinks = await import("@/lib/ai-links/user-links");

mock.module("@/lib/db", () => ({
  ...realDb,
  db: { query: { users: { findFirst: mock(usersLookupDouble(() => [OWNER, MEMBER])) } } },
}));
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(fakeWithTenantContext(() => store)) }));
mock.module("@/lib/supabase/auth-guard", () => ({
  ...realAuthGuard,
  requireAuthOrApiKey: mock(async () => ({ orgId: ORG, response: null, ...KEY_CTX })),
  requireRoleOrScope: mock(() => null),
}));
mock.module("@/lib/ai/providers/claude-cli", () => ({ ...realClaudeCli, claudeCliProvider: mapsNothingProvider(classifyCalls) }));
// The AI link belongs to MEMBER, a real person; the link's own AI is Level 1 there (U-43).
mock.module("@/lib/ai-links/user-links", () => ({
  ...realUserLinks,
  resolveAiLinkToken: mock(async () => ({ orgId: ORG, userId: MEMBER.id, projectId: null })),
  resolveAiLinkOwnerRole: mock(async () => MEMBER.role),
}));

const env = aiEnvSnapshot();
let silenced: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
  store = makePipelineStore();
  classifyCalls.length = 0;
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
  await mock.module("@/lib/ai-links/user-links", () => realUserLinks);
  await mock.module("@/lib/ai/providers/claude-cli", () => realClaudeCli);
  await mock.module("@/lib/supabase/auth-guard", () => realAuthGuard);
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped);
  await mock.module("@/lib/db", () => realDb);
});

type Handler = (req: Request, ctx?: unknown) => Promise<Response>;
const handlers: Record<"assistant" | "submissions" | "tasks" | "classify" | "link", Handler> = {} as never;
beforeAll(async () => {
  handlers.assistant = ((await import("@/app/api/v1/projexa/assistant/route")) as unknown as { POST: Handler }).POST;
  handlers.submissions = ((await import("@/app/api/v1/projexa/submissions/route")) as unknown as { POST: Handler }).POST;
  handlers.tasks = ((await import("@/app/api/v1/projexa/tasks/route")) as unknown as { POST: Handler }).POST;
  handlers.classify = ((await import("@/app/api/v1/projexa/classify/route")) as unknown as { POST: Handler }).POST;
  handlers.link = ((await import("@/app/api/mcp/[token]/route")) as unknown as { POST: Handler }).POST;
});

const NAMES_MEMBER = { "x-acting-user-email": MEMBER.email };
const NAMES_OWNER = { "x-acting-user-email": OWNER.email };

function linkCall(tool: "submit_task" | "ask", text: string) {
  const args = tool === "submit_task" ? { rawInput: text } : { question: text };
  return handlers.link(
    jsonPost("https://x/api/mcp/tok", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }),
    { params: Promise.resolve({ token: "tok" }) }
  );
}

/** The one submissions row the request wrote, re-read from the store. */
function rereadRow() {
  const rows = rowsIn(store, "submissions");
  expect(rows).toHaveLength(1);
  return rows[0];
}

/** All seven 0571 columns are written, none left NULL. */
function expectMeasured(row: Record<string, unknown>) {
  for (const column of ["level", "source", "l0HitRate", "modelCalls", "cacheHits", "level1Outcome"]) {
    expect(row[column]).not.toBeNull();
    expect(row[column]).not.toBeUndefined();
  }
  expect(row.source).toBe(row.level1Outcome);
  expect("level1RefusalCode" in row).toBe(true);
}

const ROW_PATHS: Array<{ name: string; send: (text: string, headers?: Record<string, string>) => Promise<Response>; ownAi?: boolean }> = [
  { name: "assistant {rawInput}", send: (text, headers) => handlers.assistant(jsonPost("https://x/api/v1/projexa/assistant", { rawInput: text }, headers)) },
  { name: "submissions", send: (text, headers) => handlers.submissions(jsonPost("https://x/api/v1/projexa/submissions", { rawInput: text }, headers)) },
  { name: "tasks {execute:true}", send: (text, headers) => handlers.tasks(jsonPost("https://x/api/v1/projexa/tasks", { rawInput: text, execute: true }, headers)) },
  { name: "AI link tools/call submit_task", send: (text) => linkCall("submit_task", text), ownAi: true },
  { name: "AI link tools/call ask", send: (text) => linkCall("ask", text), ownAi: true },
];

describe("BR-220 -- the paths runSubmission() serves write Level 1 telemetry on their row", () => {
  for (const path of ROW_PATHS) {
    test(`${path.name}: a Level 0 hit is re-read as not_needed, no refusal code, 0 model calls`, async () => {
      await path.send(L0_HIT, NAMES_MEMBER);
      const row = rereadRow();
      expectMeasured(row);
      expect(row.level1Outcome).toBe("not_needed");
      expect(row.level1RefusalCode).toBeNull();
      expect(row.modelCalls).toBe(0);
      expect(row.level).toBe(0);
    });

    if (path.ownAi) {
      test(`${path.name}: a Level 0 miss is re-read as resolved with 0 model calls -- the link's own AI is Level 1`, async () => {
        await path.send(MISS);
        const row = rereadRow();
        expectMeasured(row);
        expect(row.level1Outcome).toBe("resolved");
        expect(row.level1RefusalCode).toBeNull();
        expect(row.modelCalls).toBe(0);
        expect(classifyCalls).toHaveLength(0);
      });
      continue;
    }

    test(`${path.name}: a refused Level 0 miss is re-read as refused / provider_not_allowed, 0 model calls`, async () => {
      await path.send(MISS, NAMES_MEMBER);
      const row = rereadRow();
      expectMeasured(row);
      expect(row.level1Outcome).toBe("refused");
      expect(row.level1RefusalCode).toBe("provider_not_allowed");
      expect(row.modelCalls).toBe(0);
      expect(row.cacheHits).toBe(0);
    });

    test(`${path.name}: a key naming nobody is re-read as refused / user_not_permitted`, async () => {
      await path.send(MISS);
      const row = rereadRow();
      expectMeasured(row);
      expect(row.level1Outcome).toBe("refused");
      expect(row.level1RefusalCode).toBe("user_not_permitted");
    });

    test(`${path.name}: an allowed Level 0 miss is re-read as resolved with 1 model call, level 1`, async () => {
      await path.send(MISS, NAMES_OWNER);
      const row = rereadRow();
      expectMeasured(row);
      expect(row.level1Outcome).toBe("resolved");
      expect(row.level1RefusalCode).toBeNull();
      expect(row.modelCalls).toBe(1);
      expect(row.level).toBe(1);
      expect(classifyCalls).toHaveLength(1);
    });

    test(`${path.name}: a fault in the Level 1 lane keeps its 400 and is re-read as error / unknown, not NULL`, async () => {
      store.failReads.add("reuseCache");
      const res = await path.send(MISS, NAMES_OWNER);
      expect(res.status).toBe(400);
      const row = rereadRow();
      expect(row.level1Outcome).toBe("error");
      expect(row.level1RefusalCode).toBe("unknown");
      expect(classifyCalls).toHaveLength(0);
    });
  }
});

describe("BR-220 -- /classify: telemetry in the response, because there is no row to hold it", () => {
  const classify = (text: string, headers?: Record<string, string>) =>
    handlers.classify(jsonPost("https://x/api/v1/projexa/classify", { rawInput: text }, headers));

  test("refused, not_needed and resolved are each reported, and no submissions row is written for any of them", async () => {
    const refused = (await (await classify(MISS, NAMES_MEMBER)).json()) as Record<string, unknown>;
    expect(refused).toMatchObject({ level1Outcome: "refused", level1RefusalCode: "provider_not_allowed", modelCalls: 0 });

    const unnamed = (await (await classify(MISS)).json()) as Record<string, unknown>;
    expect(unnamed).toMatchObject({ level1Outcome: "refused", level1RefusalCode: "user_not_permitted", modelCalls: 0 });

    const hit = (await (await classify(L0_HIT, NAMES_MEMBER)).json()) as Record<string, unknown>;
    expect(hit).toMatchObject({ level1Outcome: "not_needed", level1RefusalCode: null, modelCalls: 0 });

    const allowed = (await (await classify(MISS, NAMES_OWNER)).json()) as Record<string, unknown>;
    expect(allowed).toMatchObject({ level1Outcome: "resolved", level1RefusalCode: null, modelCalls: 1 });
    expect(classifyCalls).toHaveLength(1);

    // The disclosed gap: /classify persists nothing a later read could measure.
    expect(rowsIn(store, "submissions")).toHaveLength(0);
    expect(rowsIn(store, "gap_log").length).toBeGreaterThan(0);
  });
});
