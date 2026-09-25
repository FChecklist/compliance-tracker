/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-43 (GATE_2_8_FINDINGS section 5, "File 2"): the external
// AI link makes zero server-side model calls.
//
// Owner directive 2026-09-25: when a user pastes their AI Work link into their
// own AI (ChatGPT, Gemini, Claude...), that AI is Level 1 and the platform's
// own AI must not run. Before U-43, POST /api/mcp/[token] reached the server's
// Level 1 on any Level 0 miss (runSubmission -> resolveAll ->
// resolveMissesWithReuseCache -> runLevel1 -> assertAiProviderAllowed). Under
// claude-cli / claude-cli-remote a non-owner's AI got JSON-RPC -32000 "VERI
// can't add commentary right now"; under openrouter the server paid for its
// own model call on top of the user's AI.
//
// WHAT IS REAL: the route, runSubmission, segmentation, the Level 0 tiers, the
// reuse and fuzzy tiers, validate(), the gap log writes and the function
// registry. WHAT IS FAKED: the link-token lookup (@/lib/ai-links/user-links),
// the database layer (@/lib/db/tenant-scoped, staged writes committed on
// success and discarded on throw, the pattern of
// src/app/api/v1/projexa/tasks/route.gate.test.ts) and runLevel1, replaced by
// a spy that throws the refusal the real gate throws, so any call to it turns
// into the old -32000 error and fails the assertions.
//
// "Zero model calls" is read from the pipeline's own per-submission log line
// (model_calls=N, the proof run-submission.ts writes for every submission).
// runSubmission does not write compliance.submissions.level1_outcome /
// model_calls -- only submitForVerdict() does -- so there is no column on this
// path to re-read for it; the persisted evidence re-read here is the
// submissions row and its gap_log row.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { getTableName } from "drizzle-orm";
import { AiProviderRefusalError } from "@/lib/ai/adapter";
import { NO_COMMENTARY_SENTENCE } from "@/lib/ai/refusal";
import { failureLogLine } from "@/lib/pipeline/error-codes";

const ORG_ID = "org_1";
const LINK_USER = "user_2";
const OWNER = "owner_user_id_1";
// No Level 0 tier recognises it: not an acknowledgement, no promoted phrase,
// no item code plus percent, no logging verb with a duration, no percent for
// last-action recall. The reuse cache and the fuzzy tier return nothing below.
const MISS_TEXT = "xyzzy unmatched phrase";

type Row = { id: string; table: string } & Record<string, unknown>;

type Store = {
  committed: Row[];
  nextId: number;
  /** what db.query.phraseMap.findFirst returns; null means no promoted phrase */
  phraseMapRow: Record<string, unknown> | null;
};

function makeStore(): Store {
  return { committed: [], nextId: 1, phraseMapRow: null };
}

/** True when a drizzle SQL fragment carries `value` as one of its bound parameters. */
function sqlBinds(node: unknown, value: string, seen = new Set<unknown>(), depth = 0): boolean {
  if (node === value) return true;
  if (!node || typeof node !== "object" || depth > 10 || seen.has(node)) return false;
  seen.add(node);
  const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
  if (Array.isArray(chunks)) return chunks.some((c) => sqlBinds(c, value, seen, depth + 1));
  if ("value" in node) return sqlBinds((node as { value: unknown }).value, value, seen, depth + 1);
  return false;
}

function makeTransaction(store: Store) {
  const working: Row[] = store.committed.map((r) => ({ ...r }));

  const query = new Proxy(
    {},
    {
      get: (_target, table) => {
        if (typeof table !== "string" || table === "then") return undefined;
        return {
          findFirst: async () => (table === "phraseMap" ? (store.phraseMapRow ?? undefined) : undefined),
          findMany: async () => [],
        };
      },
    }
  );

  const stage = (table: Parameters<typeof getTableName>[0], v: Record<string, unknown>): Row => {
    const row: Row = { ...v, id: `row_${store.nextId++}`, table: getTableName(table) };
    working.push(row);
    return row;
  };

  const db = {
    query,
    // makePhraseFuzzyRepo runs raw SQL through db.execute; no row scores high enough.
    execute: async () => [],
    insert: (table: Parameters<typeof getTableName>[0]) => ({
      values: (v: Record<string, unknown>) => ({
        // submissions: `.returning()`; gap_log: awaited directly.
        returning: async () => [{ id: stage(table, v).id }],
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve()
            .then(() => {
              stage(table, v);
            })
            .then(resolve, reject),
      }),
    }),
    update: (table: Parameters<typeof getTableName>[0]) => ({
      set: (values: Record<string, unknown>) => ({
        where: (cond: unknown) => ({
          then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve()
              .then(() => {
                for (const row of working) {
                  if (row.table === getTableName(table) && sqlBinds(cond, row.id)) Object.assign(row, values);
                }
              })
              .then(resolve, reject),
        }),
      }),
    }),
  };

  return {
    db,
    commit: () => {
      store.committed = working;
    },
  };
}

let store: Store;

const realTenantScoped = await import("@/lib/db/tenant-scoped");
const realUserLinks = await import("@/lib/ai-links/user-links");
const realLevel1 = await import("@/lib/pipeline/level1");

const runLevel1Spy = mock(async (_texts: string[], _ctx: unknown): Promise<never> => {
  throw new AiProviderRefusalError(NO_COMMENTARY_SENTENCE);
});

mock.module("@/lib/ai-links/user-links", () => ({
  ...realUserLinks,
  resolveAiLinkToken: mock(async () => ({ orgId: ORG_ID, userId: LINK_USER })),
  resolveAiLinkOwnerRole: mock(async () => "member"),
}));
mock.module("@/lib/db/tenant-scoped", () => ({
  ...realTenantScoped,
  withTenantContext: mock(async (_ctx: unknown, fn: (db: unknown) => Promise<unknown>) => {
    const txn = makeTransaction(store);
    const result = await fn(txn.db);
    txn.commit();
    return result;
  }),
}));
mock.module("@/lib/pipeline/level1", () => ({ ...realLevel1, runLevel1: runLevel1Spy }));

const ENV_KEYS = ["AI_PROVIDER", "AI_PROVIDER_PIPELINE_L1", "AI_PROVIDER_PIPELINE_L2", "AI_ALLOWED_PROVIDERS", "RAJAT_USER_ID"] as const;
const SAVED = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as Record<(typeof ENV_KEYS)[number], string | undefined>;

let infoLines: string[] = [];
let silenced: Array<{ mockRestore: () => void }> = [];

beforeEach(() => {
  store = makeStore();
  runLevel1Spy.mockClear();
  for (const k of ENV_KEYS) delete process.env[k];
  // The link user is NOT the owner, so the real gate would refuse them under
  // claude-cli / claude-cli-remote.
  process.env.RAJAT_USER_ID = OWNER;
  infoLines = [];
  silenced = [
    spyOn(console, "error").mockImplementation(() => {}),
    spyOn(console, "warn").mockImplementation(() => {}),
    spyOn(console, "info").mockImplementation((...args: unknown[]) => {
      infoLines.push(args.map(String).join(" "));
    }),
  ];
});

afterEach(() => {
  for (const s of silenced) s.mockRestore();
  for (const k of ENV_KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
});

afterAll(async () => {
  mock.restore();
  await mock.module("@/lib/pipeline/level1", () => realLevel1);
  await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped);
  await mock.module("@/lib/ai-links/user-links", () => realUserLinks);
});

type RouteContext = { params: Promise<{ token: string }> };
let POST: (req: Request, ctx: RouteContext) => Promise<Response>;
let runSubmission: typeof import("@/lib/pipeline/run-submission").runSubmission;
beforeAll(async () => {
  ({ POST } = (await import("./route")) as unknown as { POST: typeof POST });
  ({ runSubmission } = await import("@/lib/pipeline/run-submission"));
});

type ToolName = "submit_task" | "ask";

async function callTool(tool: ToolName, text: string) {
  const args = tool === "submit_task" ? { rawInput: text } : { question: text };
  const res = await POST(
    new Request("https://x/api/mcp/tok", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: tool, arguments: args } }),
    }),
    { params: Promise.resolve({ token: "tok" }) }
  );
  const body = (await res.json()) as {
    error?: { code: number; message: string };
    result?: { content: { type: string; text: string }[] };
  };
  return { res, body };
}

/** The pipeline's own proof line for the last submission, e.g. "... model_calls=0 ...". */
function modelCallsLogged(): number[] {
  return infoLines
    .filter((l) => l.startsWith("[pipeline] submission="))
    .map((l) => Number(/model_calls=(\d+)/.exec(l)?.[1] ?? NaN));
}

function candidateIds(text: string): string[] {
  return text
    .split("\n")
    .map((l) => /^\d+\. ([a-z_]+) \|/.exec(l)?.[1])
    .filter((id): id is string => typeof id === "string");
}

const PROVIDER_STATES = [
  { label: "L1 provider unset (defaults to claude-cli)", apply: () => {} },
  { label: "L1 provider claude-cli", apply: () => (process.env.AI_PROVIDER_PIPELINE_L1 = "claude-cli") },
  { label: "L1 provider claude-cli-remote", apply: () => (process.env.AI_PROVIDER_PIPELINE_L1 = "claude-cli-remote") },
  { label: "L1 provider openrouter", apply: () => (process.env.AI_PROVIDER_PIPELINE_L1 = "openrouter") },
];

describe("POST /api/mcp/[token] -- a Level 0 miss makes no server-side model call and answers with candidates", () => {
  for (const state of PROVIDER_STATES) {
    for (const tool of ["submit_task", "ask"] as const) {
      test(`${state.label}, tools/call ${tool}: HTTP 200 text result naming candidate functions, runLevel1 never called`, async () => {
        state.apply();

        const { res, body } = await callTool(tool, MISS_TEXT);

        expect(res.status).toBe(200);
        expect(body.error).toBeUndefined();
        const content = body.result!.content;
        expect(content).toHaveLength(1);
        expect(content[0].type).toBe("text");
        const text = content[0].text;
        expect(text).toContain(`No built-in function matched "${MISS_TEXT}"`);
        expect(text).toContain(`call ${tool} again`);

        const ids = candidateIds(text);
        expect(ids.length).toBeGreaterThan(0);
        expect(ids.length).toBeLessThanOrEqual(8);
        if (tool === "submit_task") {
          // No shared word, so registry order: the first entry is the progress write.
          expect(ids[0]).toBe("record_work_progress");
          expect(text).toContain("record_work_progress | Record progress | records a new work progress entry | projectId, itemCode or boqLineItemId, percent or quantityDone");
        } else {
          // `ask` offers reads only.
          expect(ids).not.toContain("record_work_progress");
          expect(ids[0]).toBe("get_construction_project_dashboard");
        }
        // run_work_progress_report is in the registry but has no executor, so this link cannot reach it.
        expect(ids).not.toContain("run_work_progress_report");

        // THE ASSERTION U-43 EXISTS FOR.
        expect(runLevel1Spy.mock.calls.length).toBe(0);
        expect(modelCallsLogged()).toEqual([0]);

        // Re-read what was persisted: the submission and the gap it left for Level 2's promotion loop.
        const subs = store.committed.filter((r) => r.table === "submissions");
        expect(subs).toHaveLength(1);
        expect(subs[0].rawInput).toBe(MISS_TEXT);
        expect(subs[0].userId).toBe(LINK_USER);
        expect(subs[0].status).toBe("failed");
        const gapRows = store.committed.filter((r) => r.table === "gap_log");
        expect(gapRows).toHaveLength(1);
        expect(gapRows[0].segmentText).toBe(MISS_TEXT);
        expect(gapRows[0].submissionId).toBe(subs[0].id);
        // Nothing was minted for a text nothing matched.
        expect(store.committed.filter((r) => r.table === "pipeline_tasks")).toHaveLength(0);
      });
    }
  }

  test("candidates are ranked by the words the unmatched text shares with them", async () => {
    process.env.AI_PROVIDER_PIPELINE_L1 = "claude-cli";

    const { body } = await callTool("submit_task", "xyzzy budget numbers");

    expect(body.error).toBeUndefined();
    const ids = candidateIds(body.result!.content[0].text);
    // The four functions whose id, label or module say "budget", in registry order, then the rest.
    expect(ids.slice(0, 4)).toEqual([
      "get_construction_budget_status",
      "review_budget",
      "detect_construction_budget_schedule_risk",
      "list_over_budget_projects",
    ]);
    expect(ids).toHaveLength(8);
    expect(runLevel1Spy.mock.calls.length).toBe(0);
  });

  test("a request with a matched part and an unmatched part: the matched part's outcome is attached and not repeated", async () => {
    process.env.AI_PROVIDER_PIPELINE_L1 = "claude-cli-remote";

    const { res, body } = await callTool("submit_task", `PP1 is 50% done\n${MISS_TEXT}`);

    expect(res.status).toBe(200);
    expect(body.error).toBeUndefined();
    const content = body.result!.content;
    expect(content).toHaveLength(2);
    expect(content[0].text).toContain(`No built-in function matched "${MISS_TEXT}"`);
    expect(content[0].text).toContain("Do not send those parts again");
    expect(content[0].text).not.toContain('"PP1 is 50% done"');
    // The structural hit went through validate() exactly as before: no project, so a refusal code, not a guess.
    const outcome = JSON.parse(content[1].text) as { failures: { segmentText: string; code: string }[] };
    expect(outcome.failures.map((f) => f.segmentText)).toEqual(["PP1 is 50% done"]);
    expect(runLevel1Spy.mock.calls.length).toBe(0);
    expect(modelCallsLogged()).toEqual([0]);
  });
});

describe("POST /api/mcp/[token] -- a phrase Level 0 answers returns the same result as before", () => {
  const HIT = { functionId: "record_work_progress", fixedParams: { percent: 50 }, promotedAt: new Date() };

  test("submit_task: the tool text is the pipeline result, identical to runSubmission's default (internal Level 1) run", async () => {
    process.env.AI_PROVIDER_PIPELINE_L1 = "claude-cli";
    store.phraseMapRow = HIT;

    const { res, body } = await callTool("submit_task", MISS_TEXT);
    expect(res.status).toBe(200);
    expect(body.error).toBeUndefined();
    const content = body.result!.content;
    expect(content).toHaveLength(1);
    const viaLink = JSON.parse(content[0].text) as Record<string, unknown>;

    const direct = await runSubmission({ orgId: ORG_ID, userId: LINK_USER, mode: "Projects", projectId: null, rawInput: MISS_TEXT, role: "member" });
    expect(viaLink.submissionId).not.toBe(direct.submissionId);
    expect({ ...viaLink, submissionId: null }).toEqual(JSON.parse(JSON.stringify({ ...direct, submissionId: null })));
    expect(direct.failures).toHaveLength(1);
    expect(runLevel1Spy.mock.calls.length).toBe(0);
    expect(modelCallsLogged()).toEqual([0, 0]);
  });

  test("ask: the answer line is the one ask gave before", async () => {
    process.env.AI_PROVIDER_PIPELINE_L1 = "openrouter";
    store.phraseMapRow = HIT;

    const { body } = await callTool("ask", MISS_TEXT);
    expect(body.error).toBeUndefined();

    const direct = await runSubmission({ orgId: ORG_ID, userId: LINK_USER, mode: "Projects", projectId: null, rawInput: MISS_TEXT, role: "member" });
    expect(JSON.parse(body.result!.content[0].text)).toEqual({
      answer: `I can't answer that yet: ${direct.failures.map((f) => failureLogLine(f)).join("; ")}`,
    });
    expect(runLevel1Spy.mock.calls.length).toBe(0);
  });
});
