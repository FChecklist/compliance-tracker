// R42 seq11 (M25's submission -> segmentation -> task pipeline, P1).
//
// PURE FUNCTION. No DB access, no model call, no UI concern -- deliberately
// the only piece of the pipeline testable in total isolation (M27's build
// order puts this first for exactly that reason). classify.ts (seq12) reads
// this module's output; it does not reach back into it.
//
// R53 PHASE 3 AMENDMENT (26 Aug 2026). Two changes, both forced by live
// evidence, both stated here rather than buried in a diff:
//
//   (1) COORDINATING CONJUNCTIONS NOW SPLIT. The rule this file used to
//       state -- "NEVER split on a bare 'and'" -- produced a MEASURED
//       production defect. compliance.submissions rows
//       dug0ytanzzdoa7dve35hu99l and v9f7azoo3x5okh7v0jnpn2bk both read
//       "PP1 is 50% done and show me the budget" and both minted exactly
//       ONE pipeline_tasks row (record_work_progress). The budget half was
//       silently dropped -- no task, no chat reply, no gap_log row. Every
//       one of the 16 live submissions produced a single verdict for the
//       whole message. R53 supersedes the old rule and names the fixtures.
//
//       The split is GUARDED, not naive: a connector only splits when the
//       fragment AFTER it starts with a closed-set verb or a real item
//       code -- the same startsWithKnownVerbOrItemCode() test the sentence-
//       terminator tier already used. That is what keeps "the frame with
//       the blue and white trim" a single segment while
//       "PP1 is 50% done and show me the budget" becomes two.
//
//   (2) THE TIERS NOW CASCADE. They used to be mutually exclusive -- the
//       first marker that fired won and no later marker was consulted. R53
//       lists sentence terminators, conjunctions, semicolons, newlines and
//       bullets together, and a message that mixes two markers is the
//       common real case, not an exotic one. Each tier now runs over the
//       output of the one above it.
//
// Segmentation is a structural/typography question, not a semantic one --
// M27: "it's a regex answers it identically every time; a model answers
// ~97% identically with a silent unreproducible 3% -- that would be a
// DOWNGRADE, not a saving." This file must never call an LLM.
//
// ITEM_CODE_PATTERN is derived from a live measurement, not invented --
// queried `compliance.construction_boq_line_items.item_code` (24 Aug 2026)
// and grouped by digit-collapsed shape. Real shapes found, by frequency:
//   CDR-999 (30) | M9 / M9-A / M9-B / M9-C (27 each) | F99 (26) | P9 (26)
//   MVT-999 (20) | 9.99 (18, e.g. "1.01", "4.04") | BBC-999 (15)
//   MBC-999 (15) | HLW-BOQ-999 / RPS-BOQ-999 / EBP-BOQ-999 / MHA-BOQ-999 (12 each)
//   99 (11, bare numbers) | INT-999 / CIV-999 / ELE-999 / FIN-999 / PLB-999 (4 each)
//   9 (4, single-digit bare numbers)
// (A handful of rows -- SNAP-<epoch-ms>, F01-<epoch-ms> -- are leftover test
// junk from prior live-evidence sessions, not real item-code shapes; not
// modelled here.)

export type Segment = {
  /** The segment's own text, trimmed. */
  text: string;
  /**
   * Set only when this segment's position was derived from an explicit
   * sequencing marker (a numbered/bulleted list, or "then" / "and then").
   * 0-based, in submission order. Undefined when no explicit ordering signal
   * existed (e.g. a bare newline-separated list carries no promise about
   * which line must run first).
   */
  orderingHint?: number;
};

export type SegmentResult = {
  segments: Segment[];
  /**
   * True when the raw split produced more than MAX_SEGMENTS candidates.
   * `segments` is still capped at MAX_SEGMENTS (v5 P-1 territory: this is a
   * signal for classify.ts / the UI to tell the user to split their message,
   * not licence to silently process an unbounded fan-out of tasks from one
   * submission).
   */
  flagged: boolean;
};

export const MAX_SEGMENTS = 5;

// M24's closed verb set -- task names (and, here, segmentation's "does the
// next fragment start with an actionable word" check) may only ever use
// these. Deliberately not open to extension without an M24 amendment.
const KNOWN_VERBS = [
  "approve",
  "confirm",
  "sign off",
  "review",
  "import",
  "record",
  "show",
  "list",
  "create",
  "update",
  "delete",
  "check",
] as const;

// See the file header comment for how this was derived. Anchored to the
// START of a fragment (^) -- this only answers "does the text right after a
// candidate '.'/'?'/'!' look like it opens with an item code", never used to
// scan mid-string.
const ITEM_CODE_PATTERN =
  /^(?:[A-Za-z]{2,5}-){0,2}[A-Za-z]{0,4}\d{1,4}(?:\.\d{1,2})?(?:-[A-Za-z]{1,2})?\b/;

// Bullet/numbering markers this repo's real users type: "1.", "1)", "-", "*",
// "•". Requires at least one whitespace char after the marker so we don't
// misfire on "3.5mm" or "A-1 grade".
const BULLET_MARKER = /(?:^|\s)(?:\d{1,2}[.)]|[-*•])\s+/;

// Same marker, anchored to the START of an already-newline-split line, for
// stripping "1. " / "2) " / "- " prefixes off a numbered/bulleted list that
// happens to also use real line breaks (the common case -- most numbered
// lists a person types DO have line breaks; BULLET_MARKER above only covers
// the no-newlines variant).
const LEADING_MARKER = /^(?:\d{1,2}[.)]|[-*•])\s+/;

// R53: the coordinating-conjunction connector set -- and / then / also /
// plus, plus the two-word forms "and then" and "and also". Matched as
// PHRASES surrounded by real whitespace, never as substrings, so this can
// never fire inside a longer word ("thence", "android", "surplus") and
// never on a trailing connector with nothing after it.
//
// Whitespace runs are bounded (\s{1,20}, not \s+) -- CodeQL flagged the
// unbounded form as a polynomial-time ReDoS risk on attacker-controlled
// input (ai/adapter.ts's own concerns aside, rawInput here IS end-user
// text). 20 is far more than any real run of spaces a person would type;
// this changes worst-case behavior on pathological input, not real matches.
//
// ORDER MATTERS IN THE ALTERNATION: the two-word forms come first, so
// "and then" is consumed whole rather than matching a bare "and" and
// leaving "then" stranded at the head of the next fragment.
const CONJUNCTION_CONNECTOR = /\s{1,20}(and\s{1,20}then|and\s{1,20}also|and|then|also|plus)\s{1,20}/gi;

// Only "then" / "and then" promise an ORDER. A bare "and" / "also" / "plus"
// coordinates two things without saying either must run first, so it gets
// no orderingHint -- and therefore no depends_on downstream. This matters:
// "PP1 is 50% done and show me the budget" must NOT make the budget read
// wait on (or be blocked by) the progress write. R53 Phase 6 is explicit --
// depends_on ONLY when a later segment needs an earlier one's artifact.
const ORDER_PROMISING_CONNECTOR = /then/i;

function startsWithKnownVerbOrItemCode(fragment: string): boolean {
  const trimmed = fragment.trimStart();
  if (trimmed.length === 0) return false;
  const lower = trimmed.toLowerCase();
  if (KNOWN_VERBS.some((verb) => lower.startsWith(verb))) return true;
  return ITEM_CODE_PATTERN.test(trimmed);
}

function splitOnQualifyingSentencePunctuation(input: string): string[] | null {
  // Walk the string looking for '.', '?', or '!' where the text that follows
  // (after skipping the punctuation and any whitespace) starts with a known
  // verb or an item code. A '.' that is part of a decimal item code (e.g.
  // "1.01") or an ordinary abbreviation never qualifies, because what
  // follows it won't start with a verb/item-code token at a fragment
  // boundary in the way this checks.
  const boundaries: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch !== "." && ch !== "?" && ch !== "!") continue;
    // A '.' flanked by digits on both sides is a decimal point (a BOQ item
    // code like "1.01", or any plain decimal number), never a sentence
    // boundary -- this must be excluded before the verb/item-code lookahead
    // even runs, or "item 1.01 is..." misreads "01 is..." as if "01" were
    // itself a fresh item-code fragment starting a new sentence.
    if (ch === "." && /\d/.test(input[i - 1] ?? "") && /\d/.test(input[i + 1] ?? "")) continue;
    const rest = input.slice(i + 1);
    if (startsWithKnownVerbOrItemCode(rest)) boundaries.push(i);
  }
  if (boundaries.length === 0) return null;

  const parts: string[] = [];
  let start = 0;
  for (const b of boundaries) {
    parts.push(input.slice(start, b + 1));
    start = b + 1;
  }
  parts.push(input.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

// R53: split a fragment on qualifying coordinating conjunctions. GUARDED --
// a connector only becomes a boundary when the text AFTER it starts with a
// closed-set verb or a real item code, the same test the sentence-terminator
// tier uses. That guard is the whole safety of this tier:
//
//   "PP1 is 50% done and show me the budget"    -> "show" is a verb  -> SPLIT
//   "approve VO-014 and confirm VO-015"          -> "confirm"         -> SPLIT
//   "the frame with the blue and white trim"     -> "white"           -> no split
//   "frame 01 and frame 02 are done"             -> "frame 02..."     -> no split
//
// Returns null when nothing qualified, so the caller can keep the fragment
// byte-for-byte rather than round-tripping it through a split/join.
function splitOnQualifyingConjunctions(input: string): { parts: string[]; ordered: boolean } | null {
  // Fresh regex per call: CONJUNCTION_CONNECTOR carries /g, so a shared
  // instance would leak lastIndex between calls and silently skip matches
  // on every other input.
  const re = new RegExp(CONJUNCTION_CONNECTOR.source, "gi");
  const parts: string[] = [];
  let ordered = false;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    const after = input.slice(m.index + m[0].length);
    if (!startsWithKnownVerbOrItemCode(after)) continue;
    const before = input.slice(last, m.index).trim();
    // A connector with nothing meaningful before it is not a boundary --
    // it is a fragment that merely opens with one.
    if (before.length === 0) continue;
    parts.push(before);
    if (ORDER_PROMISING_CONNECTOR.test(m[1])) ordered = true;
    last = m.index + m[0].length;
  }
  if (parts.length === 0) return null;
  const tail = input.slice(last).trim();
  if (tail.length > 0) parts.push(tail);
  return parts.length > 1 ? { parts, ordered } : null;
}

function splitOnSemicolons(input: string): string[] | null {
  if (!input.includes(";")) return null;
  const parts = input
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts.length > 1 ? parts : null;
}

/**
 * R53 Phase 3. THE TIERS CASCADE -- each runs over the output of the one
 * above it, in descending strength of the structural signal:
 *
 *   1. newlines, or bullet/number markers on one physical line
 *   2. semicolons
 *   3. '.' / '?' / '!' where the next fragment looks actionable
 *   4. coordinating conjunctions where the next fragment looks actionable
 *
 * PURE. No DB, no model, no I/O -- the zero-network guarantee this file's
 * tests assert is a property of the code, not of how it happens to be called.
 */
export function segment(input: string): SegmentResult {
  const trimmedInput = input.trim();
  if (trimmedInput.length === 0) return { segments: [], flagged: false };

  // `ordered` is set by ANY tier that carries a real ordering promise (a
  // numbered/bulleted list, or "then"/"and then"). It is deliberately a
  // single flag for the whole submission rather than per-segment: a message
  // that states an order anywhere states it for the sequence as a whole,
  // and half-ordered segment lists are not something depends_on can express.
  let ordered = false;

  // TIER 1 -- newlines are the strongest signal. A numbered/bulleted list
  // that also uses real line breaks (the common case) has its "1. " / "- "
  // markers stripped here and gains an ordering promise; a plain newline
  // list with no markers ("frame 01 50%\nrockwool 30%") promises nothing
  // about which line runs first.
  let parts: string[];
  const lines = trimmedInput
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length > 1) {
    if (lines.some((l) => LEADING_MARKER.test(l))) ordered = true;
    parts = lines.map((l) => l.replace(LEADING_MARKER, ""));
  } else if (BULLET_MARKER.test(trimmedInput) && trimmedInput.split(BULLET_MARKER).filter((p) => p.trim().length > 0).length > 1) {
    // Bullets/numbering still on one physical line -- a site engineer
    // typing "1. approve VO-014 2. show the budget" with no line breaks at
    // all is a real mobile-typing pattern, not a hypothetical.
    parts = trimmedInput
      .split(BULLET_MARKER)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    ordered = true;
  } else {
    parts = [trimmedInput];
  }

  // TIER 2 -- semicolons, inside each part.
  parts = parts.flatMap((p) => splitOnSemicolons(p) ?? [p]);

  // TIER 3 -- sentence terminators, inside each part.
  parts = parts.flatMap((p) => {
    const split = splitOnQualifyingSentencePunctuation(p);
    return split && split.length > 1 ? split : [p];
  });

  // TIER 4 -- coordinating conjunctions, inside each part. This is the tier
  // R53 added; everything above it predates R53 and is unchanged in behaviour.
  parts = parts.flatMap((p) => {
    const split = splitOnQualifyingConjunctions(p);
    if (!split) return [p];
    if (split.ordered) ordered = true;
    return split.parts;
  });

  const flagged = parts.length > MAX_SEGMENTS;
  const capped = parts.slice(0, MAX_SEGMENTS);

  const segments: Segment[] = capped.map((text, i) => ({
    text,
    ...(ordered ? { orderingHint: i } : {}),
  }));

  return { segments, flagged };
}

/**
 * R53 Phase 3: "A segment that fails alone is re-joined with its neighbour
 * ONCE and retried."
 *
 * Splitting is a guess about structure. When a segment resolves to nothing
 * on its own, the likeliest cause is that the split took a subject away from
 * it -- "and show me the budget" for PP1 makes sense; "show me the budget"
 * with no project context may not. Re-joining once recovers that case
 * without reopening the door to unbounded retry.
 *
 * PREVIOUS neighbour first, because a fragment almost always loses its
 * subject to the LEFT; falls back to the next neighbour for index 0. Returns
 * null when there is no neighbour to join -- a single segment that failed
 * has already been tried whole, and retrying it unchanged would be a loop.
 *
 * PURE, like everything else here: it returns the candidate text and says
 * which sibling it absorbed. It does not retry anything itself -- the
 * caller owns the ONCE.
 */
export function rejoinCandidate(
  segments: readonly Segment[],
  index: number
): { text: string; absorbedIndex: number } | null {
  if (index < 0 || index >= segments.length) return null;
  if (segments.length < 2) return null;
  if (index > 0) {
    return { text: `${segments[index - 1].text} ${segments[index].text}`.trim(), absorbedIndex: index - 1 };
  }
  return { text: `${segments[index].text} ${segments[index + 1].text}`.trim(), absorbedIndex: index + 1 };
}
