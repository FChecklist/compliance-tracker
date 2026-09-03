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
// R67 C-03, FIX PASS (decision D-11): the required-parameter facts come from
// lane B's function-registry, which is the one place in this repo that says
// what a function cannot run without. Lane C's own function-slots.ts declared
// the same facts a second time and has been deleted.
import { functionSpec, requiredParamSatisfied } from "./function-registry";

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
  | {
      kind: "match";
      functionId: string;
      params: Record<string, unknown>;
      source: "phrase_map" | "structural" | "last_action";
      /**
       * R67 C-03. M26 PARTIAL: "a valid function with a missing value is a
       * FORM FIELD, not a gap." A structural tier can now resolve a function
       * and still be short a slot ("log 3 hours today" has the hours and the
       * date but no task), and the caller must be able to ASK rather than
       * mint a task that can only fail. Absent means "nothing missing".
       */
      missingParams?: string[];
    }
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

// R67 C-03 -- Tier 3b: THE TIMESHEET PATTERN. Still no model, still $0.
//
// "log 3 hours on joinery drawings today" is the sentence Design Studio's own
// users type, and before this it had nowhere to land: record_timesheet did not
// exist, so the whole thing escalated to Level 1 (a paid model call) and came
// back a gap. The shape is as decidable as the progress pattern above -- a
// duration, a time-logging verb, and optionally a day -- so it belongs at
// Level 0 where it costs nothing.
//
// THE VERB IS REQUIRED, deliberately. "the slab took 3 hours to cure" contains
// a duration and is not a timesheet entry; demanding one of a closed list of
// logging verbs is what keeps this tier from writing hours nobody asked to
// log. Same posture as the rest of this file: match exactly, or do not match.
//
// FIX PASS -- THE TASK CLAUSE IS REQUIRED TOO, and this is the change that
// makes the tier safe. The verb list alone is broad enough that a plain
// observation trips it: "we spent 3 hrs waiting for the crane" has a duration
// and the verb "spent", so before this it resolved to record_timesheet with
// missingParams ["task"] -- a chat sentence promoted to a WRITE PROPOSAL at
// Level 0, ahead of last-action recall, with a hole in it. A timesheet entry
// is hours ON something; without the "on" clause naming that something there
// is no entry to propose, so the sentence falls through to Level 1 where a
// model can decide whether it was a question.
const HOURS_TOKEN = /(\d{1,2}(?:\.\d{1,2})?)\s*(?:h|hr|hrs|hour|hours)\b/i;
const TIME_LOG_VERB = /\b(log|logged|logging|spent|spend|worked|working|book|booked|booking)\b/i;
const ISO_DATE_TOKEN = /\b(\d{4}-\d{2}-\d{2})\b/;
const TIMESHEET_FUNCTION_ID = "record_timesheet";

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Exported for its unit test, which pins `now` rather than reading the clock. */
export function tryTimesheetMatch(
  text: string,
  now: Date
): { functionId: string; params: Record<string, unknown>; missingParams: string[] } | null {
  const hoursMatch = HOURS_TOKEN.exec(text);
  if (!hoursMatch) return null;
  if (!TIME_LOG_VERB.test(text)) return null;
  const hours = Number(hoursMatch[1]);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) return null;

  const params: Record<string, unknown> = { hours };

  const isoMatch = ISO_DATE_TOKEN.exec(text);
  if (isoMatch) {
    params.spentOn = isoMatch[1];
  } else if (/\byesterday\b/i.test(text)) {
    params.spentOn = isoDay(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  } else if (/\btoday\b/i.test(text)) {
    params.spentOn = isoDay(now);
  }

  // The task is what follows "on". Everything the pattern already consumed --
  // the duration, the day word, an explicit date -- is cut out first, so the
  // remainder is the words a person would use to name the task and nothing
  // else. NO "on" CLAUSE MEANS NO MATCH AT ALL -- see the header. Returning a
  // proposal with `task` missing is what turned "we spent 3 hrs waiting for
  // the crane" into a write proposal.
  const onIndex = text.toLowerCase().indexOf(" on ");
  if (onIndex < 0) return null;
  const task = text
    .slice(onIndex + 4)
    .replace(HOURS_TOKEN, " ")
    .replace(ISO_DATE_TOKEN, " ")
    .replace(/\b(today|yesterday)\b/gi, " ")
    .replace(/[.,;]+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (task.length === 0) return null;
  params.task = task;

  return { functionId: TIMESHEET_FUNCTION_ID, params, missingParams: timesheetMissingParams(params) };
}

/**
 * The declared required parameters this params object does not satisfy, minus
 * `projectId` -- Level 0 has no project context at all (the composer's top
 * rail supplies it downstream), so reporting it as missing here would ask the
 * user a question the screen has already answered.
 */
function timesheetMissingParams(params: Record<string, unknown>): string[] {
  const spec = functionSpec(TIMESHEET_FUNCTION_ID);
  if (!spec) return [];
  return spec.requiredParams
    .filter((p) => p.name !== "projectId" && !requiredParamSatisfied(p, params))
    .map((p) => p.name);
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
 *   3b. timesheet pattern (logging verb + duration)  [R67 C-03]
 *   4. last-action recall
 *   5. miss -> caller escalates to L1 (never attempted here)
 */
export async function classifyL0(
  segmentText: string,
  ctx: { orgId: string; userId: string; now?: Date },
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

  const timesheet = tryTimesheetMatch(segmentText, ctx.now ?? new Date());
  if (timesheet) {
    return {
      kind: "match",
      functionId: timesheet.functionId,
      params: timesheet.params,
      source: "structural",
      missingParams: timesheet.missingParams,
    };
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
