/// <reference types="bun-types" />
// R67 WS-A (A-07). The two halves of this service that decide what a user
// SEES -- the label and the tier order -- are pure, so they are asserted here
// with plain rows and a fixed clock rather than against a database. The DB
// glue (readRankedPills/recordPillUse) is three drizzle queries and an upsert
// whose behaviour is the UNIQUE (org_id, user_id, pill_key) index, not code;
// what is testable about it is the ordering it hands to rankPillEntries, and
// that is exactly what these tests pin.
import { describe, expect, test } from "bun:test"
import {
  MAX_PILL_KEY_LENGTH,
  PILL_WINDOW_DAYS,
  labelForPillKey,
  normaliseRecordedPillKey,
  rankPillEntries,
  recentLeafChains,
  splitChainText,
  type ChainHistoryEntry,
  type PillUsageRow,
} from "./projexa-pill-usage-service"

const NOW = new Date("2026-09-02T10:00:00.000Z")
const WINDOW_START = new Date(NOW.getTime() - PILL_WINDOW_DAYS * 86400000)

function row(over: Partial<PillUsageRow> & { pillKey: string }): PillUsageRow {
  return {
    functionId: null,
    derivedChain: null,
    useCount: 1,
    pinned: false,
    lastUsedAt: NOW,
    ...over,
  }
}

describe("labelForPillKey -- a client must never have to render a raw key", () => {
  test("the chain's last step wins: that IS the leaf the card id names", () => {
    expect(
      labelForPillKey("work-progress.entry", {
        root: "Cedar Heights Villa - Phase 1",
        steps: ["Work Progress", "Record progress"],
        full: "Cedar Heights Villa - Phase 1 > Work Progress > Record progress",
      })
    ).toBe("Record progress")
  })

  test("a single-step chain labels the module itself", () => {
    expect(labelForPillKey("permits", { steps: ["Permits"] })).toBe("Permits")
  })

  test("an already-human key is returned unchanged -- every R53 row is one", () => {
    // recordPillUse() in the pipeline writes chain.steps[0], so the historical
    // rows in this table have human keys and no work to do.
    expect(labelForPillKey("Work Progress")).toBe("Work Progress")
    expect(labelForPillKey("Minutes of Meeting", null)).toBe("Minutes of Meeting")
  })

  test("a dotted leaf id with no chain still produces words, not an id", () => {
    expect(labelForPillKey("permits.new")).toBe("Permits New")
    expect(labelForPillKey("minutes_of_meeting")).toBe("Minutes Of Meeting")
  })

  test("an acronym key keeps its case", () => {
    expect(labelForPillKey("WPR")).toBe("WPR")
  })

  test("it never returns an empty string -- a blank card looks like a missing one", () => {
    expect(labelForPillKey("")).toBe("Untitled")
    expect(labelForPillKey("   ", { steps: [] })).toBe("Untitled")
  })

  test("a malformed derived_chain degrades to the key rather than throwing", () => {
    expect(labelForPillKey("permits", { steps: "not-an-array" })).toBe("Permits")
    expect(labelForPillKey("permits", 42)).toBe("Permits")
    expect(labelForPillKey("permits", { steps: [1, 2] })).toBe("Permits")
  })
})

describe("rankPillEntries -- the three tiers, in M24's order", () => {
  test("pinned first at any age, then the window, then last-used-ever", () => {
    const ranked = rankPillEntries({
      pinned: [row({ pillKey: "Budget", pinned: true, lastUsedAt: new Date("2026-01-01T00:00:00.000Z") })],
      inWindow: [row({ pillKey: "Work Progress", useCount: 9 })],
      outsideWindow: [row({ pillKey: "Permits", lastUsedAt: new Date("2026-08-01T00:00:00.000Z") })],
      windowStart: WINDOW_START,
      limit: 6,
    })
    expect(ranked.map((p) => p.pillKey)).toEqual(["Budget", "Work Progress", "Permits"])
    expect(ranked.map((p) => p.tier)).toEqual(["pinned", "window", "last_used_ever"])
  })

  test("MP-RISK-3: a month-end pill outside the window still reaches the strip", () => {
    // Dropping the third tier is what makes work used heavily on the 30th
    // invisible from the 8th.
    const ranked = rankPillEntries({
      pinned: [],
      inWindow: [],
      outsideWindow: [row({ pillKey: "Run WPR", lastUsedAt: new Date("2026-07-31T00:00:00.000Z") })],
      windowStart: WINDOW_START,
      limit: 6,
    })
    expect(ranked.map((p) => p.pillKey)).toEqual(["Run WPR"])
  })

  test("a key appears exactly once, at its highest tier", () => {
    const ranked = rankPillEntries({
      pinned: [row({ pillKey: "Permits", pinned: true })],
      inWindow: [row({ pillKey: "Permits", useCount: 20 })],
      outsideWindow: [],
      windowStart: WINDOW_START,
      limit: 6,
    })
    expect(ranked).toHaveLength(1)
    expect(ranked[0].tier).toBe("pinned")
  })

  test("the limit is honoured, and it cuts from the bottom tier up", () => {
    const ranked = rankPillEntries({
      pinned: [row({ pillKey: "a", pinned: true })],
      inWindow: [row({ pillKey: "b" }), row({ pillKey: "c" })],
      outsideWindow: [row({ pillKey: "d", lastUsedAt: new Date("2026-01-01T00:00:00.000Z") })],
      windowStart: WINDOW_START,
      limit: 2,
    })
    expect(ranked.map((p) => p.pillKey)).toEqual(["a", "b"])
  })

  test("the tier boundary is the exact millisecond, not 'about a week'", () => {
    const onBoundary = rankPillEntries({
      pinned: [],
      inWindow: [row({ pillKey: "edge", lastUsedAt: WINDOW_START })],
      outsideWindow: [],
      windowStart: WINDOW_START,
      limit: 6,
    })
    expect(onBoundary[0].tier).toBe("window")

    const justOutside = rankPillEntries({
      pinned: [],
      inWindow: [],
      outsideWindow: [row({ pillKey: "edge", lastUsedAt: new Date(WINDOW_START.getTime() - 1) })],
      windowStart: WINDOW_START,
      limit: 6,
    })
    expect(justOutside[0].tier).toBe("last_used_ever")
  })

  test("every ranked entry carries a label, whatever the key looked like", () => {
    const ranked = rankPillEntries({
      pinned: [],
      inWindow: [
        row({ pillKey: "permits.new" }),
        row({ pillKey: "Work Progress" }),
        row({ pillKey: "x", derivedChain: { steps: ["Scope of Work", "Import BOQ"] } }),
      ],
      outsideWindow: [],
      windowStart: WINDOW_START,
      limit: 6,
    })
    expect(ranked.map((p) => p.label)).toEqual(["Permits New", "Work Progress", "Import BOQ"])
    expect(ranked.every((p) => p.label.trim().length > 0)).toBe(true)
  })

  test("nothing recorded yet is an empty strip, not an error", () => {
    expect(rankPillEntries({ pinned: [], inWindow: [], outsideWindow: [], windowStart: WINDOW_START, limit: 6 })).toEqual([])
  })
})

describe("normaliseRecordedPillKey -- what the write path will accept", () => {
  test("a leaf card id is accepted, which is the whole point of A-07", () => {
    expect(normaliseRecordedPillKey("work-progress.entry")).toBe("work-progress.entry")
    expect(normaliseRecordedPillKey("  permits.new  ")).toBe("permits.new")
  })

  test("a human module name is still accepted -- the pipeline writes those", () => {
    expect(normaliseRecordedPillKey("Work Progress")).toBe("Work Progress")
  })

  test("empty, blank, non-string and over-long keys are rejected", () => {
    expect(normaliseRecordedPillKey("")).toBeNull()
    expect(normaliseRecordedPillKey("   ")).toBeNull()
    expect(normaliseRecordedPillKey(null)).toBeNull()
    expect(normaliseRecordedPillKey(42)).toBeNull()
    expect(normaliseRecordedPillKey("x".repeat(MAX_PILL_KEY_LENGTH + 1))).toBeNull()
  })

  test("a key at the length limit is still accepted", () => {
    expect(normaliseRecordedPillKey("x".repeat(MAX_PILL_KEY_LENGTH))).toHaveLength(MAX_PILL_KEY_LENGTH)
  })

  test("control characters are rejected rather than stored unprintably", () => {
    expect(normaliseRecordedPillKey("permits\u0000new")).toBeNull()
    expect(normaliseRecordedPillKey("permits\nnew")).toBeNull()
  })
})

// ── R67 A-08 ────────────────────────────────────────────────────────────────
function chainRow(over: Partial<ChainHistoryEntry> & { fullChain: string }): ChainHistoryEntry {
  return {
    functionId: null,
    mode: "Projects",
    projectId: "p1",
    outcome: "ok",
    pinned: false,
    useCount: 1,
    lastUsedAt: NOW,
    ...over,
  }
}

describe("splitChainText", () => {
  test("splits the stored ' > ' form and trims", () => {
    expect(splitChainText("Cedar Heights Villa - Phase 1 > Work Progress > Record progress")).toEqual([
      "Cedar Heights Villa - Phase 1",
      "Work Progress",
      "Record progress",
    ])
  })

  test("an empty or separator-only chain yields nothing rather than blanks", () => {
    expect(splitChainText("")).toEqual([])
    expect(splitChainText(" > > ")).toEqual([])
  })
})

describe("recentLeafChains -- the three 'Do again' cards", () => {
  test("a chain that reaches a leaf becomes a card, labelled without the root", () => {
    const [card] = recentLeafChains(
      [chainRow({ fullChain: "Cedar Heights Villa - Phase 1 > Work Progress > Record progress" })],
      { now: NOW }
    )
    expect(card.label).toBe("Work Progress > Record progress")
    expect(card.steps).toEqual(["Work Progress", "Record progress"])
    expect(card.fullChain).toContain("Cedar Heights")
  })

  test("a chain that stops at the module is a PLACE, not something to do again", () => {
    expect(recentLeafChains([chainRow({ fullChain: "Cedar Heights > Permits" })], { now: NOW })).toEqual([])
  })

  test("only the last seven days count -- this is 'lately', not 'ever'", () => {
    const old = chainRow({
      fullChain: "Cedar Heights > Budget > Run",
      lastUsedAt: new Date(NOW.getTime() - 8 * 86400000),
    })
    const fresh = chainRow({ fullChain: "Cedar Heights > Work Progress > Record progress" })
    expect(recentLeafChains([old, fresh], { now: NOW }).map((c) => c.label)).toEqual([
      "Work Progress > Record progress",
    ])
  })

  test("ordered by use count, then by recency", () => {
    const rows = [
      chainRow({ fullChain: "P > A > x", useCount: 1, lastUsedAt: new Date(NOW.getTime() - 1000) }),
      chainRow({ fullChain: "P > B > y", useCount: 9 }),
      chainRow({ fullChain: "P > C > z", useCount: 1, lastUsedAt: NOW }),
    ]
    expect(recentLeafChains(rows, { now: NOW }).map((c) => c.label)).toEqual(["B > y", "C > z", "A > x"])
  })

  test("at most three, because band 3 has six slots and these take the front", () => {
    const rows = [1, 2, 3, 4, 5].map((n) => chainRow({ fullChain: `P > M${n} > L${n}`, useCount: 10 - n }))
    expect(recentLeafChains(rows, { now: NOW })).toHaveLength(3)
  })

  test("FAILED chains are kept -- the commonest reason to re-run is that it failed", () => {
    const failed = chainRow({ fullChain: "Cedar Heights > Work Progress > Record progress", outcome: "failed" })
    const [card] = recentLeafChains([failed], { now: NOW })
    expect(card.outcome).toBe("failed")
  })

  test("no history at all means no cards, not an error", () => {
    expect(recentLeafChains([], { now: NOW })).toEqual([])
  })
})
