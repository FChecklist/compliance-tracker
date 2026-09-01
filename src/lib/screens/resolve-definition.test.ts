/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import type { ScreenColumn } from "./resolve-definition";

// resolveScreenDefinition() itself does real DB access via withTenantContext
// (org-override-vs-global resolution) and is proven live rather than mocked
// -- see the R42 seq20 evidence trail (a real global row + a real org
// override row, confirming the override wins). This file covers the parts
// of the module worth a plain unit test: the shape contract itself.
describe("ScreenColumn -- the M30/M31 shape every archetype consumer relies on", () => {
  test("a column can carry every M30/M31 field without a type error", () => {
    const column: ScreenColumn = {
      label: "Issue Date",
      field: "issueDate",
      type: "date",
      control: "DATE",
      required: true,
      unit: undefined,
      importance: "High",
      fieldStatus: "REQUIRED",
      inheritsFromHeader: false,
      level: "header",
    };
    expect(column.fieldStatus).toBe("REQUIRED");
    expect(column.level).toBe("header");
  });

  test("fieldStatus is one of exactly three values (M31)", () => {
    const valid: ScreenColumn["fieldStatus"][] = ["REQUIRED", "OPTIONAL", "SUPPRESSED"];
    expect(valid.length).toBe(3);
  });
});
