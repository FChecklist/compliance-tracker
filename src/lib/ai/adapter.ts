// R42 seq13 (M26/M27 P3) -- THE one narrow interface Levels 0-3 must go
// through. Levels 0/2/4 (segment.ts/classify.ts/validate.ts, seq11-12) never
// call this file. Only L1 (live, in-request) and L2 (nightly batch, seq15)
// do, and only through the two methods below -- nothing else, no streaming,
// no tool-use loops, no provider-specific options (M27).
//
// Provider is an ENV VAR, never a code branch a caller chooses:
//   AI_PROVIDER=claude-cli   <- today, Rajat-only (Anthropic policy: OAuth/
//                               subscription auth is for ordinary individual
//                               use only, never for serving a third party's
//                               request through it -- see assertAiProviderAllowed)
//   AI_PROVIDER=openrouter   <- required before ANY human other than Rajat
//                               touches this product (M27 tripwire)
// Swapping providers must be a config change, never a rewrite of anything
// that calls classify()/analyse().

import { NO_COMMENTARY_SENTENCE } from "./refusal";

export type ClassificationResult = {
  functionId: string | null;
  params: Record<string, unknown>;
  missingParams: string[];
  confidence: number; // 0-1
  unmappedIntent: string | null; // set on a genuine miss, for gap_log
};

export type Artifact =
  | { kind: "phrase_map_candidate"; normalisedPhrase: string; functionId: string; fixedParams: Record<string, unknown> | null; frequency: number }
  | { kind: "report_definition"; title: string; definition: Record<string, unknown> }
  | { kind: "capability_gap"; description: string; frequency: number }
  | { kind: "no_action"; reason: string };

export type ClassifyContext = {
  orgId: string;
  projectId?: string;
  /** e.g. valid boq_line_item_ids reachable in this context -- part of the bound candidate set, never left open (M26: "never 400 unbound functions"). */
  validIds?: Record<string, string[]>;
};

export interface AiProvider {
  /** L1 -- live, in-request. ONE call for ALL unresolved segments (M27: "3 segments cost the same as 1 and are 3x faster than 3 calls"). */
  classify(segments: string[], candidateFunctions: string[], context: ClassifyContext): Promise<ClassificationResult[]>;
  /** L2 -- nightly batch only. Never called in-request. */
  analyse(batchInput: unknown): Promise<Artifact[]>;
}

export class AiProviderRefusalError extends Error {}

// M27: "if AI_PROVIDER=claude-cli AND any authenticated user other than
// Rajat's user id is present, the app REFUSES to serve AI and logs it."
//
// RAJAT_USER_ID identifies the compliance.users row for the account Rajat
// personally tests this product through (democeo@projexa-ai.com / Demo
// Organization -- the identity this entire work order's own minted-session
// testing has used throughout, per its own protocol step 3). Configurable
// via env rather than hardcoded so a real identity change needs no code
// change, but the assertion below refuses closed (fails safe) if it is
// ever unset while AI_PROVIDER=claude-cli.
function rajatUserId(): string | null {
  return process.env.RAJAT_USER_ID ?? null;
}

/**
 * The SYSTEM-BATCH form of the assertion below. G-01b.
 *
 * L2 (src/lib/ai/batch/analyse.ts) has no requesting user, so it cannot call
 * assertAiProviderAllowed(userId) -- and its own comment used that as the
 * reason to call nothing at all, arguing that claude-cli "would still
 * correctly fail on a serverless runtime with no `claude` binary".
 *
 * THAT REASONING HOLDS FOR ENVIRONMENT 2 ONLY. Environment 1 is the owner's
 * laptop, where the binary DOES exist, and analyse() loops over every org
 * returned by gap_log_orgs_with_recent_activity() -- so on the one environment
 * currently declared live, the batch sent other organisations' data through a
 * personal Claude subscription with no gate in front of it. "No user to check"
 * is a reason the per-user gate does not fit, not a reason no gate applies.
 *
 * There is no "one permitted account" answer available to a batch job: it is
 * acting for every org at once. So under claude-cli this refuses outright,
 * which is also the honest description of the licence — an individual
 * subscription may not serve a request on behalf of a different person, and
 * every org in that loop is a different person. Set AI_PROVIDER=openrouter to
 * run L2.
 */
export function assertAiProviderAllowedForSystemBatch(jobName: string): void {
  const provider = resolveProviderName();
  if (provider !== "claude-cli") return; // openrouter has no per-user restriction
  console.error(
    `[ai/adapter] AI_PROVIDER=claude-cli refused system batch "${jobName}": a batch acts for every ` +
    `organisation at once, so no single permitted account exists. Set AI_PROVIDER=openrouter to run it.`
  );
  throw new AiProviderRefusalError(NO_COMMENTARY_SENTENCE);
}

export function assertAiProviderAllowed(userId: string): void {
  const provider = resolveProviderName();
  if (provider !== "claude-cli") return; // openrouter has no per-user restriction

  const allowed = rajatUserId();
  if (!allowed) {
    console.error(
      "[ai/adapter] AI_PROVIDER=claude-cli but RAJAT_USER_ID is not configured -- refusing to serve AI rather than silently guessing who is allowed to use it."
    );
    // R67 B-05: a refusal must never be a dead end. R66 recorded a user
    // being told "... not available for this account." with no next step,
    // for a question the database could answer perfectly well without a
    // model. Both refusals below now say what still works.
    throw new AiProviderRefusalError(NO_COMMENTARY_SENTENCE);
  }
  if (userId !== allowed) {
    console.error(
      `[ai/adapter] AI_PROVIDER=claude-cli refused a request from user "${userId}" (only "${allowed}" is permitted). Anthropic's Claude Code policy permits OAuth/subscription auth for ordinary individual use only -- never to serve a request on behalf of a different person. Set AI_PROVIDER=openrouter before this product serves anyone other than that one account.`
    );
    throw new AiProviderRefusalError(NO_COMMENTARY_SENTENCE);
  }
}

function resolveProviderName(): "claude-cli" | "openrouter" {
  const raw = process.env.AI_PROVIDER ?? "claude-cli";
  if (raw !== "claude-cli" && raw !== "openrouter") {
    throw new Error(`Unknown AI_PROVIDER "${raw}" -- must be "claude-cli" or "openrouter".`);
  }
  return raw;
}

let cachedProvider: AiProvider | null = null;
let cachedProviderName: string | null = null;

/**
 * Resolves the live AiProvider for the current AI_PROVIDER env var.
 *
 * Callers MUST call assertAiProviderAllowed(userId) before invoking anything
 * on the returned provider -- getAiProvider() itself does not know who is
 * asking, only which provider is configured.
 */
export function getAiProvider(): AiProvider {
  const name = resolveProviderName();
  if (cachedProvider && cachedProviderName === name) return cachedProvider;

  // Lazy require, not a static import -- providers/claude-cli.ts shells out
  // to a local binary that will never exist on Vercel; providers/openrouter.ts
  // needs an API key that a claude-cli-only deployment may not have set.
  // Neither module should be evaluated (and neither's env checks should run)
  // for the provider that isn't selected.
  if (name === "openrouter") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedProvider = require("./providers/openrouter").openrouterProvider as AiProvider;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedProvider = require("./providers/claude-cli").claudeCliProvider as AiProvider;
  }
  cachedProviderName = name;
  return cachedProvider;
}
