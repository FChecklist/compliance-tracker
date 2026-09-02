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
      expect(r.missing).toEqual(["itemCode"]);
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

