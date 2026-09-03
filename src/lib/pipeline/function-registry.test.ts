/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  ALL_FUNCTION_SPECS,
  WRITE_FUNCTION_IDS,
  functionKind,
  functionLabel,
  functionSpec,
  requiredParamSatisfied,
} from "./function-registry";
import { FIELD_VOCABULARY, PIPELINE_ERROR_CODES, vocabularyKeyForParam } from "./error-codes";
import { hasExecutor } from "./executor";

// R67 FIX PASS -- the registry is the single source of "what does this
// function need, what does it write, and what does the confirm button say".
// Every consumer (validate, the executor's server-side re-check, chain-options,
// the dry run) was tested; the registry's OWN invariants were not, so a spec
// added later could quietly declare a code the vocabulary does not hold, or a
// write with no executor behind it. These assertions run over EVERY spec.

describe("every spec's declared failure code is in the closed vocabulary", () => {
  test("no requiredParam names a code error-codes.ts does not define", () => {
    for (const spec of ALL_FUNCTION_SPECS) {
      for (const required of spec.requiredParams) {
        expect(PIPELINE_ERROR_CODES as readonly string[]).toContain(required.code);
      }
    }
  });

  test("every declared `field` is a D-03 vocabulary key, never a camelCase parameter", () => {
    for (const spec of ALL_FUNCTION_SPECS) {
      for (const required of spec.requiredParams) {
        if (required.field === undefined) continue;
        expect(FIELD_VOCABULARY as readonly string[]).toContain(required.field);
      }
    }
  });

  test("a parameter with no declared field still resolves to a readable key", () => {
    // The rule that stops "itemCode" reaching a screen through `missing`:
    // every required parameter resolves EITHER to one of the eight D-03
    // vocabulary keys, or to a single readable lower-case word of its own
    // ("title", "name", "category"). Never to a camelCase internal name.
    for (const spec of ALL_FUNCTION_SPECS) {
      for (const required of spec.requiredParams) {
        const key = required.field ?? vocabularyKeyForParam(required.name);
        const isVocabulary = (FIELD_VOCABULARY as readonly string[]).includes(key);
        if (!isVocabulary) expect(key).toMatch(/^[a-z]+$/);
        expect(key).not.toMatch(/_/);
      }
    }
  });
});

describe("writes and executors cannot drift apart", () => {
  test("every spec with writes:true has a real executor behind it", () => {
    for (const spec of ALL_FUNCTION_SPECS) {
      if (!spec.writes) continue;
      expect(hasExecutor(spec.functionId)).toBe(true);
    }
  });

  test("WRITE_FUNCTION_IDS is exactly the writes:true specs -- no read has leaked in", () => {
    const declared = ALL_FUNCTION_SPECS.filter((s) => s.writes).map((s) => s.functionId).sort();
    expect([...WRITE_FUNCTION_IDS].sort()).toEqual(declared);
    // A read that drifted into this set would let classify.ts run a write
    // off a question, so name the one the R66 walkthrough cared about.
    expect(WRITE_FUNCTION_IDS.has("review_budget")).toBe(false);
  });

  test("kind and writes agree: only kind 'write' writes", () => {
    for (const spec of ALL_FUNCTION_SPECS) {
      expect(spec.writes).toBe(spec.kind === "write");
      expect(functionKind(spec.functionId)).toBe(spec.kind);
    }
  });

  test("a COMMAND verb carries the route it opens; nothing else does", () => {
    for (const spec of ALL_FUNCTION_SPECS) {
      if (spec.kind === "run") {
        expect(typeof spec.route).toBe("string");
        expect(spec.route!.startsWith("/")).toBe(true);
      } else {
        expect(spec.route).toBeUndefined();
      }
    }
  });
});

describe("the confirmation card says what it will do", () => {
  test("every write has a card, and its primary label is a real verb phrase -- never 'Submit'", () => {
    for (const spec of ALL_FUNCTION_SPECS) {
      if (!spec.writes) continue;
      expect(spec.card).toBeDefined();
      const label = spec.card!.primaryLabel;
      expect(label).not.toBe("Submit");
      expect(label).not.toBe("OK");
      expect(label).not.toBe("Confirm");
      // Two words at least ("Save progress"), and never a function id.
      expect(label.trim().split(/\s+/).length).toBeGreaterThanOrEqual(2);
      expect(label).not.toMatch(/_/);
    }
  });

  test("every REQUIRED select names the chain-options picker that fills it", () => {
    for (const spec of ALL_FUNCTION_SPECS) {
      for (const field of spec.card?.fields ?? []) {
        // An optional select carries its own fixed options and a default
        // ("status" -> present); a REQUIRED one must be fillable from real
        // records, or it is a dead control the user cannot get past.
        if (field.type !== "select" || !field.required) continue;
        expect(typeof field.picker).toBe("string");
        expect(field.picker!.length).toBeGreaterThan(0);
      }
    }
  });

  test("every required card field has a label, and no field key leaks into one", () => {
    for (const spec of ALL_FUNCTION_SPECS) {
      for (const field of spec.card?.fields ?? []) {
        expect(field.label.length).toBeGreaterThan(0);
        expect(field.label).not.toBe(field.key);
      }
    }
  });
});

describe("functionLabel -- the only name a user-facing surface may print", () => {
  test("a registered id yields its human label", () => {
    expect(functionLabel("record_work_progress")).toBe("Record progress");
    expect(functionLabel("review_budget")).toBe("Review Budget");
  });

  test("an UNREGISTERED id still reads as words -- never 'Record record_work_progress'", () => {
    expect(functionLabel("approve_variation")).toBe("Approve variation");
    expect(functionLabel("list_open_snags_today")).toBe("List open snags today");
  });

  test("no registered label is a snake_case function id", () => {
    for (const spec of ALL_FUNCTION_SPECS) {
      expect(spec.label).not.toMatch(/_/);
      expect(spec.label.length).toBeGreaterThan(0);
    }
  });

  test("a label with no underscores at all is returned unchanged", () => {
    expect(functionLabel("dashboard")).toBe("Dashboard");
    expect(functionLabel("")).toBe("");
  });
});

describe("requiredParamSatisfied -- the one predicate every caller shares", () => {
  const boqLine = functionSpec("record_work_progress")!.requiredParams.find((p) => p.name === "itemCode")!;

  test("the parameter's own name answers it", () => {
    expect(requiredParamSatisfied(boqLine, { itemCode: "EX-01" })).toBe(true);
  });

  test("an alsoSatisfiedBy alias answers it -- the chip the server itself offered", () => {
    expect(requiredParamSatisfied(boqLine, { boqLineItemId: "l_1" })).toBe(true);
  });

  test("blank, whitespace and absent are all unanswered", () => {
    expect(requiredParamSatisfied(boqLine, {})).toBe(false);
    expect(requiredParamSatisfied(boqLine, { itemCode: "" })).toBe(false);
    expect(requiredParamSatisfied(boqLine, { itemCode: "   " })).toBe(false);
    expect(requiredParamSatisfied(boqLine, { itemCode: null })).toBe(false);
  });

  test("the fallback answers projectId, and only when it is not blank", () => {
    const project = functionSpec("record_attendance")!.requiredParams.find((p) => p.name === "projectId")!;
    expect(requiredParamSatisfied(project, {}, "p1")).toBe(true);
    expect(requiredParamSatisfied(project, {}, null)).toBe(false);
    expect(requiredParamSatisfied(project, {}, "")).toBe(false);
  });
});

describe("the catalogue has no duplicates", () => {
  test("each function id appears exactly once", () => {
    const ids = ALL_FUNCTION_SPECS.map((s) => s.functionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("requiresProject is declared for every spec, and every spec has a module", () => {
    for (const spec of ALL_FUNCTION_SPECS) {
      expect(typeof spec.requiresProject).toBe("boolean");
      expect(spec.module.length).toBeGreaterThan(0);
    }
  });
});
