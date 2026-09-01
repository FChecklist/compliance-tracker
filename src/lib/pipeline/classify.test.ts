/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { classifySegment, classifySubmission, isQuestion, isImperative, isAcknowledgement, type ClassifyInput } from "./classify";

// R53 Phase 4. The verdict table, exhaustively.
//
// THE DEFECT THESE GUARD: all 16 live compliance.submissions rows produced
// exactly ONE verdict for the whole message. "PP1 is 50% done and show me
// the budget" recorded progress and silently dropped the budget read.

const write = { writes: true };
const read = { writes: false };

function resolvedTo(functionId: string, extra: Partial<ClassifyInput["resolution"]> = {}) {
  return { functionId, params: {}, source: "structural" as const, level: 0 as const, ...extra };
}

describe("classifySegment() -- R53 Phase 4's three rules", () => {
  test("resolves to a function that WRITES -> TASK", () => {
    const c = classifySegment({
      text: "PP1 is 50% done",
      resolution: resolvedTo("record_work_progress", { params: { itemCode: "PP1", percent: 50 } }),
      nature: write,
    });
    expect(c.verdict).toBe("task");
    expect(c.functionId).toBe("record_work_progress");
    expect(c.gapReason).toBeNull();
  });

  test("resolves to a READ-ONLY function -> CHAT", () => {
    const c = classifySegment({
      text: "show me the budget",
      resolution: resolvedTo("get_construction_budget_status", { source: "phrase_map" }),
      nature: read,
    });
    expect(c.verdict).toBe("chat");
    expect(c.functionId).toBe("get_construction_budget_status");
    expect(c.gapReason).toBeNull();
  });

  // R65 Part D -- a reuse_cache hit (src/lib/pipeline/reuse-cache.ts) is
  // just another ResolutionSource as far as classifySegment() is concerned;
  // this is what makes it safe to add without an exhaustive-switch break
  // anywhere in this file.
  test("resolves via reuse_cache -> same verdict as any other WRITE resolution", () => {
    const c = classifySegment({
      text: "PP1 is 50% done",
      resolution: resolvedTo("record_work_progress", { params: { itemCode: "PP1", percent: 50 }, source: "reuse_cache", level: 0 }),
      nature: write,
    });
    expect(c.verdict).toBe("task");
    expect(c.source).toBe("reuse_cache");
    expect(c.level).toBe(0);
  });

  test("imperative that resolves to nothing -> GAP, with an honest message and a gap reason", () => {
    const c = classifySegment({ text: "approve VO-014", resolution: null, nature: null });
    expect(c.verdict).toBe("gap");
    expect(c.functionId).toBeNull();
    expect(c.message).toBe('I can\'t do that yet: "approve VO-014"');
    expect(c.gapReason).toContain("unresolved imperative");
  });

  test("an acknowledgement that resolves to nothing is CHAT, never a GAP", () => {
    for (const text of ["thanks", "ok", "noted", "theek hai", "Thanks."]) {
      const c = classifySegment({ text, resolution: null, nature: null });
      expect(c.verdict).toBe("chat");
      expect(c.gapReason).toBeNull();
    }
  });

  test("an unresolved question and an unresolved statement are BOTH logged as gaps", () => {
    const q = classifySegment({ text: "how much cement is left?", resolution: null, nature: null });
    expect(q.verdict).toBe("gap");
    expect(q.gapReason).toContain("unresolved question");

    const s = classifySegment({ text: "material nahi aaya abhi tak", resolution: null, nature: null });
    expect(s.verdict).toBe("gap");
    expect(s.gapReason).toContain("unresolved statement");
  });
});

describe("classifySegment() -- a question NEVER becomes a task", () => {
  // This is the safety half of "reads as a question -> CHAT". The same
  // function resolves for both phrasings; executing the question form would
  // write a progress record nobody asked for.
  test("a question that resolves to a WRITE function is CHAT, not TASK", () => {
    const c = classifySegment({
      text: "did PP1 reach 50%?",
      resolution: resolvedTo("record_work_progress", { params: { itemCode: "PP1", percent: 50 } }),
      nature: write,
    });
    expect(c.verdict).toBe("chat");
    expect(c.message).toContain("nothing was recorded");
  });

  test("the statement form of the same sentence IS a task", () => {
    const c = classifySegment({
      text: "PP1 is 50% done",
      resolution: resolvedTo("record_work_progress", { params: { itemCode: "PP1", percent: 50 } }),
      nature: write,
    });
    expect(c.verdict).toBe("task");
  });
});

describe("classifySegment() -- M26 PARTIAL: missing params ask, never escalate", () => {
  test("a write function with missing params is still a TASK, carrying the ask", () => {
    const c = classifySegment({
      text: "record progress on PP1",
      resolution: resolvedTo("record_work_progress", { missingParams: ["percent"] }),
      nature: write,
    });
    expect(c.verdict).toBe("task");
    expect(c.missingParams).toEqual(["percent"]);
    expect(c.message).toContain("percent");
    // A missing quantity is a form field, NOT a gap.
    expect(c.gapReason).toBeNull();
  });

  test("a read function with missing params is a CHAT carrying the ask", () => {
    const c = classifySegment({
      text: "show the budget",
      resolution: resolvedTo("get_construction_budget_status", { missingParams: ["projectId"] }),
      nature: read,
    });
    expect(c.verdict).toBe("chat");
    expect(c.gapReason).toBeNull();
  });
});

describe("classifySegment() -- THE MIX. One submission, two verdicts.", () => {
  test('"PP1 is 50% done" + "show me the budget" -> one TASK and one CHAT', () => {
    const verdicts = [
      classifySegment({
        text: "PP1 is 50% done",
        resolution: resolvedTo("record_work_progress", { params: { itemCode: "PP1", percent: 50 } }),
        nature: write,
      }),
      classifySegment({
        text: "show me the budget",
        resolution: resolvedTo("get_construction_budget_status", { source: "phrase_map" }),
        nature: read,
      }),
    ].map((c) => c.verdict);

    expect(verdicts).toEqual(["task", "chat"]);
  });

  test("a submission can mix all three verdicts at once", () => {
    const verdicts = [
      classifySegment({ text: "PP1 is 50% done", resolution: resolvedTo("record_work_progress"), nature: write }),
      classifySegment({ text: "show me the budget", resolution: resolvedTo("get_construction_budget_status"), nature: read }),
      classifySegment({ text: "import the drone survey", resolution: null, nature: null }),
    ].map((c) => c.verdict);

    expect(verdicts).toEqual(["task", "chat", "gap"]);
  });
});

describe("isQuestion()", () => {
  const questions = [
    "how is this project doing overall",
    "is VO-014 approved?",
    "did PP1 reach 50%?",
    "what is the budget",
    "can I close this BOQ",
    "kya material aa gaya",
    "kitna kaam bacha hai",
    "the budget?",
  ];
  for (const q of questions) {
    test(`"${q}" reads as a question`, () => expect(isQuestion(q)).toBe(true));
  }

  const statements = [
    "PP1 is 50% done",
    "frame 01 is 50% done",
    "show me the budget",
    "approve VO-014",
    "ZZ-AUDIT1-999R 15% done",
    "material nahi aaya abhi tak",
    "",
  ];
  for (const s of statements) {
    test(`"${s}" does not read as a question`, () => expect(isQuestion(s)).toBe(false));
  }

  test('only the FIRST word is consulted -- "PP1 is 50% done" is not a question because of its "is"', () => {
    expect(isQuestion("PP1 is 50% done")).toBe(false);
    expect(isQuestion("is PP1 50% done")).toBe(true);
  });
});

describe("isImperative()", () => {
  test("opens with a verb from M24's closed set", () => {
    for (const t of ["approve VO-014", "show me the budget", "record 50%", "sign off the drawing", "list all RFIs"]) {
      expect(isImperative(t)).toBe(true);
    }
  });

  test("does not fire on a word that merely starts with a verb", () => {
    // "showroom" opens with "show" but is not the verb -- the check requires
    // the whole word.
    expect(isImperative("showroom visit scheduled")).toBe(false);
    expect(isImperative("recorded already")).toBe(false);
  });

  test("does not fire on a statement", () => {
    expect(isImperative("PP1 is 50% done")).toBe(false);
    expect(isImperative("material nahi aaya")).toBe(false);
  });
});

describe("classifySubmission() -- R65 Part D Phase 4's submission-level discriminant", () => {
  test("zero segments -> CHAT_ONLY", () => {
    expect(classifySubmission([])).toBe("CHAT_ONLY");
  });

  test("all 'chat' verdicts (pure question/acknowledgement submission) -> CHAT_ONLY", () => {
    expect(classifySubmission(["chat"])).toBe("CHAT_ONLY");
    expect(classifySubmission(["chat", "chat"])).toBe("CHAT_ONLY");
  });

  test("all 'gap' verdicts (nothing the software could resolve) -> CHAT_ONLY, not a distinct value", () => {
    expect(classifySubmission(["gap"])).toBe("CHAT_ONLY");
    expect(classifySubmission(["gap", "gap"])).toBe("CHAT_ONLY");
  });

  test("a mix of 'chat' and 'gap', with zero 'task' verdicts -> CHAT_ONLY", () => {
    expect(classifySubmission(["chat", "gap"])).toBe("CHAT_ONLY");
  });

  test("exactly one 'task' verdict -> TASK", () => {
    expect(classifySubmission(["task"])).toBe("TASK");
  });

  test("one 'task' verdict alongside 'chat'/'gap' verdicts is still TASK, not MULTIPLE_TASKS", () => {
    // classify.ts's own canonical example: "PP1 is 50% done and show me the
    // budget" -> one TASK (the write) + one CHAT (the read). Only one
    // executable action was requested.
    expect(classifySubmission(["task", "chat"])).toBe("TASK");
    expect(classifySubmission(["task", "gap"])).toBe("TASK");
    expect(classifySubmission(["chat", "task", "gap"])).toBe("TASK");
  });

  test("more than one 'task' verdict -> MULTIPLE_TASKS", () => {
    expect(classifySubmission(["task", "task"])).toBe("MULTIPLE_TASKS");
    expect(classifySubmission(["task", "chat", "task"])).toBe("MULTIPLE_TASKS");
  });
});

describe("isAcknowledgement()", () => {
  test("matches the closed set, punctuation and case insensitive", () => {
    expect(isAcknowledgement("Thanks!")).toBe(true);
    expect(isAcknowledgement("  OK  ")).toBe(true);
    expect(isAcknowledgement("theek hai")).toBe(true);
  });

  test("does not match a sentence that merely contains one", () => {
    expect(isAcknowledgement("ok now show me the budget")).toBe(false);
    expect(isAcknowledgement("thanks for approving VO-014")).toBe(false);
  });
});
