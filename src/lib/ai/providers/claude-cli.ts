// R42 seq13 -- the claude-cli AiProvider. LOCAL-DEV-ONLY BY CONSTRUCTION:
// this shells out to the `claude` binary Rajat's own machine has installed
// and authenticated via his own Claude subscription (Anthropic policy: OAuth/
// subscription auth is for ordinary individual use, never to serve a third
// party's request through it -- see adapter.ts's assertAiProviderAllowed,
// which every caller MUST run before reaching this file).
//
// There is no `claude` binary on Vercel's serverless runtime and no way to
// get one authenticated as Rajat there even if there were -- this provider
// throws honestly if the binary is missing rather than pretending to work.
// That is precisely why the M27 tripwire is not optional: AI_PROVIDER must
// become "openrouter" (adapter.ts's other, deployable provider) before this
// product is ever reachable by anyone other than Rajat testing on his own
// machine.
import { spawn } from "node:child_process";
import { stripJsonFence } from "@/lib/llm-client";
import type { AiProvider, ClassificationResult, Artifact, ClassifyContext } from "../adapter";

const CLAUDE_CLI_TIMEOUT_MS = 60_000;

// Runs `claude -p` in non-interactive print mode, feeding the full prompt on
// stdin (never as a CLI argument -- these prompts can be several KB, well
// past what's safe to pass as a single shell argument) and capturing stdout.
function runClaudeCli(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`claude CLI timed out after ${CLAUDE_CLI_TIMEOUT_MS}ms`));
    }, CLAUDE_CLI_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Failed to launch the claude CLI (${err.message}). This provider only works on a machine with Claude Code installed and authenticated -- it is not deployable (see this file's header comment). Set AI_PROVIDER=openrouter for any environment other than Rajat's own local dev machine.`
        )
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude CLI exited with code ${code}: ${stderr.slice(0, 2000)}`));
        return;
      }
      resolve(stdout);
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function callClaudeCliJson<T>(systemPrompt: string, userMessage: string, expectedKeys: string[]): Promise<T> {
  const prompt = `${systemPrompt}\n\n---\n\nRespond with ONLY the JSON object described above, no other text, no markdown code fence.\n\n${userMessage}`;
  const raw = await runClaudeCli(prompt);
  const parsed = JSON.parse(stripJsonFence(raw.trim())) as T;
  const missing = expectedKeys.filter((key) => !(parsed && typeof parsed === "object" && key in (parsed as object)));
  if (missing.length > 0) {
    throw new Error(`claude CLI response is missing expected key(s): ${missing.join(", ")}`);
  }
  return parsed;
}

// Same prompts as providers/openrouter.ts, deliberately -- both providers
// satisfy the identical AiProvider contract and must produce the identical
// output shape for the identical input; only the transport differs.
const CLASSIFY_SYSTEM_PROMPT = `You are Level 1 of a construction ERP's deterministic task pipeline. Your ONLY job: for each input segment, either select exactly one function_id from the given candidate list with its parameters, or report that you cannot.

Rules, absolute:
- You may NEVER invent a function_id that is not in candidateFunctions.
- You may NEVER perform arithmetic yourself -- if a computed value is needed, that is a missing param, not something for you to calculate.
- You may NEVER write to any database -- you only select a function and its parameters; execution happens elsewhere.
- You may NEVER return prose. Output ONLY the JSON shape described below.
- If a segment names a valid function but is missing a required parameter, return that function_id with the params you found and list the rest in missingParams -- do not guess a missing value.
- If a segment cannot be matched to any candidate function, set functionId to null, missingParams to [], confidence to 0, and unmappedIntent to a short honest description of what the user seems to want.

Output STRICT JSON: {"results": [{"functionId": string|null, "params": object, "missingParams": string[], "confidence": number (0-1), "unmappedIntent": string|null}, ...]} with exactly one entry per input segment, in the same order.`;

const ANALYSE_SYSTEM_PROMPT = `You are Level 2 of a construction ERP's deterministic task pipeline, running as a NIGHTLY BATCH job over the last 24h of unresolved user intents (gap_log), never in response to a live user request.

Rules, absolute:
- You may NEVER merge, deploy, run a migration, or touch production data.
- You may NEVER state a figure. Any SQL you produce must be SELECT-only and scoped to a single org_id -- emit the query, not the answer.
- Only propose a phrase_map candidate for a cluster with frequency >= 3 -- a single user's one-off is not a product signal.
- Every artifact you produce must cite the real gap_log ids it is based on.

Output STRICT JSON: {"artifacts": [<Artifact>, ...]} where each Artifact is one of:
  {"kind":"phrase_map_candidate","normalisedPhrase":string,"functionId":string,"fixedParams":object|null,"frequency":number}
  {"kind":"report_definition","title":string,"definition":object}
  {"kind":"capability_gap","description":string,"frequency":number}
  {"kind":"no_action","reason":string}`;

export const claudeCliProvider: AiProvider = {
  async classify(segments: string[], candidateFunctions: string[], context: ClassifyContext): Promise<ClassificationResult[]> {
    if (segments.length === 0) return [];
    const userMessage = JSON.stringify({ segments, candidateFunctions, context });
    const data = await callClaudeCliJson<{ results: ClassificationResult[] }>(CLASSIFY_SYSTEM_PROMPT, userMessage, ["results"]);
    if (!Array.isArray(data.results) || data.results.length !== segments.length) {
      throw new Error(`L1 (claude-cli) returned ${data.results?.length ?? 0} result(s) for ${segments.length} segment(s) -- expected exactly one per segment.`);
    }
    return data.results.map((r) => ({
      functionId: r.functionId ?? null,
      params: r.params ?? {},
      missingParams: Array.isArray(r.missingParams) ? r.missingParams : [],
      confidence: typeof r.confidence === "number" ? r.confidence : 0,
      unmappedIntent: r.unmappedIntent ?? null,
    }));
  },

  async analyse(batchInput: unknown): Promise<Artifact[]> {
    const data = await callClaudeCliJson<{ artifacts: Artifact[] }>(ANALYSE_SYSTEM_PROMPT, JSON.stringify(batchInput), ["artifacts"]);
    if (!Array.isArray(data.artifacts)) throw new Error("L2 (claude-cli) did not return an artifacts array.");
    return data.artifacts;
  },
};
