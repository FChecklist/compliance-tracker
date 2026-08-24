// R42 seq11 (M25's submission -> segmentation -> task pipeline, P1).
//
// PURE FUNCTION. No DB access, no model call, no UI concern -- deliberately
// the only piece of the pipeline testable in total isolation (M27's build
// order puts this first for exactly that reason). classify.ts (seq12) reads
// this module's output; it does not reach back into it.
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

// "then" / "and then" as a connector PHRASE (word-boundaried), not any
// substring containing "then" (must not fire inside "then" being part of a
// longer word, and must not fire on a bare trailing "then" with nothing
// after it).
//
// Whitespace runs are bounded (\s{1,20}, not \s+) -- CodeQL flagged the
// unbounded form as a polynomial-time ReDoS risk on attacker-controlled
// input (ai/adapter.ts's own concerns aside, rawInput here IS end-user
// text). 20 is far more than any real run of spaces a person would type;
// this changes worst-case behavior on pathological input, not real matches.
const THEN_CONNECTOR = /\s{1,20}(?:and\s{1,20}then|then)\s{1,20}/i;

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

export function segment(input: string): SegmentResult {
  const trimmedInput = input.trim();
  if (trimmedInput.length === 0) return { segments: [], flagged: false };

  let rawParts: string[];
  let orderingFromSplit = false;

  // 1. Newlines -- strongest signal. A numbered/bulleted list that also uses
  // real line breaks (the common case) has its "1. " / "- " markers
  // stripped here and gets an explicit orderingHint; a plain newline list
  // with no markers (e.g. "frame 01 50%\nrockwool 30%") carries no ordering
  // promise, matching the required fixture for that exact case.
  const lines = trimmedInput
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length > 1) {
    const anyLineNumbered = lines.some((l) => LEADING_MARKER.test(l));
    rawParts = lines.map((l) => l.replace(LEADING_MARKER, ""));
    orderingFromSplit = anyLineNumbered;
  } else if (BULLET_MARKER.test(trimmedInput) && trimmedInput.split(BULLET_MARKER).filter((p) => p.trim().length > 0).length > 1) {
    // 2. Bullets/numbering, still on one physical line (e.g. a site
    // engineer typing "1. approve VO-014 2. show the budget" with no line
    // breaks at all -- a real mobile-typing pattern).
    rawParts = trimmedInput
      .split(BULLET_MARKER)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    orderingFromSplit = true;
  } else if (trimmedInput.includes(";")) {
    // 3. Semicolons.
    const parts = trimmedInput
      .split(";")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    rawParts = parts.length > 1 ? parts : [trimmedInput];
  } else {
    // 4. '.'/'?'/'!' -- only where the next fragment looks actionable.
    const punctuationSplit = splitOnQualifyingSentencePunctuation(trimmedInput);
    if (punctuationSplit && punctuationSplit.length > 1) {
      rawParts = punctuationSplit;
    } else if (THEN_CONNECTOR.test(trimmedInput)) {
      // 5. "then" / "and then" -- weakest signal, but the one explicit
      // ordering connector besides numbering.
      rawParts = trimmedInput
        .split(THEN_CONNECTOR)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      orderingFromSplit = rawParts.length > 1;
      if (rawParts.length <= 1) rawParts = [trimmedInput];
    } else {
      // 6. Nothing split it. NEVER split on a bare "and" (M25) -- a message
      // like "frame 01 and frame 02 are done" or "frame 01 done and show me
      // the budget" has no syntactic marker separating its clauses, so it
      // stays one segment and classify.ts (seq12) decides, with real
      // semantics, whether it is actually one task or several.
      rawParts = [trimmedInput];
    }
  }

  const flagged = rawParts.length > MAX_SEGMENTS;
  const capped = rawParts.slice(0, MAX_SEGMENTS);

  const segments: Segment[] = capped.map((text, i) => ({
    text,
    ...(orderingFromSplit ? { orderingHint: i } : {}),
  }));

  return { segments, flagged };
}
