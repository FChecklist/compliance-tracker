/// <reference types="bun-types" />
// R67 F-02 (R-018/R-021), review fix -- REGRESSION GUARD FOR A SILENT FEATURE LOSS.
//
// WHAT HAPPENED. F-02 removed `documentUrl` from the GET
// /api/v1/projexa/permits list DTO: the register no longer mints a Supabase
// Storage signed URL per row, it reports `hasDocument` and the URL is signed on
// click. PROJEXA's own list client was migrated. THIS page -- VERIDIAN's own
// shipped Permits screen -- consumes the same endpoint and was not, so every
// permit's "View" link silently became "--".
//
// It was invisible to every gate: this page casts an untyped `res.json()` into
// a local `Permit` type, so `p.documentUrl` was simply `undefined` at runtime.
// Typecheck, lint and the full suite were all green with the regression
// present. That is precisely the class of defect a test has to catch, because
// nothing else can.
//
// WHY SOURCE ASSERTIONS. There is no jsdom/@testing-library/react in this repo
// (see package.json, and src/components/AppShell.test.ts's own header for the
// same constraint and the same answer): this reads the page's source and
// asserts the shape the fix gave it, rather than rendering it.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const source = readFileSync(join(import.meta.dir, "page.tsx"), "utf8");

// The `load` callback -- everything this page does on arrival. The click
// handler is deliberately NOT in here; that separation is the fix.
const loadBlock = source.match(/const load = useCallback\(([\s\S]*?)\n {2}\}, \[projectId\]\);/)?.[1] ?? "";

describe("VERIDIAN /permits reads the F-02 register contract", () => {
  test("the local Permit type declares hasDocument", () => {
    const permitType = source.match(/type Permit = \{([\s\S]*?)\};/)?.[1] ?? "";
    expect(permitType).toContain("hasDocument: boolean");
  });

  test("the page never reads documentUrl off a LIST row -- that key no longer exists", () => {
    // `p` is the row variable in the table body. Reading p.documentUrl would
    // be `undefined` forever and render every View link as a dash.
    expect(source).not.toMatch(/\bp\.documentUrl\b/);
  });

  test("the View control is gated on hasDocument", () => {
    expect(source).toMatch(/\{p\.hasDocument \?/);
  });

  test("nothing on this page renders a raw <a href={...documentUrl}> from a list row", () => {
    // The old shape. A signed URL can only come from the object route now, so
    // an anchor built straight from a row field is the regression returning.
    expect(source).not.toMatch(/<a href=\{p\.documentUrl\}/);
  });
});

describe("the signed URL is minted on click, not once per row on load", () => {
  test("the load callback is isolatable (if the page was refactored, update this regex, do not delete the test)", () => {
    expect(loadBlock).toBeTruthy();
  });

  test("arriving on the page fetches ONLY the register", () => {
    // One fetch in `load`, and it is the list. If a future edit put a
    // per-permit document lookup back in here, the N+1 this item removed
    // would be back with it.
    const fetches = loadBlock.match(/fetch\(/g) ?? [];
    expect(fetches).toHaveLength(1);
    expect(loadBlock).toContain("/api/v1/projexa/permits?");
    expect(loadBlock).not.toContain("document-url");
  });

  test("the object route is called from the click handler, and only from there", () => {
    const clickHandler = source.match(/const openPermitDocument = async \(permit: Permit\) => \{([\s\S]*?)\n {2}\};/)?.[1] ?? "";
    expect(clickHandler).toBeTruthy();
    expect(clickHandler).toContain("/api/v1/projexa/permits/${encodeURIComponent(permit.id)}");
    // Exactly one call site for the detail DTO in the whole file.
    const detailCalls = source.match(/permits\/\$\{encodeURIComponent\(permit\.id\)\}/g) ?? [];
    expect(detailCalls).toHaveLength(1);
  });

  test("the blank tab is opened BEFORE the await, or a popup blocker kills it", () => {
    const clickHandler = source.match(/const openPermitDocument = async \(permit: Permit\) => \{([\s\S]*?)\n {2}\};/)?.[1] ?? "";
    const openIndex = clickHandler.indexOf('window.open("", "_blank"');
    const awaitIndex = clickHandler.indexOf("await fetch");
    expect(openIndex).toBeGreaterThan(-1);
    expect(awaitIndex).toBeGreaterThan(-1);
    // A browser only treats window.open() as user-initiated inside the click
    // handler's own turn.
    expect(openIndex).toBeLessThan(awaitIndex);
  });

  test("a failure closes the tab it opened rather than leaving a blank one", () => {
    const clickHandler = source.match(/const openPermitDocument = async \(permit: Permit\) => \{([\s\S]*?)\n {2}\};/)?.[1] ?? "";
    expect(clickHandler).toContain("tab?.close()");
  });
});
