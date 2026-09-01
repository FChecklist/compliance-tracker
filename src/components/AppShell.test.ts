// R57_COMPLIANCE_TRACKER_SIDEBAR_UNMOUNT_01 (High, closed via PR #1396) --
// real regression guard, DB-independent (same class of source-assertion
// test as sales-pipeline-rls.test.ts / crr-p2-schema-rls.test.ts): there is
// no jsdom/@testing-library/react in this repo (see package.json), so this
// reads AppShell.tsx's own source and asserts the exact shape PR #1396
// changed it to, rather than rendering the component.
//
// The bug: `sidebarNode` used to be `sidebarCollapsed ? null : (<div
// className="print:hidden"><AppSidebar .../></div>)`. Clicking the sidebar
// collapse toggle set sidebarCollapsed=true, which made this whole
// expression evaluate to `null` -- React fully unmounted <AppSidebar/>, so
// every nav <a href> vanished from the DOM (not just the screen) for every
// veriChatV2Enabled org. The fix keeps <AppSidebar/> unconditionally in the
// JSX and instead lets sidebarCollapsed choose between two className
// strings on the wrapping <div> ("hidden print:hidden" vs "print:hidden"),
// so the sidebar and its links stay mounted (display:none, not removed)
// and reappear the moment the toggle is clicked again.
//
// This test fails against the pre-#1396 source (the ternary returns null,
// so <AppSidebar> only appears once in the sidebarNode block, gated behind
// `sidebarCollapsed ? null :`) and passes against the current source
// (<AppSidebar> is unconditional; only a className toggles).
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const appShellPath = join(import.meta.dir, "AppShell.tsx");
const source = readFileSync(appShellPath, "utf8");

// Isolate the sidebarNode assignment specifically (from `const sidebarNode =`
// up to the `const body = veriChatV2Enabled` line that follows it in both
// the old and new source) -- avoids false signals from unrelated
// null-returning ternaries elsewhere in this ~250-line component, and
// works whether or not the assignment itself starts with a ternary.
const sidebarNodeMatch = source.match(
  /const sidebarNode = ([\s\S]*?);\s*\n\s*const body = veriChatV2Enabled/
);

describe("AppShell sidebarNode (R57_COMPLIANCE_TRACKER_SIDEBAR_UNMOUNT_01)", () => {
  test("the sidebarNode assignment is present and isolatable in AppShell.tsx", () => {
    expect(
      sidebarNodeMatch,
      "expected `const sidebarNode = ...; \\n const body = veriChatV2Enabled` in AppShell.tsx -- if AppShell was refactored, update this regex, don't delete the test"
    ).toBeTruthy();
  });

  const sidebarNodeBlock = sidebarNodeMatch?.[1] ?? "";

  test("<AppSidebar> is never gated behind a sidebarCollapsed ? null : ... ternary", () => {
    // This is the exact anti-pattern the fault was found with: collapsing
    // the whole expression to `null` unmounts AppSidebar (and every nav
    // <a href> inside it) instead of just hiding it.
    expect(sidebarNodeBlock).not.toMatch(/sidebarCollapsed\s*\?\s*null\s*:/);
  });

  test("<AppSidebar> renders unconditionally inside sidebarNode", () => {
    // With the fix, AppSidebar's presence in the JSX does not depend on
    // sidebarCollapsed at all -- it appears exactly once, unconditionally.
    const appSidebarOccurrences = sidebarNodeBlock.match(/<AppSidebar\b/g) ?? [];
    expect(appSidebarOccurrences.length).toBe(1);
  });

  test("sidebarCollapsed instead toggles a hidden/visible className on the wrapper div", () => {
    // Visibility, not mounting, is what sidebarCollapsed now controls.
    expect(sidebarNodeBlock).toMatch(/sidebarCollapsed\s*\?\s*"[^"]*\bhidden\b[^"]*"\s*:\s*"[^"]*"/);
  });
});
