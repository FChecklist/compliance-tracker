/// <reference types="bun-types" />
// R67 lane B (B-07) -- the verdict envelope, mapped from a proposal.
//
// B-07's own acceptance exercises this THROUGH dryRunSubmission() in
// run-submission.test.ts, which is the composition a route actually returns.
// This file is the narrower half: the pure mapping, fed hand-built proposals,
// so the rules that are easy to get quietly wrong -- what counts as
// confirmable, which parameter name the BOQ line comes back under, that a
// verdict never carries a function id where a label belongs -- are pinned
// without going through a classifier at all.
import { describe, expect, test } from "bun:test";
import { toVerdict, toVerdictResult } from "./verdict";
import type { DryRunProposal, DryRunResult } from "./dry-run";

function proposal(over: Partial<DryRunProposal> = {}): DryRunProposal {
  return {
    segmentText: "record 50% progress on excavation",
    status: "ready",
    verdict: "task",
    kind: "write",
    functionId: "record_work_progress",
    label: "Record progress",
    params: { projectId: "p1", itemCode: "EX-01", percent: 50 },
    missing: [],
    chain: { full: "Cedar Heights Villa > Work Progress > Record progress", mode: "Projects", root: "Cedar Heights Villa", steps: ["Work Progress", "Record progress"] },
    ...over,
  };
}

describe("confirmable -- ONLY a fully-resolved write may be executed by a confirm", () => {
  test("a ready write is confirmable", () => {
    expect(toVerdict(proposal()).confirmable).toBe(true);
  });

  test("a write still missing something is not", () => {
    const v = toVerdict(proposal({ status: "needs_input", missing: [{ name: "itemCode", label: "BOQ line", code: "BOQ_LINE_REQUIRED" }] }));
    expect(v.confirmable).toBe(false);
  });

  test("a read that already answered is not -- it ran, and it recorded nothing", () => {
    const v = toVerdict(proposal({ status: "answered", verdict: "chat", kind: "ask", answer: { rows: [], text: null, chain: "x" } }));
    expect(v.confirmable).toBe(false);
    expect(v.answer).toBeDefined();
  });

  test("a gap is not, and carries its destination instead", () => {
    const v = toVerdict(
      proposal({
        status: "gap",
        verdict: "gap",
        functionId: null,
        label: null,
        params: {},
        chain: null,
        message: "Creating customers from chat is not enabled for this workspace - Open Customers",
        route: "/customers",
      })
    );
    expect(v.confirmable).toBe(false);
    expect(v.understood).toBeNull();
    expect(v.links).toEqual([{ label: "Open Customers", route: "/customers" }]);
  });
});

describe("the BOQ line changes name exactly once, and only here", () => {
  test("BOQ_LINE_REQUIRED comes back as boqLineItemId, in the D-03 field vocabulary", () => {
    const v = toVerdict(
      proposal({
        status: "needs_input",
        missing: [
          {
            name: "itemCode",
            label: "BOQ line",
            code: "BOQ_LINE_REQUIRED",
            options: [{ id: "EX-01", label: "EX-01 Excavation", lineItemId: "line_9" }],
          },
        ],
      })
    );
    expect(v.missing[0]).toEqual({
      name: "boqLineItemId",
      field: "boqLine",
      label: "BOQ line",
      code: "BOQ_LINE_REQUIRED",
      options: [{ id: "line_9", label: "EX-01 Excavation" }],
    });
  });

  test("an option with no underlying record id falls back to its own id rather than vanishing", () => {
    const v = toVerdict(
      proposal({
        status: "needs_input",
        missing: [{ name: "itemCode", label: "BOQ line", code: "BOQ_LINE_REQUIRED", options: [{ id: "EX-02", label: "EX-02 Rock" }] }],
      })
    );
    expect(v.missing[0].options).toEqual([{ id: "EX-02", label: "EX-02 Rock" }]);
  });

  test("every other parameter keeps its own name and gains its vocabulary key", () => {
    const v = toVerdict(
      proposal({
        status: "needs_input",
        missing: [
          { name: "projectId", label: "Project", code: "PROJECT_REQUIRED" },
          { name: "rosterId", label: "Worker", code: "WORKER_REQUIRED" },
          { name: "somethingNew", label: "Something", code: "VALUE_REQUIRED" },
        ],
      })
    );
    expect(v.missing.map((m) => [m.name, m.field])).toEqual([
      ["projectId", "project"],
      ["rosterId", "worker"],
      // an unmapped parameter keeps its own name -- honest, and the client
      // renders from `code` regardless
      ["somethingNew", "somethingNew"],
    ]);
  });
});

describe("understood -- words, never identifiers, and always a chain", () => {
  test("the label is the human name and the chain is always returned", () => {
    const v = toVerdict(proposal());
    expect(v.understood).toEqual({
      functionId: "record_work_progress",
      label: "Record progress",
      projectId: "p1",
      params: { projectId: "p1", itemCode: "EX-01", percent: 50 },
    });
    expect(v.chain).toBe("Cedar Heights Villa > Work Progress > Record progress");
  });

  test("a proposal with no project resolves projectId to null rather than inventing one", () => {
    const v = toVerdict(proposal({ params: { itemCode: "EX-01" } }));
    expect(v.understood!.projectId).toBeNull();
  });
});

describe("the envelope keeps every segment's verdict", () => {
  function result(proposals: DryRunProposal[]): DryRunResult {
    const first = proposals[0];
    return {
      dryRun: true,
      proposals,
      status: first?.status ?? "chat",
      verdict: first?.verdict ?? "chat",
      kind: first?.kind ?? "ask",
      functionId: first?.functionId ?? null,
      label: first?.label ?? null,
      params: first?.params ?? {},
      missing: first?.missing ?? [],
      chain: first?.chain ?? null,
    };
  }

  test("two segments produce two verdicts, and the top level flattens the first", () => {
    const v = toVerdictResult(
      result([proposal(), proposal({ segmentText: "show me the budget", verdict: "chat", kind: "ask", status: "answered", functionId: "review_budget", label: "Review Budget" })]),
      "sub_1"
    );
    expect(v.verdicts).toHaveLength(2);
    expect(v.verdicts[1].understood!.label).toBe("Review Budget");
    expect(v.verdict).toBe("task");
    expect(v.submissionId).toBe("sub_1");
  });

  test("no segments at all is still a well-formed envelope", () => {
    const v = toVerdictResult(result([]), null);
    expect(v.verdicts).toEqual([]);
    expect(v.status).toBe("chat");
    expect(v.understood).toBeNull();
    expect(v.confirmable).toBe(false);
    expect(v.submissionId).toBeNull();
  });
});
