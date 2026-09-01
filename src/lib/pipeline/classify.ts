// R53 Phase 4 -- THE PER-SEGMENT VERDICT. TASK, CHAT or GAP.
//
// THE DEFECT THIS EXISTS TO KILL: every one of the 16 live
// compliance.submissions rows produced exactly ONE verdict for the WHOLE
// message. "PP1 is 50% done and show me the budget" recorded progress and
// silently dropped the budget read -- no task, no reply, no gap_log row.
// A SUBMISSION MAY PRODUCE A MIX, and nothing in a submission may vanish
// without leaving a record of why.
//
// PURE. No DB, no model, no I/O. Everything this needs about a function --
// whether running it WRITES -- is pre-resolved by the caller and passed in,
// the same pattern validate.ts uses, so the whole verdict table is testable
// with plain objects.
//
// THE RULES, IN ORDER, FIRST MATCH WINS (R53 Phase 4, verbatim):
//   resolves to a function that WRITES or produces an artifact -> TASK
//   resolves to a read-only function, or reads as a question    -> CHAT
//   imperative, resolves to nothing -> GAP: honest message + gap_log row
import { KNOWN_VERBS } from "./segment";

export type SegmentVerdict = "task" | "chat" | "gap";

export type ResolutionSource = "phrase_map" | "structural" | "last_action" | "level1";

/** What Level 0 or Level 1 resolved this segment to. Null when neither could. */
export type ResolvedFunction = {
  functionId: string;
  params: Record<string, unknown>;
  /** M26 PARTIAL: a valid function with a missing value is a FORM FIELD, not a gap. */
  missingParams?: string[];
  source: ResolutionSource;
  level: 0 | 1;
};

/**
 * The one fact about a function this file needs. Supplied by the caller
 * (executor.ts owns the real registry) rather than looked up here, so
 * classify() never imports a service, a DB client or a model adapter.
 */
export type FunctionNature = {
  /** true when running it WRITES or produces an artifact; false for a pure read. */
  writes: boolean;
};

export type ClassifyInput = {
  text: string;
  resolution: ResolvedFunction | null;
  /** null exactly when resolution is null. */
  nature: FunctionNature | null;
};

export type Classification = {
  verdict: SegmentVerdict;
  functionId: string | null;
  params: Record<string, unknown>;
  missingParams: string[];
  source: ResolutionSource | "none";
  level: 0 | 1 | null;
  /** Honest, user-facing sentence. Null only for a clean TASK with nothing to say. */
  message: string | null;
  /** gap_log.reason. Non-null if and only if verdict === "gap". */
  gapReason: string | null;
};

// A message that is ONLY an acknowledgement carries no actionable content
// and must never become a task, and must never become a GAP either -- there
// is no capability missing when someone says "thanks". Closed set.
//
// Lives here rather than in level0.ts because it is a CLASSIFICATION fact,
// not a lookup fact; level0.ts imports it from here so there is exactly one
// list, not two that drift.
const ACKNOWLEDGEMENTS = new Set([
  "thanks", "thank you", "thanks a lot", "ty",
  "ok", "okay", "k", "kk",
  "cool", "great", "nice", "good", "perfect",
  "got it", "noted", "understood", "sure", "alright", "fine",
  "yes", "yep", "yeah", "no", "nope",
  "np", "no problem", "no problem thanks",
  "welcome", "you're welcome", "youre welcome",
  "theek hai", "thik hai", "haan", "ha", "nahi", "shukriya", "dhanyavaad",
]);

export function normaliseForMatch(text: string): string {
  return text.trim().toLowerCase().replace(/[.!?]+$/, "").replace(/\s+/g, " ");
}

export function isAcknowledgement(text: string): boolean {
  return ACKNOWLEDGEMENTS.has(normaliseForMatch(text));
}

// Interrogative openers, English and the romanised Hindi this product's real
// users actually type (the segment.ts fixture corpus is mixed Hindi/English
// because the site engineers are). ONLY the FIRST word is consulted -- "PP1
// is 50% done" is a statement whose second word is "is", and reading that as
// a question would turn a progress record into a no-op.
const INTERROGATIVE_OPENERS = new Set([
  "how", "what", "when", "where", "why", "who", "whom", "whose", "which",
  "is", "are", "was", "were", "am", "do", "does", "did",
  "can", "could", "should", "shall", "will", "would", "may", "might",
  "has", "have", "had",
  "kya", "kaise", "kab", "kahan", "kaun", "kitna", "kitne", "kitni", "kyu", "kyun",
]);

/**
 * "Reads as a question" (R53 Phase 4). A trailing '?' or an interrogative
 * first word.
 *
 * *** A QUESTION NEVER BECOMES A TASK. *** This is a safety rule, not a
 * presentation one: "did PP1 reach 50%?" resolves to the same function as
 * "PP1 is 50% done", and executing the first would write a progress record
 * the user never asked for. R53 states the rule plainly -- "reads as a
 * question -> CHAT" -- and classify() applies it BEFORE the writes/reads
 * split so a write function can never be reached down the question path.
 */
export function isQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.endsWith("?")) return true;
  const firstWord = trimmed.split(/\s+/)[0].toLowerCase().replace(/[^a-z']/g, "");
  return INTERROGATIVE_OPENERS.has(firstWord);
}

/**
 * "Imperative" (R53 Phase 4) -- opens with a verb from M24's CLOSED set.
 * Deliberately not a general parts-of-speech guess: M24 closes the verb list
 * precisely so rules like this one are decidable rather than probabilistic.
 */
export function isImperative(text: string): boolean {
  const lower = text.trim().toLowerCase();
  if (lower.length === 0) return false;
  return KNOWN_VERBS.some((verb) => lower === verb || lower.startsWith(`${verb} `));
}

/**
 * The verdict for ONE segment. Never for a whole submission -- callers must
 * run this per segment and are free to get a different verdict for each.
 */
export function classifySegment(input: ClassifyInput): Classification {
  const { text, resolution, nature } = input;

  // ---- Nothing resolved -------------------------------------------------
  if (!resolution) {
    if (isAcknowledgement(text)) {
      // Not a gap. No capability is missing when someone says "thanks", and
      // logging it would pollute the promotion signal Phase 7 reads.
      return {
        verdict: "chat",
        functionId: null,
        params: {},
        missingParams: [],
        source: "none",
        level: null,
        message: null,
        gapReason: null,
      };
    }

    // R53 names the imperative case explicitly. Everything else that
    // resolved to nothing is ALSO logged as a gap, deliberately: silently
    // dropping unresolved text is precisely the class of defect this phase
    // exists to remove, and gap_log is the only place a missing capability
    // can ever be noticed. The reason records which kind it was, so Phase
    // 7's promotion pass can weight them differently if it ever needs to.
    const kind = isImperative(text) ? "imperative" : isQuestion(text) ? "question" : "statement";
    return {
      verdict: "gap",
      functionId: null,
      params: {},
      missingParams: [],
      source: "none",
      level: null,
      message: `I can't do that yet: "${text}"`,
      gapReason: `unresolved ${kind}: no Level 0 phrase match, no structural match, and Level 1 returned no function`,
    };
  }

  const missingParams = resolution.missingParams ?? [];
  const base = {
    functionId: resolution.functionId,
    params: resolution.params,
    missingParams,
    source: resolution.source,
    level: resolution.level,
    gapReason: null,
  } as const;

  // ---- Reads as a question -> CHAT, whatever the function does ----------
  if (isQuestion(text)) {
    const message = nature?.writes
      ? `Read as a question, so nothing was recorded. Say it as an instruction if you want "${resolution.functionId}" to run.`
      : null;
    return { ...base, verdict: "chat", message };
  }

  // ---- Writes or produces an artifact -> TASK ---------------------------
  if (nature?.writes) {
    return {
      ...base,
      verdict: "task",
      // M26 PARTIAL: ASK THE USER. A missing quantity is a form field, not a
      // gap, and must NOT escalate.
      message: missingParams.length > 0 ? `I need ${missingParams.join(", ")} before I can record that.` : null,
    };
  }

  // ---- Read-only function -> CHAT ---------------------------------------
  return {
    ...base,
    verdict: "chat",
    message: missingParams.length > 0 ? `I need ${missingParams.join(", ")} before I can look that up.` : null,
  };
}

// R65 Part D Phase 4 -- THE SUBMISSION-LEVEL DISCRIMINANT. CHAT_ONLY, TASK
// or MULTIPLE_TASKS.
//
// Distinct from BOTH existing submission-level facts:
//   - submissionStatusEnum (schema.ts) is an EXECUTION-OUTCOME ('done'/
//     'partial'/'failed'/...) -- it answers "what happened when this ran".
//   - This answers "how much executable work was requested", independent of
//     whether it succeeded. A submission whose one task FAILS is still
//     classification=TASK (one thing was asked for) with status=FAILED
//     (it didn't work) -- two different axes, never conflated.
//
// PURE. Takes the same per-segment verdict array classifySegment() already
// produces for every submission (R53 Phase 4) -- no new DB read, no new
// model call, no new I/O.
//
// SEMANTICS (R65 Part D directive §3, "gap" resolved per the Phase 0 report
// §4.3): count only 'task' verdicts -- a function that WRITES or produces
// an artifact (see classifySegment() above, the "writes or produces an
// artifact -> TASK" branch). 'chat' and 'gap' verdicts do not count, so:
//   - a pure question/acknowledgement submission (all 'chat')      -> CHAT_ONLY
//   - a submission the software could not resolve at all (all 'gap') -> CHAT_ONLY
//     (no work the software could determine how to do; the gap itself
//     stays separately visible via gap_log, never silently hidden by this
//     column -- see 0525's migration header)
//   - exactly one 'task' verdict                                    -> TASK
//   - more than one 'task' verdict                                  -> MULTIPLE_TASKS
// A 'chat' verdict alongside a 'task' verdict (classify.ts's own canonical
// example, "PP1 is 50% done and show me the budget") does NOT push this to
// MULTIPLE_TASKS -- only one executable action was requested; the budget
// read is informational, not a second unit of work.
export type SubmissionClassification = "CHAT_ONLY" | "TASK" | "MULTIPLE_TASKS";

export function classifySubmission(verdicts: SegmentVerdict[]): SubmissionClassification {
  const taskCount = verdicts.filter((v) => v === "task").length;
  if (taskCount === 0) return "CHAT_ONLY";
  if (taskCount === 1) return "TASK";
  return "MULTIPLE_TASKS";
}
