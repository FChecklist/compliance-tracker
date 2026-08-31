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

import { isAcknowledgement, normaliseForMatch } from "./classify";

export type L0Repo = {
  /** EXACT match only (M26) -- normalisedPhrase must already be normalised by the caller. */
  findPhraseMapMatch(orgId: string, normalisedPhrase: string): Promise<{ functionId: string; fixedParams: Record<string, unknown> | null } | null>;
  /**
   * R53 Phase 6: LAST-ACTION RECALL COMES FROM compliance.pill_usage, not
   * from the task table. Two reasons, both real:
   *   - pill_usage is PER USER (its unique key is org+user+pill). The old
   *     read took the most recent pipeline_tasks row for the whole ORG, so
   *     one engineer typing "60% now" would silently inherit whatever a
   *     different engineer had just done. That is a wrong-write hazard, not
   *     a nicety.
   *   - it is the same row the pill strip ranks on, so "what I did last" has
   *     exactly one meaning in this product.
   * ONLY WRITE FUNCTIONS. A percent-only follow-up ("60% now") is a repeat
   * of an ACTION; recalling a read-only function here produces a report call
   * carrying a percentage, which is meaningless. Measured live 26 Aug 2026
   * before this filter existed.
   *
   * Null if this user has never run a write pill.
   */
  findLastPillUse(orgId: string, userId: string): Promise<{ functionId: string | null; params: Record<string, unknown> } | null>;
};

export type ClassificationResult =
  | { kind: "chat" }
  | { kind: "match"; functionId: string; params: Record<string, unknown>; source: "phrase_map" | "structural" | "last_action" }
  | { kind: "miss" };

// Tier 1: acknowledgement list -> CHAT. A message that is ONLY an
// acknowledgement carries no actionable content and must never become a
// task (M25: "reads/questions never become tasks").
//
// R53 Phase 4: the list and the normaliser now live in classify.ts and are
// imported here. They are CLASSIFICATION facts, not lookup facts, and a
// second copy of a closed set is how a closed set stops being closed.
const normalisePhrase = normaliseForMatch;

// Tier 3: structural pattern -- an item code ANYWHERE in the segment,
// together with a percentage number, with no model involved. Same shape as
// segment.ts's ITEM_CODE_PATTERN (see that file's header for how it was
// measured) but unanchored, since here we're scanning a whole segment for a
// mention rather than checking a fragment's start.
// TWO SHAPES, TRIED IN ORDER, because the live BOQ genuinely contains both
// and one pattern cannot cover them without also swallowing the percentage.
//
//   LETTER-LED   PP1 · F01 · M9 · M9-A · CDR-001 · HLW-BOQ-999 · ZZ-AUDIT1-999R
//                opens with a letter, contains at least one digit, and may
//                carry hyphenated parts. The lookahead is what makes
//                "frame" (no digit) not an item code.
//   NUMERIC      1.01 · 4.04 · 99 · 9
//                the bare/decimal codes measured on real rows.
//
// R53 FIX: the old single pattern could not match ZZ-AUDIT1-999R at all --
// it required the digits to sit within four letters of the start of a
// hyphen group. Live evidence: compliance.submissions igtnbo6sj5a2wsagy0fe4g7k
// ("ZZ-AUDIT1-999R 15% done") got NO structural match, fell through the
// ladder, and was resolved by last-action recall to a completely unrelated
// READ function. Both halves of that are fixed here.
const ITEM_CODE_LETTER_LED = /\b(?=[A-Za-z0-9-]*[0-9])[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*\b/;
const ITEM_CODE_NUMERIC = /\b\d{1,4}(?:\.\d{1,2})?\b/;
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
  const percent = Number(percentMatch[1]);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return null;

  // Cut the percentage out before looking for the code. The old version
  // searched the whole string and then rejected an overlap, which meant a
  // real code LATER in the sentence was never reached once the percent's own
  // digits matched first. Removing the percent makes the search
  // unambiguous instead of order-dependent.
  const withoutPercent =
    text.slice(0, percentMatch.index) + " ".repeat(percentMatch[0].length) + text.slice(percentMatch.index + percentMatch[0].length);

  const codeMatch = ITEM_CODE_LETTER_LED.exec(withoutPercent) ?? ITEM_CODE_NUMERIC.exec(withoutPercent);
  if (!codeMatch) return null;

  return {
    functionId: STRUCTURAL_FUNCTION_ID,
    params: { itemCode: codeMatch[0], percent },
  };
}

// Tier 4: last-action recall -- a bare follow-up ("60% now", "same but 70")
// with a percent but NO item code reuses THIS USER'S own most recent pill
// (its function_id and whatever context it carried, e.g. its itemCode),
// overriding only the new percent. Site work repeats; this is the tier that
// makes the second entry of the day cheap.
//
// Never invented from nothing -- if this user has no prior pill use, this
// tier is a miss like any other. NO FUZZY MATCHING anywhere in this file
// (M26): every tier either matches exactly or does not match.
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

  // *** ONLY A WRITE ACTION IS RECALLABLE. *** The repo filters to write
  // functions, and this is not a nicety: on 26 Aug a live run of
  // "ZZ-AUDIT1-999R 15% done" missed the structural tier, fell to this one,
  // and recalled the user's most recent pill -- which was the read-only
  // BUDGET function. It produced a budget lookup carrying percent=15, which
  // is not a wrong answer so much as a meaningless one. "60% now" is a
  // follow-up to an ACTION; there is no such thing as a follow-up to a
  // report.
  const last = await repo.findLastPillUse(orgId, userId);
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
