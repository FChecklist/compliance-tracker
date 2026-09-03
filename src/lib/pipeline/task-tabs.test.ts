import { describe, expect, test } from "bun:test";
import {
  PIPELINE_STATUSES,
  TASK_TAB_KEYS,
  resolveStatusFilter,
  tabCountsFrom,
  type StatusCountRow,
} from "./task-tabs";

describe("resolveStatusFilter -- the tab vocabulary", () => {
  test("no parameter means no filter, not an empty result set", () => {
    const f = resolveStatusFilter(null);
    expect(f.statuses).toEqual([]);
    expect(f.tab).toBeNull();
    expect(f.unknown).toEqual([]);
  });

  test("needs_you selects the three statuses nothing moves without a person", () => {
    const f = resolveStatusFilter("needs_you");
    expect(f.tab).toBe("needs_you");
    expect([...f.statuses].sort()).toEqual(["blocked", "to_do", "waiting"]);
  });

  test("approval is the SAME set as needs_you -- one list, two names", () => {
    expect([...resolveStatusFilter("approval").statuses].sort()).toEqual(
      [...resolveStatusFilter("needs_you").statuses].sort()
    );
  });

  test("queued is in_progress and done is done", () => {
    expect(resolveStatusFilter("queued").statuses).toEqual(["in_progress"]);
    expect(resolveStatusFilter("done").statuses).toEqual(["done"]);
  });

  test("every tab key resolves to at least one real status", () => {
    for (const key of TASK_TAB_KEYS) {
      const f = resolveStatusFilter(key);
      expect(f.statuses.length).toBeGreaterThan(0);
      for (const s of f.statuses) expect(PIPELINE_STATUSES).toContain(s);
    }
  });

  test("the raw statuses existing callers already send still work", () => {
    const f = resolveStatusFilter("to_do,blocked");
    expect([...f.statuses].sort()).toEqual(["blocked", "to_do"]);
    expect(f.tab).toBeNull();
  });

  // "done" is spelled the same in both vocabularies, and it means the same
  // thing in both -- so it resolves to the Completed tab AND to the raw
  // status, rather than one of the two arbitrarily winning.
  test("a word that is both a tab key and a status is not ambiguous", () => {
    const f = resolveStatusFilter("done");
    expect(f.statuses).toEqual(["done"]);
    expect(f.tab).toBe("done");
  });

  test("a misspelled filter is reported, never silently ignored", () => {
    const f = resolveStatusFilter("needs-you,done");
    expect(f.unknown).toEqual(["needs-you"]);
    expect(f.statuses).toEqual(["done"]);
  });

  test("duplicates across a tab and a raw status collapse to one condition", () => {
    const f = resolveStatusFilter("needs_you,to_do");
    expect(f.statuses.filter((s) => s === "to_do")).toHaveLength(1);
  });

  test("case and whitespace do not decide whether a filter works", () => {
    expect(resolveStatusFilter(" DONE ").statuses).toEqual(["done"]);
  });
});

describe("tabCountsFrom -- the numbers come from a grouped count, not a page", () => {
  const rows: StatusCountRow[] = [
    { status: "to_do", n: 3 },
    { status: "waiting", n: 2 },
    { status: "blocked", n: 4 },
    { status: "in_progress", n: 1 },
    { status: "done", n: 120 },
  ];

  test("the four legacy names keep their exact meaning", () => {
    const c = tabCountsFrom(rows);
    expect(c.needsYou).toBe(5);
    expect(c.running).toBe(1);
    expect(c.done).toBe(120);
    expect(c.blocked).toBe(4);
    expect(c.total).toBe(130);
  });

  test("a tab's number is the sum of exactly the statuses that tab asks for", () => {
    const c = tabCountsFrom(rows);
    for (const key of TASK_TAB_KEYS) {
      const statuses = resolveStatusFilter(key).statuses;
      const expected = statuses.reduce((sum, s) => sum + c.byStatus[s], 0);
      expect(c.tabs[key]).toBe(expected);
    }
  });

  test("done counts past the old fifty-row page", () => {
    // The whole point: the previous implementation counted rows.filter() over
    // a list capped at 50, so this number could never exceed 50.
    expect(tabCountsFrom(rows).tabs.done).toBe(120);
  });

  test("an unknown status contributes to the total and to no tab", () => {
    const c = tabCountsFrom([{ status: "archived", n: 7 }]);
    expect(c.total).toBe(7);
    expect(c.tabs.done).toBe(0);
    expect(c.needsYou).toBe(0);
  });

  test("a null status and a nonsense count cannot produce NaN", () => {
    const c = tabCountsFrom([{ status: null, n: Number.NaN }, { status: "done", n: -3 }]);
    expect(Number.isFinite(c.total)).toBe(true);
    expect(c.done).toBe(0);
  });

  test("no rows is zero everywhere, not an absent object", () => {
    const c = tabCountsFrom([]);
    expect(c.total).toBe(0);
    for (const key of TASK_TAB_KEYS) expect(c.tabs[key]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// R67 C-13 -- a failure nobody on site can fix is not "needs you".
// ---------------------------------------------------------------------------

describe("system failures leave the needs-you number", () => {
  const rows: StatusCountRow[] = [
    { status: "to_do", n: 3 },
    { status: "blocked", errorCode: "BOQ_LINE_REQUIRED", n: 2 },
    { status: "blocked", errorCode: "INFRA_UNAVAILABLE", n: 4 },
    { status: "done", n: 10 },
  ];

  test("needs_you counts the decisions, not the outages", () => {
    const c = tabCountsFrom(rows);
    // 3 to_do + 2 fixable blocked; the 4 infrastructure rows are not the
    // foreman's move.
    expect(c.tabs.needs_you).toBe(5);
    expect(c.tabs.approval).toBe(5);
  });

  test("they are REPORTED, not merely subtracted -- a number that only disappears cannot be audited", () => {
    const c = tabCountsFrom(rows);
    expect(c.systemBlocked).toBe(4);
    expect(c.blocked).toBe(6);
    expect(c.total).toBe(19);
  });

  test("BACKEND_UNAVAILABLE is the same fact under D-03's older name", () => {
    const c = tabCountsFrom([{ status: "blocked", errorCode: "BACKEND_UNAVAILABLE", n: 2 }]);
    expect(c.systemBlocked).toBe(2);
    expect(c.tabs.needs_you).toBe(0);
  });

  test("a blocked row with no code at all still needs someone -- it is not assumed to be an outage", () => {
    const c = tabCountsFrom([{ status: "blocked", errorCode: null, n: 2 }]);
    expect(c.systemBlocked).toBe(0);
    expect(c.tabs.needs_you).toBe(2);
  });

  test("the other tabs are untouched by the split", () => {
    const c = tabCountsFrom(rows);
    expect(c.tabs.done).toBe(10);
    expect(c.tabs.queued).toBe(0);
  });

  test("a tab count can never go negative, whatever the grouping says", () => {
    const c = tabCountsFrom([{ status: "blocked", errorCode: "INFRA_UNAVAILABLE", n: 5 }]);
    expect(c.tabs.needs_you).toBe(0);
  });
});
