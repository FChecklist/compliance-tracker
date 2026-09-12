// R42 seq13 (M26/M27 P3) -- THE one narrow interface Levels 0-3 must go
// through. Levels 0/2/4 (segment.ts/classify.ts/validate.ts, seq11-12) never
// call this file. Only L1 (live, in-request) and L2 (nightly batch, seq15)
// do, and only through the two methods below -- nothing else, no streaming,
// no tool-use loops, no provider-specific options (M27).
//
// R80 Part 2 / W-ROUTER P1.1: provider resolution is now config-driven AND
// per-level (see provider-config.ts) rather than one process-wide branch --
//   AI_PROVIDER=claude-cli            <- global default, dev-phase (Rajat-only,
//                                        see the identity gate below)
//   AI_PROVIDER=openrouter            <- global default once set
//   AI_PROVIDER_PIPELINE_L1 / _L2     <- per-level override, takes precedence
//                                        over AI_PROVIDER for that level only
//   AI_ALLOWED_PROVIDERS              <- allowlist checked AFTER the above
//                                        resolves; an unlisted result throws,
//                                        it is never silently accepted
// Swapping providers, globally or per level, must be a config change, never
// a rewrite of anything that calls classify()/analyse().
//
// UNCHANGED BY THAT GENERALISATION: whichever level resolves to "claude-cli"
// still goes through the identity gate below, every time, unconditionally.
// That gate exists for a reason orthogonal to level/config plumbing -- see
// assertAiProviderAllowed's own comment.

import { NO_COMMENTARY_SENTENCE } from "./refusal";
import { resolveProviderForLevel, type AiProviderName } from "./provider-config";
import type { PipelineLevelRole } from "./level-model-registry";

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
export function assertAiProviderAllowedForSystemBatch(jobName: string, level: PipelineLevelRole = "pipeline_l2"): void {
  const provider = resolveProviderName(level);
  if (provider !== "claude-cli") return; // openrouter has no per-user restriction
  console.error(
    `[ai/adapter] provider "claude-cli" (level=${level}) refused system batch "${jobName}": a batch acts for every ` +
    `organisation at once, so no single permitted account exists. Configure openrouter for this level to run it.`
  );
  throw new AiProviderRefusalError(NO_COMMENTARY_SENTENCE);
}

export function assertAiProviderAllowed(userId: string, level: PipelineLevelRole = "pipeline_l1"): void {
  const provider = resolveProviderName(level);
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
      `[ai/adapter] provider "claude-cli" (level=${level}) refused a request from user "${userId}" (only "${allowed}" is permitted). Anthropic's Claude Code policy permits OAuth/subscription auth for ordinary individual use only -- never to serve a request on behalf of a different person. Configure openrouter (globally via AI_PROVIDER, or for just this level via AI_PROVIDER_${level.toUpperCase()}) before this product serves anyone other than that one account.`
    );
    throw new AiProviderRefusalError(NO_COMMENTARY_SENTENCE);
  }
}

function resolveProviderName(level: PipelineLevelRole): AiProviderName {
  return resolveProviderForLevel(level);
}

const cachedProviders = new Map<string, AiProvider>();

/**
 * Resolves the live AiProvider for one pipeline level (see provider-config.ts
 * for how AI_PROVIDER / AI_PROVIDER_<LEVEL> / AI_ALLOWED_PROVIDERS combine).
 * Defaults to "pipeline_l1" (the interactive, in-request level) when no
 * level is given, matching every production call site today.
 *
 * Callers MUST call assertAiProviderAllowed(userId, level) (or
 * assertAiProviderAllowedForSystemBatch(jobName, level) for L2) before
 * invoking anything on the returned provider, with the SAME level -- this
 * function itself does not know who is asking, only which provider is
 * configured for that level.
 */
export function getAiProvider(level: PipelineLevelRole = "pipeline_l1"): AiProvider {
  const name = resolveProviderName(level);
  const cacheKey = `${level}:${name}`;
  const cached = cachedProviders.get(cacheKey);
  if (cached) return cached;

  // Lazy require, not a static import -- providers/claude-cli.ts shells out
  // to a local binary that will never exist on Vercel; providers/openrouter.ts
  // needs an API key that a claude-cli-only deployment may not have set.
  // Neither module should be evaluated (and neither's env checks should run)
  // for the provider that isn't selected.
  let provider: AiProvider;
  if (name === "openrouter") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    provider = require("./providers/openrouter").openrouterProvider as AiProvider;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    provider = require("./providers/claude-cli").claudeCliProvider as AiProvider;
  }
  cachedProviders.set(cacheKey, provider);
  return provider;
}
