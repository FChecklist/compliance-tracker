/// <reference types="bun-types" />
// R67 F-02 (R-030/R-035), review fix -- REGRESSION GUARD FOR A SILENT FEATURE LOSS.
//
// WHAT HAPPENED. F-02 changed GET /api/v1/projexa/drawings so `documentUrl` is
// null for every STORAGE-BACKED row (only an external-link walkthrough, which
// costs no I/O, still carries one); rows report `hasDocument`, and the URL is
// signed on click by GET /drawings/{id}/document-url. PROJEXA's DrawingsClient
// was migrated. THIS page -- VERIDIAN's own shipped Drawings screen -- consumes
// the same endpoint and was not, so every uploaded drawing's "Open" link
// silently became "--" while external links kept working, which is the worst
// version of the bug: it looks like it still works.
//
// No gate could see it: the page casts an untyped `res.json()` into a local
// `Drawing` type, so `d.documentUrl` was simply null at runtime.
//
// WHY SOURCE ASSERTIONS. There is no jsdom/@testing-library/react in this repo
// (see package.json, and src/components/AppShell.test.ts's header for the same
// constraint and the same answer).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const source = readFileSync(join(import.meta.dir, "page.tsx"), "utf8");

const loadBlock = source.match(/const load = useCallback\(([\s\S]*?)\n {2}\}, \[projectId\]\);/)?.[1] ?? "";
const clickHandler = source.match(/const openDrawing = async \(drawing: Drawing\) => \{([\s\S]*?)\n {2}\};/)?.[1] ?? "";

describe("VERIDIAN /drawings reads the F-02 register contract", () => {
  test("the local Drawing type declares hasDocument alongside documentUrl", () => {
    // BOTH: documentUrl survives for the external-link case (already a URL,
    // nothing to sign), hasDocument covers the stored-file case.
    const drawingType = source.match(/type Drawing = \{([\s\S]*?)\};/)?.[1] ?? "";
    expect(drawingType).toContain("hasDocument: boolean");
    expect(drawingType).toContain("documentUrl: string | null");
  });

  test("the Open control is NOT gated on documentUrl alone", () => {
    // The regression exactly: `{d.documentUrl ? <a .../> : "--"}` renders a
    // dash for every uploaded drawing, because that field is null for them now.
    expect(source).not.toMatch(/\{d\.documentUrl \? \(/);
    expect(source).toMatch(/\{d\.documentUrl \|\| d\.hasDocument \?/);
  });

  test("no anchor is built straight from a list row's documentUrl", () => {
    expect(source).not.toMatch(/<a href=\{d\.documentUrl\}/);
  });
});

describe("the signed URL is minted on click, not once per row on load", () => {
  test("the load callback is isolatable (if the page was refactored, update this regex, do not delete the test)", () => {
    expect(loadBlock).toBeTruthy();
  });

  test("arriving on the page fetches ONLY the register", () => {
    const fetches = loadBlock.match(/fetch\(/g) ?? [];
    expect(fetches).toHaveLength(1);
    expect(loadBlock).toContain("/api/v1/projexa/drawings?");
    expect(loadBlock).not.toContain("document-url");
  });

  test("an external link opens directly -- no request at all", () => {
    expect(clickHandler).toBeTruthy();
    // The early return is what makes it free; without it every external-link
    // walkthrough would pay a pointless round trip to sign a URL it already has.
    const earlyReturn = clickHandler.match(/if \(drawing\.documentUrl\) \{([\s\S]*?)\n {4}\}/)?.[1] ?? "";
    expect(earlyReturn).toContain("window.open(drawing.documentUrl");
    expect(earlyReturn).toContain("return;");
    expect(earlyReturn).not.toContain("fetch(");
  });

  test("a stored file resolves through the document-url endpoint, once", () => {
    expect(clickHandler).toContain("/document-url");
    const calls = source.match(/document-url/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  test("the blank tab is opened BEFORE the await, or a popup blocker kills it", () => {
    const openIndex = clickHandler.indexOf('window.open("", "_blank"');
    const awaitIndex = clickHandler.indexOf("await fetch");
    expect(openIndex).toBeGreaterThan(-1);
    expect(awaitIndex).toBeGreaterThan(-1);
    expect(openIndex).toBeLessThan(awaitIndex);
  });

  test("a failure closes the tab it opened rather than leaving a blank one", () => {
    expect(clickHandler).toContain("tab?.close()");
  });
});
