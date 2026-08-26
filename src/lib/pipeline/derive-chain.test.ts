/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { buildChain, deriveChain, NAV_PATH_BY_FUNCTION, type ChainRepo, type ScreenFacts } from "./derive-chain";

// R53 Phase 5. PHRASE -> FUNCTION -> CHAIN, never the reverse.
//
// THE DEFECT THESE GUARD: derived_chain is NULL on all 16 live
// compliance.pipeline_tasks rows and selected_chain is NULL on all 16
// compliance.submissions rows. Nothing has ever written either.

const OAKWOOD = "Oakwood Residence - Full Renovation";

function repoWith(rows: Record<string, ScreenFacts>): ChainRepo {
  return { async findScreen(functionId) { return rows[functionId] ?? null; } };
}

describe("buildChain() -- tier 1: compliance.screen_definitions", () => {
  test("a breadcrumb_template fills its placeholders and drops the generic root", () => {
    const c = buildChain({
      mode: "Projects",
      rootLabel: OAKWOOD,
      functionId: "permits.object",
      params: { permitNumber: "PMT-014" },
      // the ONE real breadcrumb_template in the live table, verbatim
      screen: { functionId: "permits.object", breadcrumbTemplate: "Permits · {project} · {permitNumber}", flowParent: null },
    });
    // {project} renders as the root, so it must not also appear as a step
    expect(c.steps).toEqual(["Permits", OAKWOOD, "PMT-014"]);
    expect(c.full).toBe(`${OAKWOOD} > Permits > ${OAKWOOD} > PMT-014`);
  });

  test("an unfilled placeholder is DROPPED, never rendered as literal braces", () => {
    const c = buildChain({
      mode: "Projects",
      rootLabel: OAKWOOD,
      functionId: "permits.object",
      params: {},
      screen: { functionId: "permits.object", breadcrumbTemplate: "Permits · {permitNumber}", flowParent: null },
    });
    expect(c.steps).toEqual(["Permits"]);
    expect(c.full).not.toContain("{");
  });

  test("flow_parent ancestors are walked, furthest first", () => {
    const c = buildChain({
      mode: "Projects",
      rootLabel: OAKWOOD,
      functionId: "boq.compare",
      params: {},
      screen: { functionId: "boq.compare", breadcrumbTemplate: null, flowParent: "boq.custom" },
      ancestors: [{ functionId: "boq.custom", breadcrumbTemplate: null, flowParent: null }],
    });
    expect(c.full.startsWith(`${OAKWOOD} > `)).toBe(true);
    expect(c.steps.length).toBeGreaterThan(1);
  });
});

describe("buildChain() -- tier 2: platform.uat_function nav_path", () => {
  test("record_work_progress derives the real F030 nav_path", () => {
    const c = buildChain({ mode: "Projects", rootLabel: OAKWOOD, functionId: "record_work_progress", params: {}, screen: null });
    expect(c.steps).toEqual(["Work Progress", "New entry"]);
    expect(c.full).toBe(`${OAKWOOD} > Work Progress > New entry`);
  });

  test("get_construction_budget_status derives the real F069 nav_path", () => {
    const c = buildChain({ mode: "Projects", rootLabel: OAKWOOD, functionId: "get_construction_budget_status", params: {}, screen: null });
    expect(c.full).toBe(`${OAKWOOD} > Budget`);
  });

  test('the generic "Project" token is dropped -- never "Oakwood > Project > Dashboard"', () => {
    const c = buildChain({ mode: "Projects", rootLabel: OAKWOOD, functionId: "get_construction_project_dashboard", params: {}, screen: null });
    expect(c.steps[0]).not.toBe("Project");
    expect(c.full).toBe(`${OAKWOOD} > Dashboard`);
  });

  test("every mapped nav_path is in M24's grammar and roots on a generic entity token", () => {
    for (const [functionId, nav] of Object.entries(NAV_PATH_BY_FUNCTION)) {
      expect(nav.startsWith("Project > ")).toBe(true);
      expect(functionId).not.toContain(" ");
    }
  });
});

describe("buildChain() -- tier 3: the function_id itself", () => {
  // TIER 3 NEVER RETURNS NOTHING. A NULL derived_chain is the defect this
  // phase exists to remove, so "we could not name it" may never produce one.
  test("an unmapped write function still yields a chain", () => {
    const c = buildChain({ mode: "Projects", rootLabel: OAKWOOD, functionId: "create_site_instruction", params: {}, screen: null });
    expect(c.steps).toEqual(["Site Instruction", "Create"]);
    expect(c.full).toBe(`${OAKWOOD} > Site Instruction > Create`);
  });

  test("an unmapped read function still yields a chain", () => {
    const c = buildChain({ mode: "Projects", rootLabel: OAKWOOD, functionId: "list_pending_rfis", params: {}, screen: null });
    expect(c.steps).toEqual(["Pending Rfis", "View"]);
  });

  test("a function_id with no known verb prefix still yields a chain", () => {
    const c = buildChain({ mode: "Projects", rootLabel: OAKWOOD, functionId: "reconcile_retention", params: {}, screen: null });
    expect(c.steps).toEqual(["Reconcile Retention"]);
  });

  test("no input shape produces an empty chain", () => {
    for (const fid of ["x", "get_", "a_b_c_d_e", "record_work_progress"]) {
      const c = buildChain({ mode: "Projects", rootLabel: null, functionId: fid, params: {}, screen: null });
      expect(c.steps.length).toBeGreaterThan(0);
      expect(c.full.length).toBeGreaterThan(0);
    }
  });
});

describe("buildChain() -- the root", () => {
  test("roots on the project's NAME, never its id", () => {
    const c = buildChain({ mode: "Projects", rootLabel: OAKWOOD, functionId: "record_work_progress", params: {}, screen: null });
    expect(c.root).toBe(OAKWOOD);
    expect(c.full).not.toContain("upv2q7pv8qcwdayybvu74egm");
  });

  test("a null project renders M24's null state, not an empty root", () => {
    const c = buildChain({ mode: "Projects", rootLabel: null, functionId: "record_work_progress", params: {}, screen: null });
    expect(c.root).toBe("All projects");
    expect(c.full).toBe("All projects > Work Progress > New entry");
  });

  test("the grammar generalises to other modes -- M24's ENTITY > ACTION > STEP", () => {
    const c = buildChain({ mode: "Customers", rootLabel: "Skyline Builders", functionId: "create_quotation", params: {}, screen: null });
    expect(c.mode).toBe("Customers");
    expect(c.full).toBe("Skyline Builders > Quotation > Create");
  });
});

describe("deriveChain() -- the DB-backed walk", () => {
  test("prefers screen_definitions over the nav_path fallback", async () => {
    const repo = repoWith({
      record_work_progress: { functionId: "record_work_progress", breadcrumbTemplate: "Progress · Daily", flowParent: null },
    });
    const c = await deriveChain(repo, { mode: "Projects", rootLabel: OAKWOOD, functionId: "record_work_progress", params: {} });
    expect(c.full).toBe(`${OAKWOOD} > Progress > Daily`);
  });

  test("falls back to nav_path when screen_definitions has no row", async () => {
    const c = await deriveChain(repoWith({}), { mode: "Projects", rootLabel: OAKWOOD, functionId: "record_work_progress", params: {} });
    expect(c.full).toBe(`${OAKWOOD} > Work Progress > New entry`);
  });

  // screen_definitions is user-editable data. A cycle in it must degrade to
  // a shorter chain, never hang a request.
  test("a flow_parent CYCLE terminates instead of hanging", async () => {
    const repo = repoWith({
      a: { functionId: "a", breadcrumbTemplate: null, flowParent: "b" },
      b: { functionId: "b", breadcrumbTemplate: null, flowParent: "a" },
    });
    const c = await deriveChain(repo, { mode: "Projects", rootLabel: OAKWOOD, functionId: "a", params: {} });
    expect(c.full.length).toBeGreaterThan(0);
  });

  test("a flow_parent chain deeper than the bound is truncated, not followed forever", async () => {
    const rows: Record<string, ScreenFacts> = {};
    for (let i = 0; i < 50; i++) rows[`f${i}`] = { functionId: `f${i}`, breadcrumbTemplate: null, flowParent: `f${i + 1}` };
    const c = await deriveChain(repoWith(rows), { mode: "Projects", rootLabel: OAKWOOD, functionId: "f0", params: {} });
    expect(c.steps.length).toBeLessThanOrEqual(7);
  });
});

describe("the direction of derivation is one-way by construction", () => {
  // M26: "the phrase is the authority; the chain is OUTPUT, not input."
  // There is no exported function that takes a chain and returns a
  // function_id, so a caller cannot let a pill selection decide what runs.
  test("the module exports no chain -> function resolver", async () => {
    const mod = await import("./derive-chain");
    const names = Object.keys(mod);
    expect(names).toEqual(expect.arrayContaining(["buildChain", "deriveChain", "NAV_PATH_BY_FUNCTION"]));
    for (const n of names) {
      expect(n.toLowerCase()).not.toContain("functionfromchain");
      expect(n.toLowerCase()).not.toContain("resolvechain");
    }
  });
});
