/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { validate, type ValidationContext } from "./validate";

const BASE_CTX: ValidationContext = {
  candidateFunctionIds: ["record_work_progress", "approve_variation"],
  boqLineItemIds: new Set(["boq_line_1", "boq_line_2"]),
  userPermittedFunctionIds: new Set(["record_work_progress", "approve_variation"]),
  reachableProjectIds: new Set(["project_1"]),
};

describe("validate() -- every M26 check, first failure wins", () => {
  test("a fully valid candidate passes", () => {
    const r = validate({ functionId: "record_work_progress", params: { boqLineItemId: "boq_line_1", percent: 50, projectId: "project_1" } }, BASE_CTX);
    expect(r).toEqual({ valid: true });
  });

  test("function_id not in the candidate set -> FAIL, not a lower-confidence suggestion", () => {
    const r = validate({ functionId: "delete_organisation", params: {} }, BASE_CTX);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toContain("not in this module's candidate set");
  });

  test("boq_line_item_id that does not exist IN THIS BOQ -> FAIL", () => {
    const r = validate({ functionId: "record_work_progress", params: { boqLineItemId: "boq_line_from_a_different_boq" } }, BASE_CTX);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toContain("does not exist in this BOQ");
  });

  test("a real boq_line_item_id from the RIGHT boq passes that check", () => {
    const r = validate({ functionId: "record_work_progress", params: { boqLineItemId: "boq_line_2" } }, BASE_CTX);
    expect(r.valid).toBe(true);
  });

  test("percent out of range -> FAIL (type/range check)", () => {
    const r = validate({ functionId: "record_work_progress", params: { percent: 150 } }, BASE_CTX);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toContain("percent");
  });

  test("percent as a non-number -> FAIL", () => {
    const r = validate({ functionId: "record_work_progress", params: { percent: "fifty" } }, BASE_CTX);
    expect(r.valid).toBe(false);
  });

  test("negative percent -> FAIL", () => {
    const r = validate({ functionId: "record_work_progress", params: { percent: -5 } }, BASE_CTX);
    expect(r.valid).toBe(false);
  });

  test("an *Id param that is an empty string -> FAIL", () => {
    const r = validate({ functionId: "record_work_progress", params: { boqLineItemId: "" } }, BASE_CTX);
    expect(r.valid).toBe(false);
  });

  test("user not permitted -> FAIL even though function_id is a valid candidate", () => {
    const ctx: ValidationContext = { ...BASE_CTX, userPermittedFunctionIds: new Set(["approve_variation"]) };
    const r = validate({ functionId: "record_work_progress", params: {} }, ctx);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toContain("not permitted");
  });

  test("project not reachable -> FAIL", () => {
    const r = validate({ functionId: "record_work_progress", params: { projectId: "some_other_project" } }, BASE_CTX);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toContain("not reachable");
  });

  test("no boqLineItemId/projectId params at all -> those two checks are simply skipped, not a failure", () => {
    const r = validate({ functionId: "record_work_progress", params: { percent: 50 } }, BASE_CTX);
    expect(r.valid).toBe(true);
  });

  test("first failure wins: candidate-set check fires before boq/type/permission/project checks even run", () => {
    const r = validate(
      { functionId: "not_a_real_function", params: { boqLineItemId: "does-not-exist", percent: 999 } },
      BASE_CTX
    );
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toContain("not in this module's candidate set");
  });
});
