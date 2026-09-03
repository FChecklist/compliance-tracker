/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { buildRunRoute, gapAnswer, missingParamsFor, NO_COMMENTARY_SENTENCE } from "./dry-run";
import { PIPELINE_ERROR_CODES } from "./error-codes";
import { functionSpec } from "./function-registry";

// R67 FIX PASS -- dry-run.ts's three pure functions were only ever exercised
// through dryRunSubmission()'s DB- and provider-backed wrapper in
// run-submission.test.ts. That proves the wiring and nothing about the edges:
// what a gap says when it recognises nothing, what a COMMAND route does with
// an existing query string, whether `missing` can ever carry a camelCase
// name. These assertions cost no database at all.

describe("gapAnswer -- a gap is still an answer, with a destination", () => {
  test("a create verb on a known capability names the screen and the route", () => {
    expect(gapAnswer("create a customer called Sharma Constructions")).toEqual({
      message: "Creating customers from chat is not enabled for this workspace - Open Customers",
      route: "/customers",
    });
  });

  test("the same noun WITHOUT a create verb still routes, with the general sentence", () => {
    const answer = gapAnswer("show me our vendors");
    expect(answer.route).toBe("/vendors");
    expect(answer.message).toBe("That is not enabled for this workspace yet - Open Vendors");
  });

  test("an unrecognised capability gets the honest generic answer, never an invented promise", () => {
    expect(gapAnswer("book me a helicopter")).toEqual({
      message: "That is not enabled for this workspace yet - Open Home",
      route: "/dashboard",
    });
  });

  test("every gap sentence offers a destination and names no function id", () => {
    for (const text of ["create a customer", "raise an invoice", "add an employee", "nonsense request"]) {
      const answer = gapAnswer(text);
      expect(answer.route.startsWith("/")).toBe(true);
      expect(answer.message).toMatch(/ - Open /);
      expect(answer.message).not.toMatch(/_/);
    }
  });
});

describe("missingParamsFor -- what is still unanswered, from the registry alone", () => {
  test("a write with nothing supplied lists its declared required params, with human labels", () => {
    const missing = missingParamsFor("record_attendance", {}, null);
    expect(missing.length).toBeGreaterThan(0);
    for (const m of missing) {
      expect(m.label.length).toBeGreaterThan(0);
      // A LABEL, not a parameter name: "Worker", never "rosterId".
      expect(m.label).not.toBe(m.name);
      expect(PIPELINE_ERROR_CODES as readonly string[]).toContain(m.code);
    }
  });

  test("the submission's own project answers projectId -- B-02's whole point", () => {
    const withoutProject = missingParamsFor("record_attendance", { rosterId: "w1", date: "2026-09-02" }, null);
    expect(withoutProject.map((m) => m.name)).toContain("projectId");
    const withProject = missingParamsFor("record_attendance", { rosterId: "w1", date: "2026-09-02" }, "p1");
    expect(withProject.map((m) => m.name)).not.toContain("projectId");
  });

  test("a BOQ line answered by the chip's record id counts as answered (alsoSatisfiedBy)", () => {
    const byCode = missingParamsFor("record_work_progress", { itemCode: "EX-01", percent: 40 }, "p1");
    expect(byCode).toEqual([]);
    const byId = missingParamsFor("record_work_progress", { boqLineItemId: "l_1", quantityDone: 2 }, "p1");
    expect(byId).toEqual([]);
  });

  test("an unregistered function claims nothing is missing rather than guessing a field list", () => {
    expect(functionSpec("approve_variation")).toBeUndefined();
    expect(missingParamsFor("approve_variation", {}, null)).toEqual([]);
  });
});

describe("buildRunRoute -- a COMMAND verb opens the screen that does the thing", () => {
  test("an unregistered route falls back to Home rather than to a broken link", () => {
    expect(buildRunRoute(undefined, { projectId: "p1" })).toBe("/dashboard");
  });

  test("parameters are attached as a query string", () => {
    expect(buildRunRoute("/work-progress", { tab: "report" })).toBe("/work-progress?tab=report");
  });

  test("a route that already carries a query string keeps it and merges", () => {
    const route = buildRunRoute("/work-progress?tab=report", { from: "2026-09-01" });
    expect(route.startsWith("/work-progress?")).toBe(true);
    const params = new URLSearchParams(route.split("?")[1]);
    expect(params.get("tab")).toBe("report");
    expect(params.get("from")).toBe("2026-09-01");
  });

  test("empty, null and undefined values are dropped, not sent as 'undefined'", () => {
    expect(buildRunRoute("/reports", { a: "", b: null, c: undefined })).toBe("/reports");
  });
});

describe("the refusal sentence dry-run shares with the AI adapter", () => {
  test("it is the exact shared constant, and it names no provider and no account state", () => {
    expect(NO_COMMENTARY_SENTENCE).toBe("VERI can't add commentary right now - here is what the records say");
    expect(NO_COMMENTARY_SENTENCE).not.toMatch(/not available for this account/i);
  });
});
