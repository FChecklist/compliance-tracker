// V2-2 (unified bottom-nav strip, task V2-2-UNIFIED-NAV): the design law
// (PLATFORM_STRATEGY.md line 178) specifies "One navigation system only --
// Chat / To Do / Analytics / Approval / Email / New as a single strip above
// the compose bar." These are the pure, framework-agnostic helpers that
// drive BottomNavStrip.tsx -- extracted out of the component so the route ->
// item mapping and the active-state matching are unit-testable under
// `bun test` (this repo's only test runner), exactly the same pattern as
// src/lib/risk-classification.ts + its .test.ts. The component itself stays a
// thin presentational shell over these helpers.
//
// Route reconciliation (honest, disclosed in PROGRESS.md): the law's 6
// items don't all have dedicated routes yet. Two are mapped to the closest
// real existing surface rather than left dangling:
//   - Email  -> /tasks      (no /email route exists; /tasks is the real
//                             "incoming work needing action" inbox surface)
//   - New    -> /compliance  (no /new route exists; /compliance is the
//                             primary "create new compliance item" entry)
// If dedicated /email or /new routes are added later, only the mapping in
// BOTTOM_NAV_ITEMS below changes -- the matching logic is route-agnostic.
//
// Tokens: reuses the kit's `.veri-nav-item` / `.veri-nav-item.active` class
// the kit's globals.css already defines (no new token system, per the task's
// "no new token system" constraint) -- the strip is a horizontal row of
// those same nav items, not a competing nav pattern (the actual intent of
// the law's "one navigation system only").

export type BottomNavLawItem = {
  /** The design-law item this represents (Chat/To Do/Analytics/Approval/Email/New). */
  lawKey: "chat" | "todo" | "analytics" | "approval" | "email" | "new";
  /** The real route this item navigates to. */
  href: string;
};

// The law's 6 items, in the order the law states them, each bound to a real
// existing route (see reconciliation note above for Email/New).
export const BOTTOM_NAV_ITEMS: readonly BottomNavLawItem[] = [
  { lawKey: "chat", href: "/chat" },
  { lawKey: "todo", href: "/home" },
  { lawKey: "analytics", href: "/dashboard" },
  { lawKey: "approval", href: "/approvals" },
  { lawKey: "email", href: "/tasks" },
  { lawKey: "new", href: "/compliance" },
] as const;

// Mirrors the kit's AppSidebar active-state rule verbatim
// (pathname === href || pathname.startsWith(href + "/")) so a bottom-strip
// item and its sidebar sibling highlight identically for the same route --
// "harmonized," not divergent. Returns false for a "/" href's prefix branch
// (matches the kit's own `item.href !== "/"` guard) so the home-ish items
// don't light up on every route.
export function isBottomNavActive(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false;
  if (pathname === href) return true;
  if (href !== "/" && pathname.startsWith(href + "/")) return true;
  return false;
}

// Resolves the i18n message key path for a law item's label
// ("Nav.bottomNav.<lawKey>") -- kept as a helper so the component and any
// future consumer share one source of truth for the key shape.
export function bottomNavLabelKey(item: BottomNavLawItem): string {
  return `Nav.bottomNav.${item.lawKey}`;
}
