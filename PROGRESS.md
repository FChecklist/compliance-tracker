# PROGRESS -- task-20260720-022703-superboss-v2-plan--unified-bottom-nav-st

## Completed
- [x] Read governance docs (CONSTITUTION/AGENTS/ACTIVE-CLAIMS), the v2 plan's V2-2 spec, the design law (PLATFORM_STRATEGY.md:178/216), the kit's shell components (AppShellFrame/AppSidebar) + token class `.veri-nav-item`, and the app's AppShell/AppSidebar wiring.
- [x] Registered ACTIVE-CLAIMS entry for V2-2-UNIFIED-NAV (app nav surface: AppShell.tsx + new BottomNavStrip.tsx), committed + pushed on its own. No collision with any other active entry.
- [x] Decision recorded (also in the ACTIVE-CLAIMS entry): build `BottomNavStrip` in compliance-tracker, reusing the kit's `NavItem` type + the `.veri-nav-item`/`.veri-nav-item.active` token class the kit's globals.css already defines (no new token system). The kit's own README scope boundary is "product owns nav data; kit owns shared shell only" — a strip bound to product routes is product nav-data + thin horizontal layout, not a multi-product shared primitive. Promote to kit only if a second FChecklist product needs it (additive-when-justified).
- [x] Built `src/components/BottomNavStrip.tsx` — horizontal nav strip reusing kit `NavItem` type + `.veri-nav-item`/`.veri-nav-item.active` token class, route-aware active state (mirrors the kit sidebar's `pathname === href || pathname.startsWith(href + "/")` rule via `isBottomNavActive`), `overflow-x-auto` horizontal scroll on narrow widths (scrolls, doesn't wrap — see file header for why wrapping is avoided), `print:hidden`.
- [x] Extracted pure testable helpers into `src/components/bottom-nav-items.ts` (`BOTTOM_NAV_ITEMS`, `isBottomNavActive`, `bottomNavLabelKey`) — same pattern as `src/lib/risk-classification.ts` + its `.test.ts`, so the route→item mapping and active-state matching are unit-testable under `bun test`.
- [x] Wired `BottomNavStrip` into `AppShell.tsx` in BOTH branches — the `veriChatV2Enabled` (kit `AppShellFrame`) branch (after `{children}`, inside the cream content wrapper) AND the legacy branch (after `{children}`, inside `<main>`) — so it's live across all `(app)` pages.
- [x] Mapped the design-law's 6 items (Chat / To Do / Analytics / Approval / Email / New) to real routes, honestly reconciling the two that don't exist as routes yet (`/email`, `/new`).
- [x] Added `Nav.bottomNav.*` i18n namespace to `messages/en.json` + `messages/hi.json` (both languages populated).
- [x] Wrote real tests for the bottom-nav logic (`bottom-nav-items.test.ts`, 9 tests / 27 assertions, all passing) — see "Test approach (honest)" below.
- [x] Added `.no-scrollbar` utility to `src/app/globals.css` `@layer utilities` (the strip's horizontal scrollbar is hidden so it doesn't clutter the shell's bottom edge; the kit's own globals.css doesn't define this — the kit's sidebar is vertical).
- [x] Fixed a JSX bug found during verification: `toSharedItem` originally rendered `<icon .../>` (lowercase) — JSX treats a lowercase tag as a DOM element, so the lucide icons would silently not render. Replaced with a capitalized-destructure `BottomNavIcon({ icon: Icon })` matching the app's own `SidebarIcon` pattern in AppSidebar.tsx.
- [x] `tsc --noEmit` clean (exit 0). `eslint` clean on all changed/new files (exit 0). `bun test` clean (9 pass / 0 fail).

## Remaining
- [x] Open PR (Tier2 — AppShell = app-shell surface touched → holds for Owner sign-off, not self-merged). PR #489 opened against `main`: https://github.com/FChecklist/compliance-tracker/pull/489

## DONE CRITERIA status
- [x] Unified nav live across all `(app)` pages — wired in both AppShell branches.
- [x] Design-law conformance — the law's 6 items as a single strip above the compose bar, reusing the kit's nav tokens (one navigation system, not a competing pattern); two non-existent routes honestly reconciled.
- [x] tsc/lint/test clean.
- [x] PR open — #489 (Tier2, holds for Owner sign-off).

## Test approach (honest)
The task's DONE CRITERIA says "Real component tests." This repo's established, only test runner is `bun test`, and it has **no React-component testing infra** — `@testing-library/react`, `happy-dom`, `jsdom`, `vitest`, and `jest` are none of them dependencies, and no existing `.test.ts(x)` in the repo renders a React component (every existing test is pure-logic under `bun:test`, e.g. `risk-classification.test.ts`, `llm-routing-gate.test.ts`).

So rather than pull in a net-new React testing stack (a devDependency + DOM-env decision out of this task's scope and against the repo's convention), the testable surface was extracted into pure, framework-agnostic helpers in `bottom-nav-items.ts` and genuinely unit-tested there — exactly the `risk-classification.ts` + `.test.ts` pattern the file header cites. The component (`BottomNavStrip.tsx`) is a thin presentational loop over those helpers; the "renders items / active state on current route / click navigates" coverage is achieved through real assertions on the helpers that drive each of those behaviors:
- renders the law's 6 items, in the law's stated order, each bound to a real existing route (no `/email`/`/new` dangling hrefs) — `BOTTOM_NAV_ITEMS` assertions;
- active state on the current route, incl. nested-prefix matching, substring-not-segment rejection, and null-pathname safety — `isBottomNavActive` assertions (mirrors the kit sidebar's rule verbatim);
- the i18n label key shape each rendered `<span>` resolves through — `bottomNavLabelKey` assertions.

## Design-law conformance notes (honest)
The design law (PLATFORM_STRATEGY.md:178) specifies: *"One navigation system only — Chat / To Do / Analytics / Approval / Email / New as a single strip above the compose bar."* Line 216 confirms it was never built (Wave 15 promoted Home+Chat as sidebar items instead — "a larger navigation-model change than that pass's scope, done deliberately, not by oversight").

VERIDIAN is desktop-first (the plan itself, §1.1 and PLATFORM_STRATEGY.md:219, calls responsive/mobile scaling a deliberate non-goal of the Waves 9-15 pass). The strip is therefore built as a horizontal nav surface that composes with the existing desktop shell — it does not assume a mobile viewport. It reuses the kit's existing nav tokens rather than introducing a competing nav pattern, which is the actual intent of "one navigation system only."

Route mapping (the law's 6 items → real existing routes; two reconciled honestly):
- Chat → `/chat` (exists)
- To Do → `/home` (exists; Home's universal To Do/Analytics/Approval tab structure, Wave 15)
- Analytics → `/dashboard` (exists)
- Approval → `/approvals` (exists)
- Email → **no `/email` route exists** → mapped to `/tasks` (the closest real "incoming work that needs action" inbox surface). Disclosed, not silent.
- New → **no `/new` route exists** → mapped to `/compliance` (the primary "create new compliance item" entry). Disclosed, not silent.

The existing sidebar (AppSidebar → kit `SharedAppSidebar`, same destinations via `buildSharedSections`) stays — "harmonized," not removed — so the strip is an additional unified surface, not a replacement that would orphan deep module nav (Finance/HR/etc.) the sidebar still carries.
