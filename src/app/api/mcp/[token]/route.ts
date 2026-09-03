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
import { resolveAiLinkToken } from "@/lib/ai-links/user-links";
import { runSubmission } from "@/lib/pipeline/run-submission";
import { failureLogLine } from "@/lib/pipeline/error-codes";

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
function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

async function handleTool(name: string, args: Record<string, unknown>, orgId: string, userId: string): Promise<unknown> {
  if (name === "submit_task") {
    const rawInput = String(args.rawInput ?? "");
    if (!rawInput.trim()) throw new Error("rawInput is required");
    return runSubmission({
      orgId, userId,
      mode: typeof args.mode === "string" ? args.mode : "Projects",
      projectId: typeof args.projectId === "string" ? args.projectId : null,
      rawInput,
    });
  }
  if (name === "ask") {
    const question = String(args.question ?? "");
    if (!question.trim()) throw new Error("question is required");
    const result = await runSubmission({ orgId, userId, mode: "Projects", projectId: null, rawInput: question });
    const said = result.chatMessages.join("\n").trim();
    if (said) return { answer: said };
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
      return { answer: `I can't answer that yet: ${result.failures.map((f) => failureLogLine(f)).join("; ")}` };
    }
    return { answer: JSON.stringify(result) };
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function dispatch(body: Record<string, unknown>, orgId: string, userId: string) {
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
      const result = await handleTool(toolName, toolArgs, orgId, userId);
      return rpcResult(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
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

  const response = await dispatch(body, identity.orgId, identity.userId);
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
