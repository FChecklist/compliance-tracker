import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { PROJEXA_BRIEFING, PROJEXA_BRIEFING_FACTS, withProjexaBriefing } from "./projexa-briefing"

describe("PROJEXA briefing every AI is told", () => {
  test("says the three facts: construction not financial, may add/edit/delete, works inside PROJEXA", () => {
    expect(PROJEXA_BRIEFING).toContain("construction project-management software")
    expect(PROJEXA_BRIEFING).toContain("not accounting or financial software")
    expect(PROJEXA_BRIEFING).toContain("create, edit, update, archive and delete")
    expect(PROJEXA_BRIEFING).toContain("Never write code")
  })
  test("goes in front of a prompt and keeps the prompt", () => {
    const out = withProjexaBriefing("MY PROMPT")
    expect(out.startsWith(PROJEXA_BRIEFING)).toBe(true)
    expect(out.endsWith("MY PROMPT")).toBe(true)
  })
  test("the outside AI's rules (Deno copy) carry the same facts", () => {
    const manual = readFileSync("supabase/functions/ai-work-link/manual.ts", "utf8")
    expect(manual).toContain("construction project-management software")
    expect(manual).toContain("not accounting or financial software")
    expect(manual).toContain("create, edit, update, archive and delete what the person asks for")
    expect(PROJEXA_BRIEFING_FACTS.length).toBe(3)
  })
})
