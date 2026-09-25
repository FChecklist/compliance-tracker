// R63 (owner directive, 2026-08-29): the server half of the per-user AI
// link. An external AI client (Claude.ai Connectors today; any
// MCP-compatible client as adoption spreads) adds this URL and gains two
// tools, scoped to exactly the one user this token resolves to -- reuses
// the REAL, already-live pipeline (src/lib/pipeline/run-submission.ts),
// not a parallel system.
//
// Hand-rolled JSON-RPC 2.0 dispatch, matching src/app/api/mcp/route.ts's
// own proven pattern -- deliberately NOT using @modelcontextprotocol/sdk.
// That package's default validator chain (ajv-provider.js -> ajv-formats
// -> ajv@8) conflicts with this repo's own security-pinned ajv@6.14.0
// (bumping it broke ESLint's own internals outright -- confirmed live,
// not a hypothetical). Two narrow, hand-written tool schemas need no
// JSON-schema validator library at all; the existing route already proves
// this shape works in production.
import { NextResponse } from "next/server";
import { resolveAiLinkOwnerRole, resolveAiLinkToken, type AiLinkIdentity } from "@/lib/ai-links/user-links";
import { runSubmission, type RunSubmissionResult } from "@/lib/pipeline/run-submission";
import { failureLogLine } from "@/lib/pipeline/error-codes";
import { ALL_FUNCTION_SPECS, type FunctionSpec } from "@/lib/pipeline/function-registry";
import { hasExecutor } from "@/lib/pipeline/executor";
import { assertProjectInScope } from "@/lib/ai-links/project-scope";

const TOOL_DEFINITIONS = [
  {
    name: "submit_task",
    description:
      "Submit a task or question on behalf of this VERIDIAN/PROJEXA user. Handles both plain chat questions and real actions (e.g. \"record 40% progress on PP1\", \"make a GST filing for ABC\"). If required information is missing, the response will ask for it -- resubmit with the missing detail included.",
    inputSchema: {
      type: "object",
      required: ["rawInput"],
      properties: {
        rawInput: { type: "string", description: "The task or question, in the user's own words." },
        mode: { type: "string", description: "Which module this belongs to, e.g. \"Projects\". Defaults to \"Projects\" if omitted." },
        projectId: { type: "string", description: "A specific project id, if the task is scoped to one." },
      },
    },
  },
  {
    name: "ask",
    description: "Ask a plain question (no action taken) -- an alias for submit_task for a pure-chat query.",
    inputSchema: {
      type: "object",
      required: ["question"],
      properties: { question: { type: "string" } },
    },
  },
];

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

// PROJEXA-BUILD-001 U-18 (BR-210): a JSON-RPC server error (the reserved
// -32000..-32099 range) for "this link cannot act on that project", sent with
// HTTP 403 so a client can tell it from a tool failure (-32000, HTTP 200).
const PROJECT_OUT_OF_SCOPE = -32003;
function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

type ToolContent = { type: "text"; text: string }[];

function jsonContent(value: unknown): ToolContent {
  return [{ type: "text", text: JSON.stringify(value, null, 2) }];
}

// PROJEXA-BUILD-001 U-43 (2026-09-25, owner directive: "we will not use our
// AI if the user has pasted the AI Work link"). On this route the caller's
// own AI is Level 1, so both tools run the pipeline with level1 "off": Level
// 0, the reuse cache and the phrase-fuzzy tier, zero server-side model calls,
// and no provider gate. Before this, a Level 0 miss here went on to the
// server's own Level 1 -- under claude-cli / claude-cli-remote a JSON-RPC
// -32000 error for every non-owner, under openrouter a metered call on top of
// the user's own AI.
//
// A miss is now a normal tool result the calling AI can act on: what did not
// match, and up to MAX_CANDIDATES functions this link can reach with the
// parameters each one needs, so it can rephrase and call again. There is
// deliberately no way to run a function by id here; that comes with project
// scoping.
const MAX_CANDIDATES = 8;

/**
 * Segments no tier resolved. A validation refusal is a gap too, but it names
 * its function and carries its own code in `failures`, so it is left to the
 * normal result.
 */
function unmatchedSegments(result: RunSubmissionResult): string[] {
  const refused = new Set(result.failures.map((f) => f.segmentText));
  return result.gaps.filter((g) => !refused.has(g.text)).map((g) => g.text);
}

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
}

/**
 * The registry's functions this link can reach (the ones executor.ts can run),
 * reads only for `ask`. Ranked by how many words of the unmatched text each
 * function's id, label and module share; ties keep registry order, so a text
 * that shares no word gets the first MAX_CANDIDATES.
 */
function candidateFunctions(unmatched: string[], readsOnly: boolean): FunctionSpec[] {
  const wanted = words(unmatched.join(" "));
  const score = (s: FunctionSpec) => [...words(`${s.functionId} ${s.label} ${s.module}`)].filter((w) => wanted.has(w)).length;
  return ALL_FUNCTION_SPECS.filter((s) => hasExecutor(s.functionId) && !(readsOnly && s.writes))
    .map((spec, order) => ({ spec, order, score: score(spec) }))
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, MAX_CANDIDATES)
    .map((c) => c.spec);
}

function describeFunction(spec: FunctionSpec): string {
  const area = spec.module.replace(/_/g, " ");
  if (spec.writes) return `records a new ${area} entry`;
  if (spec.kind === "run") return `opens the ${area} screen`;
  return `reads ${area} records and changes nothing`;
}

/** The registry's required parameters, with the names that answer the same question, plus projectId for a project-scoped read. */
function paramsNeeded(spec: FunctionSpec): string {
  const names = spec.requiredParams.map((p) => [p.name, ...(p.alsoSatisfiedBy ?? [])].join(" or "));
  if (spec.requiresProject && !spec.requiredParams.some((p) => p.name === "projectId")) names.unshift("projectId");
  return names.length > 0 ? names.join(", ") : "nothing";
}

function unmatchedContent(result: RunSubmissionResult, unmatched: string[], tool: "submit_task" | "ask"): ToolContent {
  const others = result.tasks.length > 0 || result.failures.length > 0;
  const lines = [
    `No built-in function matched ${unmatched.map((t) => JSON.stringify(t)).join(", ")}. Nothing was run for ${unmatched.length === 1 ? "that text" : "those texts"}.`,
  ];
  if (others) lines.push("The other parts of this request were processed; their outcome is the second content item. Do not send those parts again.");
  lines.push("", "Candidate functions reachable through this link (id | name | what it does | parameters it needs):");
  candidateFunctions(unmatched, tool === "ask").forEach((s, i) => {
    lines.push(`${i + 1}. ${s.functionId} | ${s.label} | ${describeFunction(s)} | ${paramsNeeded(s)}`);
  });
  lines.push("", `Rephrase only the unmatched part in the wording of one candidate, including the values it needs, and call ${tool} again.`);
  const content: ToolContent = [{ type: "text", text: lines.join("\n") }];
  if (others) content.push(...jsonContent(result));
  return content;
}

// PROJEXA-BUILD-001 U-01 (2026-09-25): `role` is the link owner's own
// compliance.users role (resolveAiLinkOwnerRole), passed to runSubmission so
// the pipeline's construction figures are redacted for a link owner below
// manager. Both calls below used to pass no role, which the redaction read as
// "show everything". null (no active user row) is passed through as null, and
// the redaction treats it as not allowed -- it is never an error here.
//
// U-18 (BR-210): `projectScope` is the link's own project (a PROJEXA work
// link) or null (a VERIDIAN link, org-wide as before). Both calls pass it to
// runSubmission, which runs the submission on that project -- a call naming
// no project is pinned to it -- and refuses any other project the text or the
// params name. A call whose arguments name another project never gets here
// (projectScopeRefusal, below).
async function handleTool(
  name: string,
  args: Record<string, unknown>,
  orgId: string,
  userId: string,
  role: string | null,
  projectScope: string | null
): Promise<ToolContent> {
  if (name === "submit_task") {
    const rawInput = String(args.rawInput ?? "");
    if (!rawInput.trim()) throw new Error("rawInput is required");
    const result = await runSubmission({
      orgId, userId,
      mode: typeof args.mode === "string" ? args.mode : "Projects",
      projectId: typeof args.projectId === "string" ? args.projectId : null,
      rawInput,
      role,
      level1: "off",
      projectScope,
    });
    const unmatched = unmatchedSegments(result);
    if (unmatched.length > 0) return unmatchedContent(result, unmatched, "submit_task");
    return jsonContent(result);
  }
  if (name === "ask") {
    const question = String(args.question ?? "");
    if (!question.trim()) throw new Error("question is required");
    const result = await runSubmission({ orgId, userId, mode: "Projects", projectId: null, rawInput: question, role, level1: "off", projectScope });
    const unmatched = unmatchedSegments(result);
    if (unmatched.length > 0) return unmatchedContent(result, unmatched, "ask");
    const said = result.chatMessages.join("\n").trim();
    if (said) return jsonContent({ answer: said });
    // R67 FIX PASS -- COLLATERAL OF REMOVING PROSE FROM THE PIPELINE.
    //
    // runSubmission() used to push "I can't do that yet: <reason>" into
    // chatMessages for a validation failure; D-03 moved that sentence to the
    // client, and the reason now travels in `failures` as {code, missing}.
    // This call site kept `|| JSON.stringify(result)`, so an MCP client that
    // used to receive one honest line started receiving the whole result
    // object. MCP has no projexa dictionary to consult and its caller is
    // itself a model, so the CODE LINE -- "BOQ_LINE_REQUIRED missing=boqLine"
    // -- is the right rendering here: exhaustive, stable, and no new prose
    // that could drift from the client's wording.
    if (result.failures.length > 0) {
      return jsonContent({ answer: `I can't answer that yet: ${result.failures.map((f) => failureLogLine(f)).join("; ")}` });
    }
    return jsonContent({ answer: JSON.stringify(result) });
  }
  throw new Error(`Unknown tool: ${name}`);
}

/**
 * U-18 (BR-210): the JSON-RPC error for a tools/call whose arguments name a
 * project this link may not act on, or null. Checked in POST before dispatch,
 * so a refused call resolves no role and runs nothing: no submission, no task,
 * no business row. `identity.projectId ?? null`: a link resolved without one
 * (every VERIDIAN link) is org-wide, exactly as before U-18.
 */
function projectScopeRefusal(body: Record<string, unknown>, identity: AiLinkIdentity) {
  const { id, method, params } = body as { id: unknown; method: string; params?: Record<string, unknown> };
  if (method !== "tools/call") return null;
  const args = (params?.arguments ?? {}) as Record<string, unknown>;
  const check = assertProjectInScope({ projectId: identity.projectId ?? null }, typeof args.projectId === "string" ? args.projectId : null);
  return check.ok ? null : rpcError(id, PROJECT_OUT_OF_SCOPE, check.message);
}

async function dispatch(body: Record<string, unknown>, identity: AiLinkIdentity) {
  const { orgId, userId } = identity;
  const { id, method, params } = body as { id: unknown; method: string; params: Record<string, unknown> };

  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "VERIDIAN AI Link", version: "1.0.0" },
    });
  }
  if (method === "notifications/initialized") return null;
  if (method === "ping") return rpcResult(id, {});
  if (method === "tools/list") return rpcResult(id, { tools: TOOL_DEFINITIONS });

  if (method === "tools/call") {
    const toolName = params?.name as string;
    const toolArgs = (params?.arguments ?? {}) as Record<string, unknown>;
    try {
      // Read only for tools/call: initialize/tools/list/ping touch no figures.
      const role = await resolveAiLinkOwnerRole(identity);
      const content = await handleTool(toolName, toolArgs, orgId, userId, role, identity.projectId ?? null);
      return rpcResult(id, { content });
    } catch (err) {
      return rpcError(id, -32000, (err as Error).message);
    }
  }

  return rpcError(id, -32601, `Method not found: ${method}`);
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const identity = await resolveAiLinkToken(token);
  if (!identity) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "This AI link is invalid or has been revoked." } },
      { status: 401 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }

  const refusal = projectScopeRefusal(body, identity);
  if (refusal) return NextResponse.json(refusal, { status: 403 });

  const response = await dispatch(body, identity);
  if (response === null) return new NextResponse(null, { status: 204 });
  return NextResponse.json(response, { headers: { "Content-Type": "application/json" } });
}

// MCP clients probe with GET to discover the endpoint.
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const identity = await resolveAiLinkToken(token);
  if (!identity) {
    return NextResponse.json({ error: "This AI link is invalid or has been revoked." }, { status: 401 });
  }
  return NextResponse.json({
    name: "VERIDIAN AI Link",
    version: "1.0.0",
    protocol: "MCP 2024-11-05",
    transport: "HTTP JSON-RPC 2.0",
    tools: TOOL_DEFINITIONS.map((t) => t.name),
  });
}
