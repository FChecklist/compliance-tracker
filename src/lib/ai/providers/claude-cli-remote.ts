// R80 Part 2 follow-up (2026-09-18, owner-directed) -- A THIRD, ADDITIVE
// AiProvider. Same subscription, same machine, same identity gate as
// providers/claude-cli.ts (that file's provider is never modified by this
// one existing) -- the only difference is transport: instead of spawning
// `claude -p` in the SAME process (impossible on Vercel, no binary), this
// one makes an HTTP call to a small bridge server running on the owner's
// own laptop (scripts/l1-remote-bridge.mjs), reached through a Cloudflare
// Tunnel while that laptop is on. The bridge server is the one that
// actually spawns `claude -p` locally -- this file only does the HTTP leg.
//
// WHY A THIRD PROVIDER NAME, NOT A FLAG ON THE EXISTING ONE: the owner's
// own instruction was "wire it in as just another route, so switching to
// the original plan can happen instantly" -- i.e. AI_PROVIDER_PIPELINE_L1
// flips between "claude-cli" (local dev machine), "claude-cli-remote"
// (production, tunnelled to the same subscription) and "openrouter"
// (the real deployable path) as a one-line env change, with zero code
// change and zero risk of the three modes' logic bleeding into each other.
//
// THE TOS REASONING IS IDENTICAL TO claude-cli.ts's, NOT WEAKENED: this is
// still "an individual Claude Code subscription," just reached over a
// tunnel instead of a local pipe. adapter.ts's assertAiProviderAllowed
// treats this provider name exactly like "claude-cli" -- refused for every
// user id except the one configured RAJAT_USER_ID, refused closed if that
// env var is unset. Nothing about tunnelling loosens that gate; it exists
// to answer "who does Anthropic's OAuth/subscription policy say this may
// serve," which does not change with where the process physically runs.
//
// L2 (system batch) is UNCHANGED and still refuses this provider name the
// same way it refuses "claude-cli" -- a nightly job iterating every org
// with activity has no single attributable identity, tunnel or not (see
// assertAiProviderAllowedForSystemBatch, adapter.ts).
import type { AiProvider, ClassificationResult, Artifact, ClassifyContext } from "../adapter";
import { CLASSIFY_SYSTEM_PROMPT, ANALYSE_SYSTEM_PROMPT } from "./claude-cli";

const REMOTE_TIMEOUT_MS = 65_000; // slightly above the bridge's own 60s claude-cli timeout, so the bridge's own error reaches us instead of a generic abort

function remoteUrl(): string {
  const url = process.env.CLAUDE_CLI_REMOTE_URL;
  if (!url) {
    throw new Error(
      "AI_PROVIDER(_PIPELINE_L1)=claude-cli-remote but CLAUDE_CLI_REMOTE_URL is not configured -- set it to the Cloudflare Tunnel URL fronting scripts/l1-remote-bridge.mjs on the owner's own machine."
    );
  }
  return url.replace(/\/$/, "");
}

function remoteSecret(): string {
  const secret = process.env.CLAUDE_CLI_REMOTE_SECRET;
  if (!secret) {
    throw new Error(
      "AI_PROVIDER(_PIPELINE_L1)=claude-cli-remote but CLAUDE_CLI_REMOTE_SECRET is not configured -- this bridge must never be reachable without a shared secret, since its tunnel URL is otherwise a public, unauthenticated path to the owner's own Claude Code subscription."
    );
  }
  return secret;
}

async function callBridgeJson<T>(systemPrompt: string, userMessage: string, expectedKeys: string[]): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${remoteUrl()}/run`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bridge-secret": remoteSecret() },
      body: JSON.stringify({ systemPrompt, userMessage, expectedKeys }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(
      `L1 (claude-cli-remote) could not reach the bridge (${err instanceof Error ? err.message : String(err)}). The owner's laptop may be closed, the bridge process may not be running, or the tunnel may be down.`
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`L1 (claude-cli-remote) bridge returned ${res.status}: ${body.slice(0, 500)}`);
  }
  const parsed = (await res.json()) as { ok: boolean; data?: unknown; error?: string };
  if (!parsed.ok) {
    throw new Error(`L1 (claude-cli-remote) bridge reported an error: ${parsed.error ?? "unknown"}`);
  }
  const data = parsed.data;
  const missing = expectedKeys.filter((key) => !(data && typeof data === "object" && key in (data as object)));
  if (missing.length > 0) {
    throw new Error(`claude CLI (remote) response is missing expected key(s): ${missing.join(", ")}`);
  }
  return data as T;
}

export const claudeCliRemoteProvider: AiProvider = {
  async classify(segments: string[], candidateFunctions: string[], context: ClassifyContext): Promise<ClassificationResult[]> {
    if (segments.length === 0) return [];
    const userMessage = JSON.stringify({ segments, candidateFunctions, context });
    const data = await callBridgeJson<{ results: ClassificationResult[] }>(CLASSIFY_SYSTEM_PROMPT, userMessage, ["results"]);
    if (!Array.isArray(data.results) || data.results.length !== segments.length) {
      throw new Error(
        `L1 (claude-cli-remote) returned ${data.results?.length ?? 0} result(s) for ${segments.length} segment(s) -- expected exactly one per segment.`
      );
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
    const data = await callBridgeJson<{ artifacts: Artifact[] }>(ANALYSE_SYSTEM_PROMPT, JSON.stringify(batchInput), ["artifacts"]);
    if (!Array.isArray(data.artifacts)) throw new Error("L2 (claude-cli-remote) did not return an artifacts array.");
    return data.artifacts;
  },
};
