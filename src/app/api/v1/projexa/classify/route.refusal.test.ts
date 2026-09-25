/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-49 -- register row BR-221, the classify route: a Level 1
// refusal answers HTTP 200 with the records attached, not HTTP 400 with the
// bare sentence.
//
// /classify is the read-only preview ("if I submitted this, what would
// happen?"). classifyOnly() called runLevel1() directly, so the provider gate's
// AiProviderRefusalError reached this route's catch and became HTTP 400
// {error: NO_COMMENTARY_SENTENCE}, dropping every classification Level 0 had
// already made. Now the refusal is "nothing resolved" for the misses
// (level1.ts refusalAsUnresolved): the response is the normal ClassifyOnlyResult
// -- the Level 0 classifications in `segments`, the misses as gaps -- plus
// level1Outcome "refused", its closed code, and the sentence in `message`.
// `executed` is still false: this endpoint still runs nothing. Bad input,
// unauthorised and a faulted read keep their codes.
//
// Contract note: this adds three fields (level1Outcome, level1RefusalCode,
// message) to a response frozen by platform.claude_log id 28 (r53-handshake).
// No field was removed or renamed; the handshake row is a DB write this change
// does not make -- see the U-49 report.
//
// WHAT IS REAL / FAKED: the route, the acting-person lookup, classifyOnly,
// Level 0, runLevel1 and the gate are real; the database, the users lookup,
// the auth entry points and the claude-cli provider are faked
// (src/lib/pipeline/__test-helpers__/pipeline-store-double.ts).
//
// Falsifiability (R74-RULING-03 (c)): with classifyOnly() calling the bare
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

const ORG = "org_u49_c";
const PROJECT = "proj_cedar";
const OWNER: PersonRow = { id: "user_owner", orgId: ORG, email: "owner@example.test", authUserId: "projexa-owner", role: "admin", isActive: true, name: "Rajat" };
const MEMBER: PersonRow = { id: "user_member", orgId: ORG, email: "member@example.test", authUserId: "projexa-member", role: "member", isActive: true, name: "Arjun" };
const HIT = "how is the project doing";
const MISS = "arrange the site handover paperwork";

let store: PipelineStore;
let auth: Record<string, unknown>;
const classifyCalls: ClassifyCall[] = [];
const KEY_AUTH = { orgId: ORG, dbUser: null, apiKey: { id: "key_org", name: "PROJEXA (provisioned)", scopes: ["read"] }, response: null };

const realDb = await import("@/lib/db");
const realTenantScoped = await import("@/lib/db/tenant-scoped");
const realAuthGuard = await import("@/lib/supabase/auth-guard");
const realClaudeCli = await import("@/lib/ai/providers/claude-cli");

mock.module("@/lib/db", () => ({ ...realDb, db: { query: { users: { findFirst: mock(usersLookupDouble(() => [OWNER, MEMBER])) } } } }));
mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(fakeWithTenantContext(() => store)) }));
mock.module("@/lib/supabase/auth-guard", () => ({
  ...realAuthGuard,
  requireAuthOrApiKey: mock(async () => auth),
  requireRoleOrScope: mock(() => null),
}));
mock.module("@/lib/ai/providers/claude-cli", () => ({ ...realClaudeCli, claudeCliProvider: mapsNothingProvider(classifyCalls) }));

const env = aiEnvSnapshot();
let silenced: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
  store = makePipelineStore();
  store.projects.set(PROJECT, { id: PROJECT, name: "Cedar Heights Villa" });
  promotePhrase(store, HIT, "get_construction_project_dashboard");
  classifyCalls.length = 0;
  auth = KEY_AUTH;
  env.clear();
  // Level 1 unset: the default provider is claude-cli (provider-config.ts).
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
  await mock.module("@/lib/ai/providers/claude-cli", () => realClaudeCli);
  await mock.module("@/lib/supabase/auth-guard", () => realAuthGuard);
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped);
  await mock.module("@/lib/db", () => realDb);
});

let POST: (req: Request) => Promise<Response>;
beforeAll(async () => {
  ({ POST } = (await import("./route")) as unknown as { POST: typeof POST });
});

async function classify(body: Record<string, unknown>, headers: Record<string, string> = { "x-acting-user": MEMBER.authUserId! }) {
  const res = await POST(jsonPost("https://x/api/v1/projexa/classify", body, headers));
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe("BR-221 -- classify: a Level 1 refusal is HTTP 200 with the records", () => {
  test("Level 0's classification comes back beside the gap, with the sentence -- not a 400", async () => {
    const { status, body } = await classify({ rawInput: `${HIT}\n${MISS}`, projectId: PROJECT });

    expect(status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.level1Outcome).toBe("refused");
    expect(body.level1RefusalCode).toBe("provider_not_allowed");
    expect(body.message).toBe(NO_COMMENTARY_SENTENCE);
    expect(body.executed).toBe(false);
    expect(body.modelCalls).toBe(0);
    // The records a preview has: what Level 0 understood, chain and all.
    expect(body.segments).toHaveLength(2);
    expect(body.segments[0]).toMatchObject({ text: HIT, functionId: "get_construction_project_dashboard", level: 0, source: "phrase_map", writes: false, executable: true });
    expect(body.segments[0].derivedChain.full).toContain("Cedar Heights Villa");
    expect(body.segments[1]).toMatchObject({ text: MISS, verdict: "gap", functionId: null });
    expect(classifyCalls).toHaveLength(0);
    // Its one persisted trace, the gap it could not resolve.
    expect(rowsIn(store, "gap_log").map((r) => r.segmentText)).toEqual([MISS]);
  });

  test("a key naming nobody: still 200, the gap, the sentence and its own code", async () => {
    const { status, body } = await classify({ rawInput: MISS }, {});

    expect(status).toBe(200);
    expect(body.level1Outcome).toBe("refused");
    expect(body.level1RefusalCode).toBe("user_not_permitted");
    expect(body.message).toBe(NO_COMMENTARY_SENTENCE);
    expect(body.segments).toEqual([expect.objectContaining({ text: MISS, verdict: "gap" })]);
  });

  test("control: the owner is not refused -- one model call, no sentence", async () => {
    const { status, body } = await classify({ rawInput: `${HIT}\n${MISS}`, projectId: PROJECT }, { "x-acting-user": OWNER.authUserId! });

    expect(status).toBe(200);
    expect(body.level1Outcome).toBe("resolved");
    expect(body.message).toBeNull();
    expect(body.modelCalls).toBe(1);
    expect(classifyCalls).toHaveLength(1);
  });
});

describe("BR-221 -- classify: genuine errors keep their status codes", () => {
  test("an empty rawInput stays 400 with its own message", async () => {
    const { status, body } = await classify({ rawInput: "" });
    expect(status).toBe(400);
    expect(body.error).toBe("rawInput is required and must be a non-empty string");
  });

  test("unauthorised stays 401", async () => {
    auth = { orgId: null, dbUser: null, apiKey: null, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
    const { status } = await classify({ rawInput: MISS });
    expect(status).toBe(401);
  });

  test("a faulted read stays 400 with its own message, not the sentence", async () => {
    store.failReads.add("phraseMap");
    const { status, body } = await classify({ rawInput: MISS });
    expect(status).toBe(400);
    expect(body.error).toBe("phraseMap read failed");
  });
});
