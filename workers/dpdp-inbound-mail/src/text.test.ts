// Unit tests for the body-to-excerpt helpers. Run from this directory: bun test

import { describe, expect, test } from "bun:test"

import { TEXT_EXCERPT_BYTES, capUtf8, extractExcerpt, htmlToPlainText, normalizeText } from "./text.ts"

const bytes = (s: string) => new TextEncoder().encode(s).length

describe("htmlToPlainText", () => {
  test("drops script, style and head content, keeps the visible text", () => {
    const html = "<html><head><title>t</title></head><body><style>a{}</style><p>Hello</p><script>x()</script>World</body></html>"
    expect(htmlToPlainText(html).replace(/\n+/g, " ").trim()).toBe("Hello World")
  })

  test("block tags become line breaks, cells become spaces", () => {
    expect(htmlToPlainText("<div>a</div><div>b</div>")).toBe("\na\nb\n")
    expect(htmlToPlainText("<table><tr><td>x</td><td>y</td></tr></table>").replace(/\s+/g, " ").trim()).toBe("x y")
  })

  test("decodes named, decimal and hex entities once (no double decoding)", () => {
    expect(htmlToPlainText("a&amp;b &lt;c&gt; &#8377;100 &#x20B9;200 &nbsp;z")).toBe("a&b <c> ₹100 ₹200  z")
    expect(htmlToPlainText("&amp;lt;")).toBe("&lt;")
    expect(htmlToPlainText("&notanentity; &#99999999;")).toContain("&notanentity;")
  })

  test("comments and a lone '<' are handled", () => {
    expect(htmlToPlainText("a<!-- hidden -->b")).toBe("ab")
    expect(htmlToPlainText("1 < 2 and <3")).toBe("1 < 2 and <3")
    expect(htmlToPlainText("visible<!-- never closed")).toBe("visible")
  })

  test("an unterminated tag or an unclosed <script> drops the rest instead of looping", () => {
    expect(htmlToPlainText("keep<b unterminated")).toBe("keep")
    expect(htmlToPlainText("keep<script>everything after is code")).toBe("keep")
  })

  test("hostile input is linear: 300k unclosed <script tags finish quickly", () => {
    const hostile = "<script ".repeat(37_500) + "tail"
    const started = performance.now()
    htmlToPlainText(hostile)
    expect(performance.now() - started).toBeLessThan(1000)
  })

  test("a huge document stops early once enough text exists", () => {
    const html = "<p>abcdefghij</p>".repeat(200_000)
    const started = performance.now()
    const out = htmlToPlainText(html)
    expect(performance.now() - started).toBeLessThan(1000)
    expect(out.length).toBeLessThan(20_000)
  })
})

describe("normalizeText", () => {
  test("normalises line endings, control characters and blank runs", () => {
    expect(normalizeText("a\r\nb\rc\u0000\u0007d")).toBe("a\nb\ncd")
    expect(normalizeText("a   b\t\tc")).toBe("a b c")
    expect(normalizeText("a\n\n\n\n\nb")).toBe("a\n\nb")
    expect(normalizeText("  \n hi \n  ")).toBe("hi")
  })
})

describe("capUtf8", () => {
  test("leaves short text alone", () => {
    expect(capUtf8("hello", 100)).toBe("hello")
  })

  test("cuts ASCII exactly at the limit", () => {
    expect(capUtf8("a".repeat(50), 10)).toBe("a".repeat(10))
  })

  test("never splits a multi-byte character and never exceeds the limit", () => {
    for (const max of [1, 2, 3, 4, 5, 7, 10, 4096]) {
      const out = capUtf8("मदद".repeat(2000), max)
      expect(bytes(out)).toBeLessThanOrEqual(max)
      expect(out).not.toContain("�")
    }
  })

  test("handles an emoji (surrogate pair) at the boundary", () => {
    const out = capUtf8("ab\u{1F600}cd", 3)
    expect(out).toBe("ab")
    expect(capUtf8("ab\u{1F600}cd", 6)).toBe("ab\u{1F600}")
  })

  test("text short in characters but long in bytes is still cut", () => {
    const s = "₹".repeat(2000) // 3 bytes each = 6000 bytes, 2000 chars
    expect(bytes(capUtf8(s, 4096))).toBeLessThanOrEqual(4096)
  })
})

describe("extractExcerpt", () => {
  test("prefers text/plain over html", () => {
    expect(extractExcerpt({ text: "plain", html: "<p>html</p>" })).toBe("plain")
  })

  test("falls back to html when there is no usable plain text", () => {
    expect(extractExcerpt({ text: "   \n", html: "<p>from html</p>" })).toBe("from html")
    expect(extractExcerpt({ html: "<p>only html</p>" })).toBe("only html")
  })

  test("empty when there is neither", () => {
    expect(extractExcerpt({})).toBe("")
  })

  test("never exceeds the excerpt size", () => {
    expect(bytes(extractExcerpt({ text: "word ".repeat(10_000) }))).toBeLessThanOrEqual(TEXT_EXCERPT_BYTES)
  })
})
