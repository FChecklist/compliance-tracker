/// <reference types="bun-types" />
// WO-DPDP-013 v2 §4 item 6: the Copy-AI-link screen's pure text/formatting,
// pinned here so a wording slip fails `bun test` rather than being caught
// (or missed) in a screenshot review. No DOM, no browser -- bun has neither.
import { describe, expect, test } from "bun:test"
import { LEVEL1_EXPLANATION, LEVEL_LABEL, aiWorkLinkWarningSentence, formatEnInDate } from "./ai-work-link"

describe("aiWorkLinkWarningSentence -- WO-013 §1.1, byte-exact for given counts", () => {
  test("12 jobs, 5 people", () => {
    expect(aiWorkLinkWarningSentence({ jobs: 12, people: 5 })).toBe(
      "This link lets an AI assistant read your VERIDIAN view: 12 jobs and the names and emails of 5 people. When you paste it into an AI assistant, that information is sent to the company that runs it — for example, ChatGPT is run by a US company.",
    )
  })
  test("a single job, a single person -- no special-casing of the count 1", () => {
    expect(aiWorkLinkWarningSentence({ jobs: 1, people: 1 })).toBe(
      "This link lets an AI assistant read your VERIDIAN view: 1 jobs and the names and emails of 1 people. When you paste it into an AI assistant, that information is sent to the company that runs it — for example, ChatGPT is run by a US company.",
    )
  })
  test("names ChatGPT and \"a US company\" -- the WO's own example, verbatim", () => {
    expect(aiWorkLinkWarningSentence({ jobs: 0, people: 0 })).toContain("ChatGPT is run by a US company")
  })
  // FALSIFIABILITY (plant-then-revert, see PR body): temporarily changed the
  // literal string to drop "the names and emails of" -- both tests above
  // failed with a clear diff; reverted, `git diff` empty before commit.
})

describe("formatEnInDate -- dd Mon yyyy, read in UTC, no ICU/locale dependency", () => {
  test("24 Sep 2026", () => {
    expect(formatEnInDate("2026-09-24T00:00:00.000Z")).toBe("24 Sep 2026")
  })
  test("single-digit day is zero-padded", () => {
    expect(formatEnInDate("2027-01-01T23:59:00.000Z")).toBe("01 Jan 2027")
  })
  test("every month abbreviation is 3 letters (never localeswapped to a longer form)", () => {
    for (let m = 0; m < 12; m++) {
      const iso = new Date(Date.UTC(2026, m, 15)).toISOString()
      expect(formatEnInDate(iso)).toMatch(/^\d{2} [A-Z][a-z]{2} \d{4}$/)
    }
  })
})

describe("LEVEL_LABEL", () => {
  test("0 is read/analyse/report, 1 is small edits directly", () => {
    expect(LEVEL_LABEL[0]).toBe("Level 0 · Read, analyse, report")
    expect(LEVEL_LABEL[1]).toBe("Level 1 · Small edits, directly")
  })
})

describe("LEVEL1_EXPLANATION -- WO-013 §1.2's facts, in plain language", () => {
  test("names all four Level 1 verbs", () => {
    for (const verb of ["NOTE", "SET_DUE", "ASSIGN", "MARK_NA"]) expect(LEVEL1_EXPLANATION).toContain(verb)
  })
  test("the audit-label phrase is verbatim -- what History/the Monday email will literally say", () => {
    expect(LEVEL1_EXPLANATION).toContain("by <person> via AI assistant")
  })
  test("says the Monday email and the 24-hour undo window", () => {
    expect(LEVEL1_EXPLANATION).toMatch(/Monday email/)
    expect(LEVEL1_EXPLANATION).toMatch(/undone for 24 hours/)
  })
  test("says anything with legal weight is always a draft the person confirms themself", () => {
    expect(LEVEL1_EXPLANATION.toLowerCase()).toContain("never done directly")
    expect(LEVEL1_EXPLANATION.toLowerCase()).toContain("draft")
    expect(LEVEL1_EXPLANATION.toLowerCase()).toContain("confirmation link")
  })
})
