/// <reference types="bun-types" />
// Ported from PROJEXA's src/lib/reference-lookups.test.ts (R80 GAP-8) --
// only the soleOptionId cases, matching the port's scope in
// reference-lookups.ts (loadVendors/invalidateVendors/rememberedOption are
// not ported here, so their tests aren't either).
import { describe, expect, test } from "bun:test";
import { soleOptionId } from "./reference-lookups";

describe("soleOptionId", () => {
  test("exactly one row is not a choice, so it is the answer", () => {
    expect(soleOptionId([{ id: "opening-1" }])).toBe("opening-1");
  });

  test("two rows is a real question and stays unanswered", () => {
    expect(soleOptionId([{ id: "opening-1" }, { id: "opening-2" }])).toBeNull();
  });

  test("an empty, null or undefined list seeds nothing", () => {
    expect(soleOptionId([])).toBeNull();
    expect(soleOptionId(null)).toBeNull();
    expect(soleOptionId(undefined)).toBeNull();
  });

  test("a blank id is no id -- it would set the field to the empty answer", () => {
    expect(soleOptionId([{ id: "" }])).toBeNull();
    expect(soleOptionId([{ id: "   " }])).toBeNull();
  });

  test("extra columns on the row are irrelevant; only the id is read", () => {
    expect(soleOptionId([{ id: "cand-9", name: "Jane Doe" }])).toBe("cand-9");
  });
});
