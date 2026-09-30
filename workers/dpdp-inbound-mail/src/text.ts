// Turns a parsed mail body into the plain-text excerpt the classifier reads.
//
// Only the first 4 KB is ever used (the classifier's keyword rules look at the
// subject plus that much text), so everything here is written to do bounded
// work on hostile input: a sender controls every byte of the mail, and this
// runs inside a Worker with a small CPU budget.
//
//   * htmlToPlainText is a single forward scan -- no backtracking regex over
//     the whole document -- and stops as soon as it has produced more text
//     than the excerpt can use. A pathological "<script" repeated a million
//     times therefore costs one pass, not a quadratic number of them.
//   * The whitespace regexes only ever see the first MAX_NORMALIZE_INPUT
//     characters.
//
// Honest limitation: this is a keyword-grade html-to-text, not a renderer. It
// drops script/style/head and comments, turns block tags into line breaks and
// decodes the common entities; it does not lay out tables, keep links, or
// understand CSS-hidden text. That is enough to read "please delete my data"
// out of a marketing-template reply, which is all the classifier needs.

/** Size of the text excerpt sent to the Edge Function, in UTF-8 bytes. */
export const TEXT_EXCERPT_BYTES = 4096

// The excerpt is 4 KB, so anything past the first ~16K characters cannot
// survive whitespace collapsing into it. Bounding the regex input keeps the
// worst case constant regardless of message size.
const MAX_NORMALIZE_INPUT = 16384
// Stop scanning html once this much text exists; 2x headroom over the excerpt
// so the whitespace collapse afterwards still has something to work with.
const MAX_HTML_OUTPUT = 8192

const SKIP_CONTENT = new Set(["script", "style", "head"])
const BLOCK_TAGS = new Set([
  "br", "p", "div", "tr", "li", "ul", "ol", "table", "blockquote", "hr", "section",
  "article", "header", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "pre",
])

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  ndash: "-", mdash: "-", hellip: "...", lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"',
  copy: "(c)", reg: "(R)", trade: "(TM)", bull: "*", middot: "*",
}

// ASCII-only lower-casing that preserves string length exactly, so an index
// found in the lower-cased copy is valid in the original. String#toLowerCase
// can change length for some Unicode characters (e.g. U+0130), which would
// misalign the two.
function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32))
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      const printable = Number.isFinite(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
      return printable ? String.fromCodePoint(code) : " "
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole
  })
}

export function htmlToPlainText(html: string): string {
  const lower = asciiLower(html)
  const n = html.length
  let out = ""
  let i = 0
  while (i < n && out.length < MAX_HTML_OUTPUT) {
    const lt = html.indexOf("<", i)
    if (lt === -1) {
      out += html.slice(i)
      break
    }
    out += html.slice(i, lt)

    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4)
      if (end === -1) break // unterminated comment: the rest is inside it
      i = end + 3
      continue
    }

    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)/.exec(html.slice(lt, lt + 40))
    if (!m) {
      out += "<" // "a < b", "<3": literal text, not a tag
      i = lt + 1
      continue
    }
    const closing = m[1] === "/"
    const name = m[2].toLowerCase()
    const gt = html.indexOf(">", lt)
    if (gt === -1) break // unterminated tag: drop the remainder

    if (!closing && SKIP_CONTENT.has(name)) {
      const close = lower.indexOf(`</${name}`, gt + 1)
      if (close === -1) break // never closed: everything after is its content
      const closeGt = html.indexOf(">", close)
      if (closeGt === -1) break
      i = closeGt + 1
      continue
    }

    // One line break per run of block tags, so "</p><p>" is not a blank line.
    if (BLOCK_TAGS.has(name)) {
      if (!out.endsWith("\n")) out += "\n"
    } else if (name === "td" || name === "th") out += " "
    i = gt + 1
  }
  return decodeEntities(out)
}

/** CRLF -> LF, control characters out, runs of blanks and blank lines collapsed, trimmed. */
export function normalizeText(s: string): string {
  return s
    .slice(0, MAX_NORMALIZE_INPUT)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8", { fatal: false })

/**
 * Cuts `s` to at most `maxBytes` of UTF-8 without splitting a character. A
 * byte-exact cut through a multi-byte sequence decodes to U+FFFD; those
 * trailing replacement characters are removed so the result is always
 * well-formed and never longer than the limit.
 */
export function capUtf8(s: string, maxBytes: number): string {
  const head = s.length > maxBytes ? s.slice(0, maxBytes) : s
  const bytes = encoder.encode(head)
  if (head.length === s.length && bytes.length <= maxBytes) return s
  return decoder.decode(bytes.subarray(0, maxBytes)).replace(/�+$/, "")
}

/** text/plain if the mail has one, else the tag-stripped html, cut to the excerpt size. */
export function extractExcerpt(parts: { text?: string | undefined; html?: string | undefined }): string {
  const plain = (parts.text ?? "").trim()
  const source = plain !== "" ? plain : parts.html ? htmlToPlainText(parts.html) : ""
  return capUtf8(normalizeText(source), TEXT_EXCERPT_BYTES)
}
