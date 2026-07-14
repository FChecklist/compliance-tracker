// EXPERIMENTAL SPIKE -- see ../page.tsx header comment for scope/removal.
//
// A minimal, self-contained BERT-style WordPiece tokenizer. Written by hand
// instead of pulling in a tokenizer package (e.g. @xenova/transformers, which
// bundles its own ~ONNX runtime and would defeat the point of measuring
// LiteRT.js's OWN footprint in isolation) because all-MiniLM-L6-v2's tflite
// export expects pre-tokenized `input_ids`/`attention_mask` tensors -- unlike
// the vision spike's image model, a text embeddings model cannot run on raw
// bytes. This implements the same algorithm as HuggingFace's
// `BertTokenizer`/Google's original `tokenization.py` (basic
// whitespace+punctuation splitting, lowercasing, then greedy longest-match
// WordPiece subword splitting against the model's own vocab), narrowed to
// what English sample sentences need for this sanity check -- it does not
// handle CJK character-by-character splitting or exotic Unicode
// normalization edge cases that don't come up here.

export const SPECIAL_TOKENS = {
  unk: "[UNK]",
  cls: "[CLS]",
  sep: "[SEP]",
  pad: "[PAD]",
} as const;

/** Parses a BERT-vocab `vocab.txt` (one token per line, index = line number). */
export function parseVocab(vocabText: string): Map<string, number> {
  const vocab = new Map<string, number>();
  const lines = vocabText.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const token = lines[i].replace(/\r$/, "");
    if (token.length > 0 || i < lines.length - 1) {
      vocab.set(token, i);
    }
  }
  return vocab;
}

// Unicode combining-diacritical-marks block (U+0300-U+036F). Written via
// numeric code points rather than a combining-mark regex escape, to sidestep this
// exact string surviving several layers of text processing intact -- codePointAt
// comparisons are equivalent and unambiguous either way.
const COMBINING_MARK_LOW = 0x0300;
const COMBINING_MARK_HIGH = 0x036f;

function stripCombiningMarks(s: string): string {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < COMBINING_MARK_LOW || cp > COMBINING_MARK_HIGH) out += ch;
  }
  return out;
}

// Matches BERT's `_is_punctuation`: ASCII punctuation ranges treated as
// individual tokens, plus the Unicode "P" (punctuation) general category for
// anything ASCII misses.
function isPunctuation(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  if ((cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) || (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126)) {
    return true;
  }
  return /\p{P}/u.test(ch);
}

/** Lowercase + accent-strip + whitespace/punctuation splitting (BERT's BasicTokenizer). */
function basicTokenize(text: string): string[] {
  const normalized = stripCombiningMarks(text.toLowerCase().normalize("NFD"));

  const tokens: string[] = [];
  let current = "";
  for (const ch of normalized) {
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else if (isPunctuation(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      tokens.push(ch);
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

/** Greedy longest-match-first WordPiece splitting of a single basic token. */
function wordpieceTokenize(token: string, vocab: Map<string, number>, maxInputCharsPerWord = 100): string[] {
  const chars = Array.from(token);
  if (chars.length > maxInputCharsPerWord) return [SPECIAL_TOKENS.unk];

  const outputTokens: string[] = [];
  let start = 0;
  while (start < chars.length) {
    let end = chars.length;
    let curSubstr: string | null = null;
    while (start < end) {
      let substr = chars.slice(start, end).join("");
      if (start > 0) substr = "##" + substr;
      if (vocab.has(substr)) {
        curSubstr = substr;
        break;
      }
      end--;
    }
    if (curSubstr === null) return [SPECIAL_TOKENS.unk];
    outputTokens.push(curSubstr);
    start = end;
  }
  return outputTokens;
}

export interface Encoded {
  inputIds: Int32Array;
  attentionMask: Int32Array;
  tokenTypeIds: Int32Array;
  /** Human-readable tokens actually produced, for debugging/display. */
  tokens: string[];
}

/**
 * Tokenizes `text` and pads/truncates to exactly `maxLen` positions (the
 * model's fixed sequence-length input, read from its own TensorDetails at
 * runtime -- see inference-worker.ts).
 *
 * Simplification stated plainly: if truncation to maxLen would cut off
 * before [SEP] is appended, this does not re-insert [SEP] at the boundary
 * (the standard approach reserves 2 slots up front). Not reached by this
 * spike's short sample sentences at the maxLen used, but would matter for
 * longer real input.
 */
export function encode(text: string, vocab: Map<string, number>, maxLen: number): Encoded {
  const wordpieces = basicTokenize(text).flatMap((t) => wordpieceTokenize(t, vocab));
  const tokens = [SPECIAL_TOKENS.cls, ...wordpieces, SPECIAL_TOKENS.sep].slice(0, maxLen);

  const unkId = vocab.get(SPECIAL_TOKENS.unk) ?? 0;
  const padId = vocab.get(SPECIAL_TOKENS.pad) ?? 0;

  const inputIds = new Int32Array(maxLen);
  const attentionMask = new Int32Array(maxLen);
  const tokenTypeIds = new Int32Array(maxLen); // single-segment input: all zeros

  for (let i = 0; i < maxLen; i++) {
    if (i < tokens.length) {
      inputIds[i] = vocab.get(tokens[i]) ?? unkId;
      attentionMask[i] = 1;
    } else {
      inputIds[i] = padId;
      attentionMask[i] = 0;
    }
  }

  return { inputIds, attentionMask, tokenTypeIds, tokens };
}
