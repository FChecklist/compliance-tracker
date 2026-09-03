/// <reference types="bun-types" />
// R67 lane B (B-01/B-02) rewrote every assertion in this file from
// `reason` prose to a closed-vocabulary code, because validate() no longer
// composes English at all (D-03). The CHECK ORDER and the checks themselves
// are unchanged -- only what a failure carries.
import { describe, expect, test } from "bun:test";
import { validate, type ValidationContext } from "./validate";

const CAMEL_CASE = /[a-z][A-Z]/;
const HOST_PORT = /(?:\d{1,3}\.){3}\d{1,3}:\d{2,5}/;

const BASE_CTX: ValidationContext = {
  candidateFunctionIds: ["record_work_progress", "review_budget", "approve_variation", "list_customers"],
  boqLineItemIds: new Set(["boq_line_1", "boq_line_2"]),
  userPermittedFunctionIds: new Set(["record_work_progress", "review_budget", "approve_variation", "list_customers"]),
  reachableProjectIds: new Set(["project_1"]),
};

const FULL_PROGRESS_PARAMS = { itemCode: "EX-01", percent: 50, projectId: "project_1" };

describe("validate() -- every M26 check, first failure wins", () => {
  test("a fully valid candidate passes and returns its params", () => {
    const r = validate({ functionId: "record_work_progress", params: FULL_PROGRESS_PARAMS }, BASE_CTX);
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.params).toEqual(FULL_PROGRESS_PARAMS);
  });

  test("function_id not in the candidate set -> FAIL, not a lower-confidence suggestion", () => {
    const r = validate({ functionId: "delete_organisation", params: {} }, BASE_CTX);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.code).toBe("FUNCTION_NOT_AVAILABLE");
  });

  test("boq_line_item_id that does not exist IN THIS BOQ -> BOQ_LINE_NOT_FOUND", () => {
    const r = validate(
      { functionId: "record_work_progress", params: { ...FULL_PROGRESS_PARAMS, boqLineItemId: "boq_line_from_a_different_boq" } },
      BASE_CTX
    );
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(r.code).toBe("BOQ_LINE_NOT_FOUND");
      expect(r.missing).toEqual(["boqLineItemId"]);
    }
  });

  test("a real boq_line_item_id from the RIGHT boq passes that check", () => {
    const r = validate({ functionId: "record_work_progress", params: { ...FULL_PROGRESS_PARAMS, boqLineItemId: "boq_line_2" } }, BASE_CTX);
    expect(r.valid).toBe(true);
  });

  test("percent out of range -> VALUE_OUT_OF_RANGE", () => {
    const r = validate({ functionId: "record_work_progress", params: { ...FULL_PROGRESS_PARAMS, percent: 150 } }, BASE_CTX);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.code).toBe("VALUE_OUT_OF_RANGE");
  });

  test("percent as a non-number -> VALUE_REQUIRED", () => {
    const r = validate({ functionId: "record_work_progress", params: { ...FULL_PROGRESS_PARAMS, percent: "fifty" } }, BASE_CTX);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.code).toBe("VALUE_REQUIRED");
  });

  test("negative percent -> FAIL", () => {
    const r = validate({ functionId: "record_work_progress", params: { ...FULL_PROGRESS_PARAMS, percent: -5 } }, BASE_CTX);
    expect(r.valid).toBe(false);
  });

  test("an *Id param that is an empty string -> the code for that parameter", () => {
    const r = validate({ functionId: "record_work_progress", params: { ...FULL_PROGRESS_PARAMS, boqLineItemId: "" } }, BASE_CTX);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.code).toBe("BOQ_LINE_REQUIRED");
  });

  test("user not permitted -> NOT_PERMITTED even though function_id is a valid candidate", () => {
    const ctx: ValidationContext = { ...BASE_CTX, userPermittedFunctionIds: new Set(["approve_variation"]) };
    const r = validate({ functionId: "record_work_progress", params: FULL_PROGRESS_PARAMS }, ctx);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.code).toBe("NOT_PERMITTED");
  });

  test("project not reachable -> PROJECT_NOT_REACHABLE", () => {
    const r = validate(
      { functionId: "record_work_progress", params: { ...FULL_PROGRESS_PARAMS, projectId: "some_other_project" } },
      BASE_CTX
    );
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.code).toBe("PROJECT_NOT_REACHABLE");
  });

  test("a function with no declared project requirement is not asked for one", () => {
    const r = validate({ functionId: "list_customers", params: {} }, BASE_CTX);
    expect(r.valid).toBe(true);
  });

  test("first failure wins: candidate-set check fires before boq/type/permission/project checks even run", () => {
    const r = validate(
      { functionId: "not_a_real_function", params: { boqLineItemId: "does-not-exist", percent: 999 } },
      BASE_CTX
    );
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.code).toBe("FUNCTION_NOT_AVAILABLE");
  });
});

// ── R67 B-01: the closed vocabulary ────────────────────────────────────────
describe("B-01 -- a named item code that is not in this project's BOQ", () => {
  const ctx: ValidationContext = {
    ...BASE_CTX,
    boqItemCodes: new Set(["EX-01", "EX-02"]),
    projectLabel: "Cedar Heights Villa - Phase 1",
    boqVersion: "Rev0",
  };

  test("returns {code:'BOQ_LINE_NOT_FOUND', missing:['itemCode']} with no prose anywhere in it", () => {
    const r = validate({ functionId: "record_work_progress", params: { itemCode: "1", percent: 50, projectId: "project_1" } }, ctx);
    expect(r.valid).toBe(false);
    if (r.valid) return;
    expect(r.code).toBe("BOQ_LINE_NOT_FOUND");
    expect(r.missing).toEqual(["itemCode"]);
    // The values the client's sentence interpolates are real business data.
    expect(r.context).toEqual({ itemCode: "1", project: "Cedar Heights Villa - Phase 1", version: "Rev0" });
    // And the whole object contains no host:port and no camelCase sentence.
    const serialised = JSON.stringify({ code: r.code, missing: r.missing, picker: r.picker });
    expect(serialised).not.toMatch(HOST_PORT);
    expect(r.code).not.toMatch(CAMEL_CASE);
    expect(r.picker).toBe("boq-line");
  });

  test("an item code that IS in the BOQ passes", () => {
    const r = validate({ functionId: "record_work_progress", params: { itemCode: "EX-02", percent: 50, projectId: "project_1" } }, ctx);
    expect(r.valid).toBe(true);
  });

  test("the check is skipped entirely when the caller could not resolve the BOQ codes", () => {
    const r = validate({ functionId: "record_work_progress", params: { itemCode: "1", percent: 50, projectId: "project_1" } }, BASE_CTX);
    expect(r.valid).toBe(true); // executor.ts re-checks against the real BOQ
  });
});

describe("B-01 -- a missing declared parameter is asked for, in the closed vocabulary", () => {
  test("no BOQ line at all -> BOQ_LINE_REQUIRED", () => {
    const r = validate({ functionId: "record_work_progress", params: { percent: 50, projectId: "project_1" } }, BASE_CTX);
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(r.code).toBe("BOQ_LINE_REQUIRED");
      // R67 B-09/B-10 narrowed this from the classifier's parameter name
      // ("itemCode") to the D-03 vocabulary key. A NOT_FOUND still reports
      // the parameter that carried the bad value -- that is a different
      // fact, and the test above it asserts exactly that.
      expect(r.missing).toEqual(["boqLine"]);
    }
  });

  test("no value at all -> VALUE_REQUIRED", () => {
    const r = validate({ functionId: "record_work_progress", params: { itemCode: "EX-01", projectId: "project_1" } }, BASE_CTX);
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(r.code).toBe("VALUE_REQUIRED");
      expect(r.missing).toEqual(["percent"]);
    }
  });
});

// ── R67 B-02: "Review Budget -- blocked -- no project resolved for this task" ─
describe("B-02 -- the submission's own projectId resolves a project-scoped function", () => {
  test("review_budget with params {} and a submission carrying projectId 'p1' is VALID with params.projectId === 'p1'", () => {
    const ctx: ValidationContext = {
      ...BASE_CTX,
      reachableProjectIds: new Set(["p1"]),
      submissionProjectId: "p1",
    };
    const r = validate({ functionId: "review_budget", params: {} }, ctx);
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.params.projectId).toBe("p1");
  });

  test("an explicit params.projectId still wins over the submission's", () => {
    const ctx: ValidationContext = {
      ...BASE_CTX,
      reachableProjectIds: new Set(["p1", "project_1"]),
      submissionProjectId: "p1",
    };
    const r = validate({ functionId: "review_budget", params: { projectId: "project_1" } }, ctx);
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.params.projectId).toBe("project_1");
  });

  test("with no project anywhere it returns {code:'PROJECT_REQUIRED', missing:['projectId']} and no function id or camelCase in any rendered field", () => {
    const ctx: ValidationContext = { ...BASE_CTX, submissionProjectId: null };
    const r = validate({ functionId: "review_budget", params: {} }, ctx);
    expect(r.valid).toBe(false);
    if (r.valid) return;
    expect(r.code).toBe("PROJECT_REQUIRED");
    expect(r.missing).toEqual(["projectId"]);
    expect(r.picker).toBe("project");
    // Nothing renderable carries a function id or a camelCase sentence:
    // `missing` is a machine field the client maps through its dictionary,
    // and `code`/`picker` are the only other things it receives.
    expect(r.code).not.toContain("review_budget");
    expect(r.code).not.toMatch(CAMEL_CASE);
    expect(r.picker).not.toMatch(CAMEL_CASE);
    expect(r.context).toBeUndefined();
  });
});

// ── R67 B-07: a BOQ line picked from the server's OWN chips counts ─────────
// The verdict offers the project's real lines addressed by their record id,
// so what comes back on confirm is `boqLineItemId`, not the human item code
// the classifier extracts. Without this, a user who clicked exactly what the
// server offered would be asked for the BOQ line again, for ever.
describe("B-07 -- boqLineItemId answers the same question as itemCode", () => {
  test("a record id from the chips satisfies the BOQ-line requirement", () => {
    const ctx = { ...BASE_CTX, boqLineItemIds: new Set(["line_9"]) };
    const r = validate(
      { functionId: "record_work_progress", params: { boqLineItemId: "line_9", percent: 50, projectId: "project_1" } },
      ctx
    );
    expect(r.valid).toBe(true);
  });

  test("neither one supplied is still BOQ_LINE_REQUIRED, named in the D-03 vocabulary", () => {
    const r = validate({ functionId: "record_work_progress", params: { percent: 50, projectId: "project_1" } }, BASE_CTX);
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(r.code).toBe("BOQ_LINE_REQUIRED");
      expect(r.missing).toEqual(["boqLine"]);
    }
  });
})

// ── R67 B-11: "record 2 nos done today" ────────────────────────────────────
describe("B-11 -- a quantity answers 'how much is done' as well as a percent does", () => {
  test("quantityDone alone satisfies the value requirement", () => {
    const r = validate(
      { functionId: "record_work_progress", params: { itemCode: "EX-01", projectId: "project_1", quantityDone: 2 } },
      BASE_CTX
    );
    expect(r.valid).toBe(true);
  });

  test("neither a percent nor a quantity is still VALUE_REQUIRED", () => {
    const r = validate({ functionId: "record_work_progress", params: { itemCode: "EX-01", projectId: "project_1" } }, BASE_CTX);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.code).toBe("VALUE_REQUIRED");
  });
});

// R67 C-03 (decision D-03) -- the failure now carries a CODE and the FIELD,
// so a product can render a closed-vocabulary sentence instead of `reason`,
// which is written for an engineer reading a log.
// R67 WS-C (C-03), rewritten in the FIX PASS.
//
// Lane C added this block when validate() still returned `{ valid:false,
// reason }` and C-03 was adding `code`/`missing` beside it. Lane B has since
// merged to main and gone further: `reason` is GONE -- a failure is a
// PipelineFailure and nothing here composes English at all -- and the
// vocabulary is finer (VALUE_OUT_OF_RANGE and PROJECT_NOT_REACHABLE are
// distinct from VALUE_REQUIRED and PROJECT_REQUIRED). Under D-11 main is
// canonical, so this block now asserts MAIN's behaviour, and keeps only the
// cases main's own describes above do not already cover.
describe("validate() -- the closed-vocabulary payload, per lane B", () => {
  test("no user-facing sentence survives validation at all", () => {
    const r = validate({ functionId: "delete_organisation", params: {} }, BASE_CTX);
    expect(r.valid).toBe(false);
    if (r.valid) return;
    // THE POINT OF D-03: there is no `reason` string to leak. The client owns
    // the wording; this side owns the code.
    expect((r as unknown as { reason?: unknown }).reason).toBeUndefined();
    expect(r.code).toBe("FUNCTION_NOT_AVAILABLE");
    expect(r.missing).toEqual([]);
  });

  test("an out-of-range percent is its OWN code, not a missing value", () => {
    const r = validate({ functionId: "record_work_progress", params: { ...FULL_PROGRESS_PARAMS, percent: 999 } }, BASE_CTX);
    expect(r.valid).toBe(false);
    if (r.valid) return;
    // A number that IS there and is wrong is a different question from one
    // that is absent -- "999 is not a percentage" vs "type a percentage".
    expect(r.code).toBe("VALUE_OUT_OF_RANGE");
    expect(r.missing).toEqual(["percent"]);
  });

  test("a project this caller cannot reach is not reported as a missing project", () => {
    const r = validate({ functionId: "record_work_progress", params: { ...FULL_PROGRESS_PARAMS, projectId: "other" } }, BASE_CTX);
    expect(r.valid).toBe(false);
    if (r.valid) return;
    expect(r.code).toBe("PROJECT_NOT_REACHABLE");
    expect(r.missing).toEqual(["projectId"]);
  });

  test("a permission refusal is never dressed up as a missing value", () => {
    const ctx: ValidationContext = { ...BASE_CTX, userPermittedFunctionIds: new Set() };
    const r = validate({ functionId: "record_work_progress", params: FULL_PROGRESS_PARAMS }, ctx);
    expect(r.valid).toBe(false);
    if (r.valid) return;
    expect(r.code).toBe("NOT_PERMITTED");
    expect(r.missing).toEqual([]);
  });
});
