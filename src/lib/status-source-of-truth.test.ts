/// <reference types="bun-types" />
// Unit tests for the pure computeStatusSourceOfTruth() function only --
// deliberately fixture-based (a small, hand-built MASTER-TRACKER.yaml /
// COMPLETED.yaml-shaped object), not the real files. The real files are
// large, actively edited by every session, and their exact item counts are
// not a stable thing to assert against in a test that should stay green
// regardless of how much real gap-closure work has happened since it was
// written. The fixture instead pins down the two behaviors that actually
// matter and would silently break the "always-current" guarantee if
// regressed: (1) ratified_do_not_build is excluded from the pending count,
// and (2) doer/auditor/verdict/date are extracted correctly from a
// COMPLETED.yaml entry shape. loadStatusSourceOfTruth() (the file-reading
// wrapper) is intentionally NOT unit-tested here -- it's a thin, three-line
// I/O shim around this function, and scripts/compute-status.ts's real run
// against the live files (pasted in this change's PR description) is the
// end-to-end proof that the wrapper and the real files' shape agree.
import { describe, expect, test } from "bun:test"
import { computeStatusSourceOfTruth } from "./status-source-of-truth"

describe("computeStatusSourceOfTruth -- open item counting", () => {
  test("counts owner_blocked + needs_owner_decision + real_gaps_not_yet_built, excludes ratified_do_not_build", () => {
    const masterTracker = {
      open_items: {
        owner_blocked: [{ id: "OPEN-01", name: "A", next_step: "Owner does X" }],
        needs_owner_decision: [
          { id: "OPEN-02", name: "B", recommendation: "Low priority" },
          { id: "OPEN-03", name: "C", recommendation: "Ratify DEC-03" },
        ],
        real_gaps_not_yet_built: [{ id: "GAP-01", name: "D", recommendation: "Design first", size: "deferred_large" }],
        // Three ratified decisions -- must NOT be counted as pending.
        ratified_do_not_build: [
          { id: "RATIFIED-01", decision: "Do not build X" },
          { id: "RATIFIED-02", decision: "Do not build Y" },
          { id: "RATIFIED-03", decision: "Do not build Z" },
        ],
      },
    }
    const completed = { entries: [] }

    const result = computeStatusSourceOfTruth(masterTracker, completed)

    expect(result.openBreakdown).toEqual({
      owner_blocked: 1,
      needs_owner_decision: 2,
      real_gaps_not_yet_built: 1,
    })
    expect(result.openCount).toBe(4) // 1 + 2 + 1, NOT 7 -- ratified_do_not_build excluded
    expect(result.ratifiedExcludedCount).toBe(3)
    expect(result.openItems).toHaveLength(4)
    expect(result.openItems.some((i) => i.id === "RATIFIED-01")).toBe(false)
  })

  test("missing open_items / missing subcategories default to zero, not a crash", () => {
    const result = computeStatusSourceOfTruth({}, {})
    expect(result.openCount).toBe(0)
    expect(result.closedCount).toBe(0)
    expect(result.percentComplete).toBe(0)
    expect(result.ratifiedExcludedCount).toBe(0)
  })

  test("owner_or_blocker extraction: owner_blocked uses next_step, falls back to detail", () => {
    const masterTracker = {
      open_items: {
        owner_blocked: [
          { id: "OPEN-01", name: "Has next_step", next_step: "Do the thing", detail: "ignored" },
          { id: "OPEN-02", name: "No next_step", detail: "Only detail available" },
        ],
        needs_owner_decision: [],
        real_gaps_not_yet_built: [],
      },
    }
    const result = computeStatusSourceOfTruth(masterTracker, { entries: [] })
    expect(result.openItems[0].owner_or_blocker).toBe("Do the thing")
    expect(result.openItems[1].owner_or_blocker).toBe("Only detail available")
  })
})

describe("computeStatusSourceOfTruth -- closed item doer/auditor extraction", () => {
  test("extracts doer agent, auditor agent, verdict, and doer date from a real COMPLETED.yaml entry shape", () => {
    const completed = {
      entries: [
        {
          id: "WAVE-158",
          title: "Mandatory task-tightening guardrail",
          doer: { agent: "claude-code", date: "2026-07-11", pr: "PENDING", summary: "..." },
          auditor: { agent: "zai", date: "2026-07-12", verdict: "pass-with-notes", summary: "..." },
        },
      ],
    }
    const result = computeStatusSourceOfTruth({}, completed)

    expect(result.closedCount).toBe(1)
    expect(result.closedItems[0]).toEqual({
      id: "WAVE-158",
      title: "Mandatory task-tightening guardrail",
      doer: "claude-code",
      auditor: "zai",
      verdict: "pass-with-notes",
      date: "2026-07-11",
    })
  })

  test("an entry with auditor PENDING (no agent/verdict yet) is still counted as closed, with null fields, not a crash", () => {
    const completed = {
      entries: [
        {
          id: "WAVE-159",
          title: "Some task",
          doer: { agent: "claude-code", date: "2026-07-11" },
          auditor: { agent: "PENDING", date: "PENDING", verdict: "PENDING" },
        },
      ],
    }
    const result = computeStatusSourceOfTruth({}, completed)
    expect(result.closedCount).toBe(1)
    // PENDING is a real string value here (the tracker's own placeholder
    // convention), not absent -- extraction should surface it as-is rather
    // than silently nulling it out, so a consumer can tell "no auditor
    // block at all" apart from "auditor block exists but says PENDING".
    expect(result.closedItems[0].auditor).toBe("PENDING")
    expect(result.closedItems[0].verdict).toBe("PENDING")
  })

  test("an entry missing the auditor block entirely extracts null, not a throw", () => {
    const completed = {
      entries: [{ id: "X", title: "Y", doer: { agent: "claude-code", date: "2026-07-11" } }],
    }
    const result = computeStatusSourceOfTruth({}, completed)
    expect(result.closedItems[0].auditor).toBeNull()
    expect(result.closedItems[0].verdict).toBeNull()
  })
})

describe("computeStatusSourceOfTruth -- percentComplete", () => {
  test("percentComplete = closedCount / (closedCount + openCount) * 100", () => {
    const masterTracker = {
      open_items: {
        owner_blocked: [{ id: "1" }, { id: "2" }, { id: "3" }],
        needs_owner_decision: [],
        real_gaps_not_yet_built: [],
      },
    }
    const completed = { entries: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }, { id: "f" }, { id: "g" }] }

    const result = computeStatusSourceOfTruth(masterTracker, completed)
    expect(result.openCount).toBe(3)
    expect(result.closedCount).toBe(7)
    expect(result.percentComplete).toBeCloseTo(70, 5) // 7 / (7+3) * 100
  })

  test("zero open and zero closed does not divide by zero", () => {
    const result = computeStatusSourceOfTruth({}, {})
    expect(result.percentComplete).toBe(0)
  })

  test("methodology disclaimer is always present and non-empty", () => {
    const result = computeStatusSourceOfTruth({}, {})
    expect(result.methodology.length).toBeGreaterThan(0)
    expect(result.methodology).toContain("STATUS-REPORT.md")
  })
})
