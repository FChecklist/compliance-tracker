// R42 seq12 (M25/M26 P2) -- the L0 ladder. STILL NO AI: every tier here is
// deterministic software, $0 per M26's Level 0 definition. A miss escalates
// to L1 (seq13/14's AI adapter), never resolved here by guessing.
//
// Named `classifyL0` (not `classify`) deliberately -- M27's adapter also
// exposes a method literally called `classify()` (the L1 AI call,
// src/lib/ai/adapter.ts, seq13). Reusing the name across two very different
// mechanisms in the same codebase would be the exact kind of ambiguity this
// pipeline cannot afford an audit trail gap on.
//
// Repository interface (not a raw DB import) so this stays testable without
// a live database or withTenantContext mocking gymnastics -- callers wire
// `dbBackedL0Repo` (below) in production, tests wire a fake.

export type L0Repo = {
  /** EXACT match only (M26) -- normalisedPhrase must already be normalised by the caller. */
  findPhraseMapMatch(orgId: string, normalisedPhrase: string): Promise<{ functionId: string; fixedParams: Record<string, unknown> | null } | null>;
  /** Most recent task for this user in this org, for last-action recall. Null if none. */
  findLastTask(orgId: string, userId: string): Promise<{ functionId: string | null; params: Record<string, unknown> } | null>;
};

export type ClassificationResult =
  | { kind: "chat" }
  | { kind: "match"; functionId: string; params: Record<string, unknown>; source: "phrase_map" | "structural" | "last_action" }
  | { kind: "miss" };

// Tier 1: acknowledgement list -> CHAT. Closed set -- a message that is
// ONLY one of these (after trimming trailing punctuation) carries no
// actionable content and must never become a task (M25: "reads/questions
// never become tasks").
const ACKNOWLEDGEMENTS = new Set([
  "thanks", "thank you", "thanks a lot", "ty",
  "ok", "okay", "k", "kk",
  "cool", "great", "nice", "good", "perfect",
  "got it", "noted", "understood", "sure", "alright", "fine",
  "yes", "yep", "yeah", "no", "nope",
  "np", "no problem", "no problem thanks",
  "welcome", "you're welcome", "youre welcome",
]);

function normalisePhrase(text: string): string {
  return text.trim().toLowerCase().replace(/[.!?]+$/, "").replace(/\s+/g, " ");
}

function isAcknowledgement(text: string): boolean {
  return ACKNOWLEDGEMENTS.has(normalisePhrase(text));
}

// Tier 3: structural pattern -- an item code ANYWHERE in the segment,
// together with a percentage number, with no model involved. Same shape as
// segment.ts's ITEM_CODE_PATTERN (see that file's header for how it was
// measured) but unanchored, since here we're scanning a whole segment for a
// mention rather than checking a fragment's start.
const ITEM_CODE_TOKEN = /\b(?:[A-Za-z]{2,5}-){0,2}[A-Za-z]{0,4}\d{1,4}(?:\.\d{1,2})?(?:-[A-Za-z]{1,2})?\b/;
// NOTE: the trailing \b must sit inside the alternation, after "percent"
// only -- a \b immediately after a literal "%" never matches ("%" and the
// following space/end-of-string are both non-word characters, so there is
// no boundary between them), which silently broke every "NN%" input.
const PERCENT_TOKEN = /(\d{1,3}(?:\.\d{1,2})?)\s*(?:%|percent\b)/i;

// The one structural function this tier resolves to -- recording progress
// against a BOQ line by item code and percent. If a future structural
// pattern needs a second function, this becomes a small ordered list, not a
// rewrite.
const STRUCTURAL_FUNCTION_ID = "record_work_progress";

function tryStructuralMatch(text: string): { functionId: string; params: Record<string, unknown> } | null {
  const percentMatch = PERCENT_TOKEN.exec(text);
  if (!percentMatch) return null;
  const codeMatch = ITEM_CODE_TOKEN.exec(text);
  if (!codeMatch) return null;
  // The percent match must not itself have been consumed as part of the
  // "item code" token (a bare "50" before a "%" sign is the percent, not a
  // second item code) -- reject if they overlap.
  const codeStart = codeMatch.index;
  const codeEnd = codeStart + codeMatch[0].length;
  const percentStart = percentMatch.index;
  if (percentStart >= codeStart && percentStart < codeEnd) return null;
  const percent = Number(percentMatch[1]);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;
  return {
    functionId: STRUCTURAL_FUNCTION_ID,
    params: { itemCode: codeMatch[0], percent },
  };
}

// Tier 4: last-action recall -- a bare follow-up ("60% now", "same but 70")
// with a percent but NO item code reuses the user's most recently dispatched
// task's function_id + whatever context it carried (e.g. its itemCode),
// overriding only the new percent. Never invented from nothing -- if there
// is no prior task, this tier is a miss like any other.
async function tryLastActionRecall(
  text: string,
  repo: L0Repo,
  orgId: string,
  userId: string
): Promise<{ functionId: string; params: Record<string, unknown> } | null> {
  const percentMatch = PERCENT_TOKEN.exec(text);
  if (!percentMatch) return null;
  const percent = Number(percentMatch[1]);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;

  const last = await repo.findLastTask(orgId, userId);
  if (!last || !last.functionId) return null;

  return {
    functionId: last.functionId,
    params: { ...last.params, percent },
  };
}

/**
 * The L0 ladder. Stops at the FIRST hit -- order is the contract, not a
 * suggestion:
 *   1. acknowledgement list -> CHAT
 *   2. phrase_map EXACT hit
 *   3. structural pattern (item_code + number%)
 *   4. last-action recall
 *   5. miss -> caller escalates to L1 (never attempted here)
 */
export async function classifyL0(
  segmentText: string,
  ctx: { orgId: string; userId: string },
  repo: L0Repo
): Promise<ClassificationResult> {
  if (isAcknowledgement(segmentText)) return { kind: "chat" };

  const phraseHit = await repo.findPhraseMapMatch(ctx.orgId, normalisePhrase(segmentText));
  if (phraseHit) {
    return { kind: "match", functionId: phraseHit.functionId, params: phraseHit.fixedParams ?? {}, source: "phrase_map" };
  }

  const structural = tryStructuralMatch(segmentText);
  if (structural) {
    return { kind: "match", functionId: structural.functionId, params: structural.params, source: "structural" };
  }

  const recalled = await tryLastActionRecall(segmentText, repo, ctx.orgId, ctx.userId);
  if (recalled) {
    return { kind: "match", functionId: recalled.functionId, params: recalled.params, source: "last_action" };
  }

  return { kind: "miss" };
}

// A real L0Repo backed by withTenantContext/pipelineTasks/phraseMap is wired
// in seq14 (when /api/assistant is actually reworked to call this ladder) --
// that is the first point a live route needs one. Keeping this file's only
// dependency the L0Repo interface above is what makes classifyL0 testable
// with a plain fake, no DB or module-mocking required (see classify.test.ts).
