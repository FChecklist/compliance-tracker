/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { segment, MAX_SEGMENTS } from "./segment";

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

  test('"frame 01 done and show me the budget" -> 1 segment (bare "and", left joined for classify.ts to resolve)', () => {
    const r = segment("frame 01 done and show me the budget");
    expect(r.segments.length).toBe(1);
    expect(r.segments[0].text).toBe("frame 01 done and show me the budget");
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

  test("newline beats a lower-priority connector inside one of its lines", () => {
    const r = segment("record 50% then show budget\ncheck schedule");
    // 2 lines -> newline wins outright; the "then" inside line 1 is not
    // further split, matching the "priority tiers are mutually exclusive,
    // not cascading" design.
    expect(r.segments.length).toBe(2);
    expect(r.segments[0].text).toBe("record 50% then show budget");
    expect(r.segments[1].text).toBe("check schedule");
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
