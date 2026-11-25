/// <reference types="bun-types" />
// The logo files: plain, valid, self-contained SVG. Words are real <text>; no script, no outside link, no raster image.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const APP = resolve(import.meta.dir, "../..")
const lockups = ["a", "b", "c"].map((k) => `brand/logo-options/option-${k}.svg`)
const marks = ["public/logo.svg", "public/logo-mark.svg", ...["a", "b", "c"].map((k) => `brand/logo-options/mark-${k}.svg`)]

/** A small well-formedness check: tags balance and attributes are quoted. */
function wellFormed(xml: string) {
  const stack: string[] = []
  for (const m of xml.matchAll(/<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g)) {
    if (m[4]) continue
    if (m[1]) expect(stack.pop()).toBe(m[2])
    else stack.push(m[2])
  }
  expect(stack).toEqual([])
  expect(xml.replace(/<[^<>]*>/g, "").replace(/<style>[\s\S]*?<\/style>/g, "")).not.toMatch(/[<>]/)
}
const rules = (rel: string) => {
  const s = readFileSync(join(APP, rel), "utf8")
  test(`${rel}: valid SVG, no script, no outside URL, no raster image`, () => {
    expect(s.trimStart().startsWith("<svg ")).toBe(true)
    expect(s.trimEnd().endsWith("</svg>")).toBe(true)
    wellFormed(s)
    expect(s).not.toMatch(/<script|javascript:|\son\w+=|<image|<foreignObject|data:image|\.png|\.jpe?g|\.gif|\.webp/i)
    expect(s.replace('xmlns="http://www.w3.org/2000/svg"', "")).not.toMatch(/https?:|\/\/|url\(\s*["']?(?!#)/i)
  })
  return s
}
describe("logo SVG files", () => {
  for (const rel of lockups) {
    const s = rules(rel)
    test(`${rel}: carries the name and the brand line, with the small y`, () => {
      expect(s).toContain(">VERIDIAN</text>")
      expect(s).toContain(">VERy INDIAN</text>")
    })
  }
  for (const rel of marks) rules(rel)
  test("the site's logo files are option C's mark (the one applied), kept in one place", () => {
    const a = readFileSync(join(APP, "brand/logo-options/mark-c.svg"), "utf8")
    expect(readFileSync(join(APP, "public/logo-mark.svg"), "utf8")).toBe(a)
    expect(readFileSync(join(APP, "public/logo.svg"), "utf8")).toBe(a)
  })
})
