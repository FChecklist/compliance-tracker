// PROJEXA-BUILD-001 U-47a (register row BR-424). The text rules for a pasted proposal block, the same rules the
// Universal AI work link puts on text an AI writes through the link (ai-os/projexa-build-001/UNIVERSAL_AI_WORK_LINK_SPEC.md
// section 9.11): control characters are removed, a run of three or more backticks is replaced with two single quotes so
// the text cannot close a data fence, and a string longer than 2,000 characters is refused, never cut short silently.
//
// This is a LOCAL copy. The shared version is being built as src/lib/pipeline/ai-link-text (BR-583, another unit) and
// this file must be replaced by it once that unit has merged; the route and parsePasteBack() call only
// sanitisePastedParams() and sanitisePastedNote(), so the swap is one import.
//
// Two choices the spec leaves open, made here and written down so the swap can keep or change them on purpose:
//   - tab, line feed and carriage return are kept: a multi-line line-item description is ordinary text, and inside a
//     data fence a newline cannot carry an instruction the fence would not; every other control character (C0, DEL and
//     C1) is removed;
//   - every string anywhere in params is treated as free text (not only the ones the registry marks), because a
//     pasted block is untrusted input and the registry has no free-text marker on create_boq's line items.

/** The most characters one text value may hold after control characters are removed. */
export const TEXT_MAX_LENGTH = 2000;

/** How deep a params object may nest; a JSON body of 200 KB could otherwise nest far deeper than any BOQ. */
export const PARAMS_MAX_DEPTH = 32;

// C0 except tab (09), line feed (0A), carriage return (0D); DEL (7F); C1 (80 to 9F).
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const BACKTICK_RUN = /`{3,}/g;

/** One text value with control characters removed and every run of three or more backticks made two single quotes. */
export function cleanPastedText(text: string): string {
  return text.replace(CONTROL_CHARACTERS, "").replace(BACKTICK_RUN, "''");
}

export type SanitisedParams =
  | { ok: true; params: Record<string, unknown> }
  | { ok: false; reason: "text_too_long" | "params_too_deep"; path: string; detail: string };

/** A path such as `lineItems[2].description`, for the refusal detail. */
function childPath(parent: string, key: string | number): string {
  if (typeof key === "number") return `${parent}[${key}]`;
  return parent === "" ? key : `${parent}.${key}`;
}

/**
 * A copy of params in which every string is cleaned by cleanPastedText(), or the first string that is over
 * TEXT_MAX_LENGTH once cleaned (text_too_long, with its path and length, and nothing is cut). Numbers, booleans,
 * null and the shape of arrays and objects are returned as they came. The input object is not changed.
 */
export function sanitisePastedParams(params: Record<string, unknown>): SanitisedParams {
  let refusal: Extract<SanitisedParams, { ok: false }> | null = null;

  const walk = (value: unknown, path: string, depth: number): unknown => {
    if (refusal) return value;
    if (typeof value === "string") {
      const cleaned = cleanPastedText(value);
      if (cleaned.length > TEXT_MAX_LENGTH) {
        refusal = {
          ok: false,
          reason: "text_too_long",
          path,
          detail: `${path} is ${cleaned.length} characters; the limit is ${TEXT_MAX_LENGTH}`,
        };
        return value;
      }
      return cleaned;
    }
    if (typeof value !== "object" || value === null) return value;
    if (depth > PARAMS_MAX_DEPTH) {
      refusal = { ok: false, reason: "params_too_deep", path, detail: `${path || "params"} nests deeper than ${PARAMS_MAX_DEPTH} levels` };
      return value;
    }
    if (Array.isArray(value)) return value.map((item, index) => walk(item, childPath(path, index), depth + 1));
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) copy[key] = walk(item, childPath(path, key), depth + 1);
    return copy;
  };

  const cleaned = walk(params, "", 0);
  return refusal ?? { ok: true, params: cleaned as Record<string, unknown> };
}

/**
 * The optional note of a block: cleaned, trimmed, and kept to `maxLength` characters (a note is a label that travels
 * with the proposal, not a parameter, so it is cut to fit as it was before this file existed), or null when empty.
 */
export function sanitisePastedNote(note: unknown, maxLength: number): string | null {
  if (typeof note !== "string") return null;
  const cleaned = cleanPastedText(note).trim();
  return cleaned === "" ? null : cleaned.slice(0, maxLength);
}
