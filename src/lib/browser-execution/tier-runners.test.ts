import { describe, expect, test } from "bun:test";
import { parseCategoryFromModelOutput } from "./tier-runners";

describe("parseCategoryFromModelOutput", () => {
  test("parses an exact category word", () => {
    expect(parseCategoryFromModelOutput("TASK")).toBe("TASK");
  });

  test("is case-insensitive and trims whitespace", () => {
    expect(parseCategoryFromModelOutput("  task  ")).toBe("TASK");
    expect(parseCategoryFromModelOutput("Query")).toBe("QUERY");
  });

  test("finds a category embedded in a longer reply", () => {
    expect(parseCategoryFromModelOutput("The category is: ANALYSIS.")).toBe("ANALYSIS");
  });

  test("returns null for unparseable output", () => {
    expect(parseCategoryFromModelOutput("I'm not sure what you mean")).toBe(null);
  });

  test("returns null for empty output", () => {
    expect(parseCategoryFromModelOutput("")).toBe(null);
  });
});
