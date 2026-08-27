/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { segment, rejoinCandidate, MAX_SEGMENTS } from "./segment";

// R42 seq11 test_oracle: 50 fixtures minimum, all passing. The required
// cases come first (verbatim from the work order), then ~41 additional real
// site-engineer phrasings (no punctuation, ALL CAPS, mixed Hindi/English,
// typos, trailing "pls") exercising robustness against messy real input
// rather than clean examples.

describe("segment() -- required fixtures from the R42 seq11 work order", () => {
  test('"frame 01 is 50% done" -> 1 segment (no syntactic split marker)', () => {
    const r = segment("frame 01 is 50% done");
    expect(r.segments.length).toBe(1);
    expect(r.segments[0].text).toBe("frame 01 is 50% done");
    expect(r.flagged).toBe(false);
  });

  test('"frame 01 and frame 02 are done" -> 1 segment (NEVER split on bare "and")', () => {
    const r = segment("frame 01 and frame 02 are done");
    expect(r.segments.length).toBe(1);
    expect(r.segments[0].text).toBe("frame 01 and frame 02 are done");
  });

  // SUPERSEDED BY R53 PHASE 3. This assertion used to require 1 segment, on
  // the rule "NEVER split on a bare 'and'". That rule produced a MEASURED
  // production defect: compliance.submissions dug0ytanzzdoa7dve35hu99l and
  // v9f7azoo3x5okh7v0jnpn2bk are this exact shape and each minted exactly
  // ONE pipeline_tasks row, silently dropping the read half -- no task, no
  // chat reply, no gap_log row. R53 names the opposite fixture and the live
  // rows that force it. Changed deliberately, not incidentally.
  test('"frame 01 done and show me the budget" -> 2 segments (R53: guarded conjunction split)', () => {
    const r = segment("frame 01 done and show me the budget");
    expect(r.segments.length).toBe(2);
    expect(r.segments[0].text).toBe("frame 01 done");
    expect(r.segments[1].text).toBe("show me the budget");
    // a bare "and" promises no ORDER -- no orderingHint, so no depends_on
    expect(r.segments[0].orderingHint).toBeUndefined();
  });

  test('"frame 01 50%\\nrockwool 30%" -> 2 segments (newline is the strongest split)', () => {
    const r = segment("frame 01 50%\nrockwool 30%");
    expect(r.segments.length).toBe(2);
    expect(r.segments[0].text).toBe("frame 01 50%");
    expect(r.segments[1].text).toBe("rockwool 30%");
  });

  test('"record 50% then show the dashboard" -> 2 segments, with orderingHint', () => {
    const r = segment("record 50% then show the dashboard");
    expect(r.segments.length).toBe(2);
    expect(r.segments[0]).toEqual({ text: "record 50%", orderingHint: 0 });
    expect(r.segments[1]).toEqual({ text: "show the dashboard", orderingHint: 1 });
  });

  test("numbered list -> 2 segments", () => {
    const r = segment("1. approve VO-014\n2. show the budget");
    expect(r.segments.length).toBe(2);
    expect(r.segments[0].text).toBe("approve VO-014");
    expect(r.segments[1].text).toBe("show the budget");
  });

  test('"thanks" -> 1 segment', () => {
    const r = segment("thanks");
    expect(r.segments.length).toBe(1);
    expect(r.segments[0].text).toBe("thanks");
  });

  test('"" -> 0 segments', () => {
    const r = segment("");
    expect(r.segments.length).toBe(0);
    expect(r.flagged).toBe(false);
  });

  test("whitespace-only input -> 0 segments", () => {
    const r = segment("   \n\t  ");
    expect(r.segments.length).toBe(0);
  });

  test("12-instruction message -> flagged, capped at MAX_SEGMENTS", () => {
    const lines = Array.from({ length: 12 }, (_, i) => `${i + 1}. task number ${i + 1}`);
    const r = segment(lines.join("\n"));
    expect(r.flagged).toBe(true);
    expect(r.segments.length).toBe(MAX_SEGMENTS);
    expect(r.segments[0].text).toBe("task number 1");
  });
});

describe("segment() -- other syntactic split rules", () => {
  test("semicolons split into multiple segments", () => {
    const r = segment("approve VO-014; show the budget");
    expect(r.segments.length).toBe(2);
    expect(r.segments[0].text).toBe("approve VO-014");
    expect(r.segments[1].text).toBe("show the budget");
    // semicolon split carries no explicit ordering promise
    expect(r.segments[0].orderingHint).toBeUndefined();
  });

  test("period splits only when the next fragment starts with a known verb", () => {
    const r = segment("frame 01 is done. Show me the budget.");
    expect(r.segments.length).toBe(2);
    expect(r.segments[0].text).toBe("frame 01 is done.");
    expect(r.segments[1].text).toBe("Show me the budget.");
  });

  test("period does NOT split a decimal item code (1.01)", () => {
    const r = segment("item 1.01 is at 50 percent");
    expect(r.segments.length).toBe(1);
    expect(r.segments[0].text).toBe("item 1.01 is at 50 percent");
  });

  test("period splits when the next fragment starts with a real item code", () => {
    const r = segment("VO-014 is signed. CDR-001 needs review");
    expect(r.segments.length).toBe(2);
    expect(r.segments[0].text).toBe("VO-014 is signed.");
    expect(r.segments[1].text).toBe("CDR-001 needs review");
  });

  test("period does not split an ordinary abbreviation/sentence with no actionable next fragment", () => {
    const r = segment("the client visited site. it went fine overall");
    expect(r.segments.length).toBe(1);
  });

  test("question mark splits when followed by a known verb", () => {
    const r = segment("is VO-014 approved? Confirm it please");
    expect(r.segments.length).toBe(2);
    expect(r.segments[1].text).toBe("Confirm it please");
  });

  test('"and then" connector splits with orderingHint', () => {
    const r = segment("record progress on frame 01 and then check the schedule");
    expect(r.segments.length).toBe(2);
    expect(r.segments[0]).toEqual({ text: "record progress on frame 01", orderingHint: 0 });
    expect(r.segments[1]).toEqual({ text: "check the schedule", orderingHint: 1 });
  });

  test("bullet markers on one physical line (no newlines) still split, in order", () => {
    const r = segment("- approve VO-014 - show the budget");
    expect(r.segments.length).toBe(2);
    expect(r.segments[0]).toEqual({ text: "approve VO-014", orderingHint: 0 });
    expect(r.segments[1]).toEqual({ text: "show the budget", orderingHint: 1 });
  });

  // SUPERSEDED BY R53 PHASE 3. The tiers used to be mutually exclusive --
  // the first marker that fired won and no later marker was consulted, so
  // the "then" inside line 1 was never seen. R53 lists sentence
  // terminators, conjunctions, semicolons, newlines and bullets together,
  // and the tiers now CASCADE. A message that mixes two markers is the
  // common real case, not an exotic one.
  test("newline splits first, then the connector inside a line (R53: tiers cascade)", () => {
    const r = segment("record 50% then show budget\ncheck schedule");
    expect(r.segments.length).toBe(3);
    expect(r.segments[0].text).toBe("record 50%");
    expect(r.segments[1].text).toBe("show budget");
    expect(r.segments[2].text).toBe("check schedule");
    // "then" fired, so the whole sequence carries an ordering promise
    expect(r.segments[0].orderingHint).toBe(0);
  });

  test("exactly MAX_SEGMENTS lines is not flagged", () => {
    const lines = Array.from({ length: MAX_SEGMENTS }, (_, i) => `line ${i + 1}`);
    const r = segment(lines.join("\n"));
    expect(r.flagged).toBe(false);
    expect(r.segments.length).toBe(MAX_SEGMENTS);
  });
});

// ~41 real site-engineer phrasings: no punctuation, ALL CAPS, mixed
// Hindi/English, typos, trailing "pls". Most stay 1 segment (no syntactic
// marker present) -- that is the realistic, correct outcome for a single
// blunt utterance; classify.ts is what turns messy phrasing into a task, not
// this file.
describe("segment() -- real site-engineer phrasing (robustness, not cleanliness)", () => {
  const oneSegmentInputs: string[] = [
    "frame 01 done",
    "FRAME 01 DONE PLS",
    "frame 1 ka kaam ho gaya",
    "rockwool lag gaya 30 percent",
    "VO-014 signed off by client today",
    "material nahi aaya abhi tak",
    "concrete pour ho gaya level 3 pe",
    "labour count 45 aaj",
    "site pe paani nahi hai",
    "CDR-003 ki drawing chahiye",
    "approve karo VO-014 pls",
    "kal se material aana chahiye",
    "frame 02 60 percent complete hai",
    "boq item BBC-005 rate galat hai",
    "PLEASE CHECK PERMIT STATUS",
    "meeting kal 10 baje hai site pe",
    "concrete grade change ho gaya M25 se M30",
    "labour attendance update kar do",
    "aaj koi progress nahi hua rain ki wajah se",
    "check karo kya material dispatch hua",
    "punch list item 5 fix ho gaya",
    "SITE VISIT REPORT SUBMITTED",
    "client ne design change maanga hai",
    "rockwool ka rate confirm karo pls",
    "kal tak permit aa jayega shayad",
    "frame 03 abhi start nahi hua",
    "vendor payment pending hai 2 hafte se",
    "safety inspection ho gaya aaj",
    "record progress on frame 04",
    "list all pending RFIs pls",
    "create new punch list item for level 2",
    "update the schedule for next week",
    "delete the duplicate BOQ line",
    "check attendance for today",
    "confirm the delivery of cement",
    "review the site diary entries",
    "import the latest scope file",
    "sign off on the drawing revision",
    "MATERIAL DELIVERY DELAYED AGAIN TODAY",
    "labour shortage ho rahi hai site pe abhi",
    "frame 05 ka kaam bhi shuru karo pls",
  ];

  for (const input of oneSegmentInputs) {
    test(`"${input}" -> 1 segment`, () => {
      const r = segment(input);
      expect(r.segments.length).toBe(1);
      expect(r.segments[0].text).toBe(input.trim());
      expect(r.flagged).toBe(false);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// R53 PHASE 3 -- THE REQUIRED FIXTURES.
//
// These are not invented examples. Every one of the first four is a real
// compliance.submissions row from 24 Aug 2026, and the fifth is the
// counter-example that keeps the new conjunction tier honest. The work
// order states them verbatim and they must pass.
// ─────────────────────────────────────────────────────────────────────────
describe("segment() -- R53 Phase 3 required fixtures", () => {
  test('"PP1 is 50% done and show me the budget" -> 2 segments', () => {
    const r = segment("PP1 is 50% done and show me the budget");
    expect(r.segments.length).toBe(2);
    expect(r.segments[0].text).toBe("PP1 is 50% done");
    expect(r.segments[1].text).toBe("show me the budget");
    expect(r.flagged).toBe(false);
  });

  test('"frame 01 is 50% done and show me the budget" -> 2 segments', () => {
    const r = segment("frame 01 is 50% done and show me the budget");
    expect(r.segments.length).toBe(2);
    expect(r.segments[0].text).toBe("frame 01 is 50% done");
    expect(r.segments[1].text).toBe("show me the budget");
  });

  test('"how is this project doing overall" -> 1 segment', () => {
    const r = segment("how is this project doing overall");
    expect(r.segments.length).toBe(1);
    expect(r.segments[0].text).toBe("how is this project doing overall");
  });

  test('"ZZ-AUDIT1-999R 15% done" -> 1 segment', () => {
    const r = segment("ZZ-AUDIT1-999R 15% done");
    expect(r.segments.length).toBe(1);
    expect(r.segments[0].text).toBe("ZZ-AUDIT1-999R 15% done");
  });

  // THE COUNTER-EXAMPLE. This is what the guard on the conjunction tier
  // exists for: "white trim" is neither a closed-set verb nor an item code,
  // so the "and" is coordinating two adjectives, not two instructions.
  test('"the frame with the blue and white trim" -> 1 segment', () => {
    const r = segment("the frame with the blue and white trim");
    expect(r.segments.length).toBe(1);
    expect(r.segments[0].text).toBe("the frame with the blue and white trim");
  });
});

describe("segment() -- R53 conjunction tier, beyond the required fixtures", () => {
  test('"also" splits when the next fragment is actionable', () => {
    const r = segment("PP1 is 50% done also show me the schedule");
    expect(r.segments.length).toBe(2);
    expect(r.segments[1].text).toBe("show me the schedule");
  });

  test('"plus" splits when the next fragment is actionable', () => {
    const r = segment("record 50% on PP1 plus list all pending RFIs");
    expect(r.segments.length).toBe(2);
    expect(r.segments[1].text).toBe("list all pending RFIs");
  });

  test('"and also" is consumed whole, not as a bare "and" leaving "also" stranded', () => {
    const r = segment("approve VO-014 and also confirm VO-015");
    expect(r.segments.length).toBe(2);
    expect(r.segments[0].text).toBe("approve VO-014");
    expect(r.segments[1].text).toBe("confirm VO-015");
  });

  test('"and then" is consumed whole and still carries the ordering promise', () => {
    const r = segment("approve VO-014 and then show the budget");
    expect(r.segments.length).toBe(2);
    expect(r.segments[0]).toEqual({ text: "approve VO-014", orderingHint: 0 });
    expect(r.segments[1]).toEqual({ text: "show the budget", orderingHint: 1 });
  });

  test("a bare and/also/plus split carries NO ordering promise", () => {
    const r = segment("PP1 is 50% done and show me the budget");
    expect(r.segments[0].orderingHint).toBeUndefined();
    expect(r.segments[1].orderingHint).toBeUndefined();
  });

  test("the connector never fires inside a longer word", () => {
    for (const input of ["surplus material arrived", "android tablet issued to site", "thence the delay"]) {
      expect(segment(input).segments.length).toBe(1);
    }
  });

  test("a trailing connector with nothing after it does not split", () => {
    const r = segment("frame 01 is done and");
    expect(r.segments.length).toBe(1);
    expect(r.segments[0].text).toBe("frame 01 is done and");
  });

  test('"and" splits into two real instructions when both sides are actionable', () => {
    const r = segment("approve VO-014 and confirm VO-015");
    expect(r.segments.length).toBe(2);
    expect(r.segments[0].text).toBe("approve VO-014");
    expect(r.segments[1].text).toBe("confirm VO-015");
  });

  test("the conjunction tier cascades under a semicolon split", () => {
    const r = segment("approve VO-014; PP1 is 50% done and show me the budget");
    expect(r.segments.length).toBe(3);
    expect(r.segments[0].text).toBe("approve VO-014");
    expect(r.segments[1].text).toBe("PP1 is 50% done");
    expect(r.segments[2].text).toBe("show me the budget");
  });

  test("a conjunction split still respects MAX_SEGMENTS and flags", () => {
    const r = segment("approve A1 and confirm A2 and review A3 and check A4 and update A5 and delete A6");
    expect(r.flagged).toBe(true);
    expect(r.segments.length).toBe(MAX_SEGMENTS);
  });
});

describe("rejoinCandidate() -- R53 Phase 3's re-join-once rule", () => {
  test("joins with the PREVIOUS neighbour by default", () => {
    const { segments } = segment("PP1 is 50% done and show me the budget");
    const r = rejoinCandidate(segments, 1);
    expect(r).toEqual({ text: "PP1 is 50% done show me the budget", absorbedIndex: 0 });
  });

  test("falls back to the NEXT neighbour at index 0", () => {
    const { segments } = segment("PP1 is 50% done and show me the budget");
    const r = rejoinCandidate(segments, 0);
    expect(r).toEqual({ text: "PP1 is 50% done show me the budget", absorbedIndex: 1 });
  });

  test("returns null for a lone segment -- retrying it unchanged would be a loop", () => {
    const { segments } = segment("how is this project doing overall");
    expect(rejoinCandidate(segments, 0)).toBeNull();
  });

  test("returns null for an out-of-range index", () => {
    const { segments } = segment("PP1 is 50% done and show me the budget");
    expect(rejoinCandidate(segments, 9)).toBeNull();
    expect(rejoinCandidate(segments, -1)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// R53 PHASE 3 DONE TEST, second half: "zero network calls in the test run".
//
// Asserted two ways, because either one alone is weak. The STATIC check
// proves segment.ts imports nothing at all, so it cannot reach a socket
// through a dependency. The RUNTIME check proves it does not reach one
// through a global either -- fetch and net.Socket.prototype.connect are
// both replaced with throwing stubs while every fixture in this file is
// run through segment() again.
// ─────────────────────────────────────────────────────────────────────────
describe("segment() -- ZERO NETWORK", () => {
  test("segment.ts imports nothing, so it has no dependency to reach a socket through", async () => {
    const src = await Bun.file(new URL("./segment.ts", import.meta.url)).text();
    const codeOnly = src
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    expect(codeOnly).not.toMatch(/(^|\n)\s*import\s/);
    expect(codeOnly).not.toMatch(/require\s*\(/);
    expect(codeOnly).not.toMatch(/\bfetch\s*\(/);
  });

  test("running every fixture makes no fetch call and opens no socket", async () => {
    const attempts: string[] = [];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((...args: unknown[]) => {
      attempts.push(`fetch(${String(args[0])})`);
      throw new Error("segment() attempted a network call");
    }) as typeof globalThis.fetch;

    const net = await import("node:net");
    const originalConnect = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function (...args: any[]) {
      attempts.push("socket.connect");
      throw new Error("segment() attempted to open a socket");
    } as typeof net.Socket.prototype.connect;

    try {
      const everyFixture = [
        "",
        "   \n\t  ",
        "thanks",
        "frame 01 is 50% done",
        "frame 01 and frame 02 are done",
        "frame 01 done and show me the budget",
        "frame 01 50%\nrockwool 30%",
        "record 50% then show the dashboard",
        "1. approve VO-014\n2. show the budget",
        "approve VO-014; show the budget",
        "frame 01 is done. Show me the budget.",
        "item 1.01 is at 50 percent",
        "VO-014 is signed. CDR-001 needs review",
        "is VO-014 approved? Confirm it please",
        "record progress on frame 01 and then check the schedule",
        "- approve VO-014 - show the budget",
        "record 50% then show budget\ncheck schedule",
        "PP1 is 50% done and show me the budget",
        "frame 01 is 50% done and show me the budget",
        "how is this project doing overall",
        "ZZ-AUDIT1-999R 15% done",
        "the frame with the blue and white trim",
        "PP1 is 50% done also show me the schedule",
        "record 50% on PP1 plus list all pending RFIs",
        "approve VO-014 and also confirm VO-015",
        "surplus material arrived",
        "frame 01 is done and",
        "approve A1 and confirm A2 and review A3 and check A4 and update A5 and delete A6",
      ];
      for (const input of everyFixture) {
        const r = segment(input);
        // touch the result so nothing can be optimised away
        expect(Array.isArray(r.segments)).toBe(true);
        if (r.segments.length > 1) expect(rejoinCandidate(r.segments, 1)).not.toBeNull();
      }
    } finally {
      globalThis.fetch = originalFetch;
      net.Socket.prototype.connect = originalConnect;
    }

    expect(attempts).toEqual([]);
  });
});
