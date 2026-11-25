// Guard for the "१३९" mark (owner order, approved 25 Nov 2026): every page this
// repo produces carries exactly one .mark139 element and the approved CSS, unchanged.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = join(import.meta.dir, "..", "..")

const DIV_HTML = '<div class="mark139" lang="hi" aria-hidden="true"><span>१३९</span></div>'
const DIV_JSX = '<div className="mark139" lang="hi" aria-hidden="true"><span>१३९</span></div>'
const RULE_1 =
  '.mark139{position:absolute;top:0;left:0;right:0;margin:0;padding:1px 0 0;text-align:center;line-height:1;pointer-events:none;user-select:none;z-index:2147483647;font-family:"Noto Sans Devanagari","Mukta","Nirmala UI","Mangal","Kohinoor Devanagari","Devanagari Sangam MN",sans-serif;font-size:6px;font-weight:700;color:#0B2A6B}'
const RULE_2 = ".mark139 span{display:inline-block;border-bottom:.5px solid #7A1010;padding-bottom:.5px}"

const squash = (s: string) => s.replace(/\s*\n\s*/g, "")
const count = (s: string, needle: string) => s.split(needle).length - 1

// Static pages: every *.html except e-mail templates (not pages).
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage"])
const EMAIL_TEMPLATES = new Set(["supabase/auth-templates/magic-link.html", "supabase/functions/dpdp-auth-send-email/magic-link.html"])
function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith(".html")) out.push(relative(ROOT, p).split("\\").join("/"))
  }
}
const htmlPages: string[] = []
walk(ROOT, htmlPages)
const staticPages = htmlPages.filter((f) => !EMAIL_TEMPLATES.has(f)).sort()

// Pages built as strings in code (inline <style> carries the CSS in the same string).
const STRING_PAGES = [
  "dpdp-app/scripts/draft-content/render.mjs",
  "dpdp-app/src/lib/icp-prove.ts",
  "src/lib/report-export.ts",
  "src/app/api/veri-meetings/[id]/export/route.ts",
  "src/app/api/dpdp/task-link/[token]/route.ts", // two pages: error/ok page + confirm page
  "supabase/functions/projexa-oauth/handler.ts",
  "supabase/functions/dpdp-ai-link/render.ts",
  "supabase/functions/dpdp-ai-link/manual.ts",
]
const read = (f: string) => readFileSync(join(ROOT, f), "utf8")

describe("१३९ mark on every page", () => {
  test("finds the static pages", () => {
    expect(staticPages.length).toBeGreaterThan(100)
  })

  for (const f of staticPages) {
    test(`static page ${f}`, () => {
      const s = read(f)
      expect(count(s, 'class="mark139"')).toBe(1)
      expect(count(s, DIV_HTML)).toBe(1)
      const flat = squash(s)
      expect(count(flat, RULE_1)).toBe(1)
      expect(count(flat, RULE_2)).toBe(1)
      // first element of <body>
      const body = s.match(/<body[^>]*>\s*/i)
      expect(body).not.toBeNull()
      expect(s.slice(body!.index! + body![0].length).startsWith(DIV_HTML)).toBe(true)
    })
  }

  for (const f of STRING_PAGES) {
    test(`page built in code ${f}`, () => {
      const s = read(f)
      const pages = f.includes("task-link") ? 2 : 1
      expect(count(s, 'class="mark139"')).toBe(pages)
      expect(count(s, DIV_HTML)).toBe(pages)
      expect(count(squash(s), RULE_1)).toBe(pages)
      expect(count(squash(s), RULE_2)).toBe(pages)
    })
  }

  test("Next.js root layout renders the mark once, first in <body>; CSS once in globals.css", () => {
    const layout = read("src/app/layout.tsx")
    expect(count(layout, 'className="mark139"')).toBe(1)
    expect(count(layout, DIV_JSX)).toBe(1)
    const afterBody = layout.slice(layout.indexOf("<body"))
    const firstChild = afterBody.slice(afterBody.indexOf(">") + 1).trimStart()
    expect(firstChild.startsWith(DIV_JSX)).toBe(true)
    const css = squash(read("src/app/globals.css"))
    expect(count(css, RULE_1)).toBe(1)
    expect(count(css, RULE_2)).toBe(1)
  })

  test("Next.js global-error page carries the mark and its own CSS", () => {
    const s = read("src/app/global-error.tsx")
    expect(count(s, DIV_JSX)).toBe(1)
    expect(count(s, RULE_1)).toBe(1)
    expect(count(s, RULE_2)).toBe(1)
  })

  test("approved values are exactly as ordered", () => {
    expect(RULE_1).toContain("font-size:6px")
    expect(RULE_1).toContain("font-weight:700")
    expect(RULE_1).toContain("color:#0B2A6B")
    expect(RULE_2).toContain("border-bottom:.5px solid #7A1010")
    expect(RULE_2).toContain("padding-bottom:.5px")
    expect(DIV_HTML).toContain("१३९")
  })
})
