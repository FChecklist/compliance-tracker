# VERI Chat Mockup-Validated Ideas → Production Spec (2026-08-01)

## 0. Front matter — what this document is, and what it isn't

**Source.** Everything specified below was first explored in
[`veridian-scope-selector-in-home.html`](veridian-scope-selector-in-home.html) (repo root), a
**local-only, static, dependency-free HTML/Tailwind/vanilla-JS prototype**. It is not part of the
real Next.js app (`src/app/...`), is never built, imported, or deployed, and has no backend behind
it — every "send", "submit", or "sync" action in it is either `localStorage`/`IndexedDB` or a fake
`setTimeout` acknowledgment. It exists purely so the Owner could click through UX ideas quickly
before committing engineering time to them. This is the **second** design document to use that same
mockup file as its source — [`VERI_CHAT_COMPOSER_DESIGN.md`](VERI_CHAT_COMPOSER_DESIGN.md) (repo
root) already documents an *earlier* round of ideas from the same file that were built and shipped
(Wave 131, live since 2026-07-09). This document covers a **later, additional round of changes**
made to the same mockup file in this session (dated 2026-08-01 in the file's own inline comments),
which have **not** been ported to production yet. §1 below reconciles the two documents explicitly.

**Purpose.** This is an instruction set for a **different Claude Code session, running directly on
the production server**, to implement these ideas for real in the actual Next.js app. It is not
itself an implementation, and no file other than this one was modified to produce it. Every
"direction" below names real files, real functions, and real line ranges as of this repo's current
`main` HEAD, so the implementing session can locate the exact spot to change rather than
re-deriving it from scratch.

**Self-audit statement.** This document was re-read after drafting against: (a) the real source
files cited in it (re-verified every file:line reference resolves to what's claimed), (b) internal
consistency between each feature's "real current state" and "direction to build" (checked that the
direction doesn't contradict or silently assume something the current-state section says isn't
there), and (c) whether `VERI_CHAT_COMPOSER_DESIGN.md` is genuinely reconciled rather than ignored.
The audit found and fixed three things before this document was finalized:
1. An early draft of §3.6 ("Frequent Tasks / prompt library") proposed porting the mockup's new
   IndexedDB feature literally. Re-reading the mockup's own honest finding (the `compliance
   .prompt_templates` table is 219 AI-Team role prompts, not end-user shortcuts — confirmed still
   true against `src/lib/db/schema.ts:2134`) against the direction made clear that literally
   porting it would build a UI that misrepresents that data to end users. The direction was
   rewritten to recommend *against* a literal port and to propose where this data genuinely belongs
   instead (an ops-facing surface, not Home).
2. An early draft of §2 claimed "the common UI/UX location is `src/components/`" per the Owner's own
   framing. Reading `package.json:25` and the real import paths in `AppSidebar.tsx`, `AppShell.tsx`,
   `AppTopbar.tsx`, and `VeriChatPanel.tsx` showed the *actual* shared, cross-brand layer is a
   **separate GitHub package**, `@fchecklist/veridian-ui-kit`, not this repo's own `src/components/`.
   §2 was corrected to state this precisely instead of restating the Owner's assumption as fact —
   see §2's own note on why this is a refinement, not a contradiction, of the underlying principle.
3. An early draft of §3.1 assumed the mockup's "stale active nav highlight" bug also exists in
   production. Reading `AppSidebar.tsx:548-552`'s own disclosed-tradeoffs comment showed production
   already computes the active nav item from the live `pathname` on every render (via the shared
   `SharedAppSidebar` component), which cannot go stale the way the mockup's manual
   `classList.add("active")` bookkeeping could. §3.1 was corrected to say explicitly that this bug
   does not apply to production and no fix is needed there.

---

## 1. Reconciliation with `VERI_CHAT_COMPOSER_DESIGN.md`

That document is the authority on the composer/chain-selector/panel architecture as it was
**already shipped** (Wave 131, `product_branches.status = 'live'` for `veri_chat_v2`, all 15 orgs
enabled). Nothing in this document overrides it. Where this document's directions touch the same
files (`VeriComposer.tsx`, `ChainSelector.tsx`, `AppSidebar.tsx`, `AppShell.tsx`), they are
**additive changes on top of that shipped baseline**, not a redesign of it. Specifically:

- **Agreement, not conflict**: `VERI_CHAT_COMPOSER_DESIGN.md`'s "Deliberate divergences from the
  mockup" section already explains *why* production keeps `VeriComposer`/`VeriChatPanel` mounted
  side-by-side instead of the mockup's DOM-relocation trick, and why Home gets a special-cased
  greeting-only branch instead. This document's §3.3 (task document screen / "full takeover") does
  **not** ask to revisit that divergence — it proposes a *new*, additional full-content-area state
  (the document screen) that coexists with the existing composer/panel-always-mounted architecture,
  triggered by `chainComplete`, not a return to DOM relocation.
- **Genuinely additive, not previously covered**: the per-segment removable ×, the Step 2
  overlay/auto-collapse behavior, "Create similar task again" (replacing the queue), the task
  document screen, the external-AI copy-prompt link, the resizable composer, and the honest
  prompt-library finding are **all absent** from `VERI_CHAT_COMPOSER_DESIGN.md`'s "Core UX concepts"
  and "Mapping" table — confirmed by reading that document in full (75 lines) and cross-checking
  against every construct it names. They are new ground, not a re-litigation of settled ground.
- **One real tension to flag, not silently resolve**: `VERI_CHAT_COMPOSER_DESIGN.md` documents that
  production's queue/"+ Add another" mechanism (`queueCurrent()`/`sendAllQueued()` in
  `VeriComposer.tsx:480-499`) was a **deliberate port** of the mockup's original queue idea, listed
  in that document's own mapping table as shipped, working functionality. This session's mockup
  changes now call for **removing** that same mechanism and replacing it with "Create similar task
  again" (§3.2.5 below). This is a real, disclosed reversal of a previously-shipped design decision,
  not a hidden one — the implementing session should treat `queueCurrent`/`sendAllQueued`/the `queue`
  state and its UI (`VeriComposer.tsx:135, 480-499, 654-669`) as code to be **deleted**, not merely
  supplemented, once "Create similar task again" replaces it, and should update
  `VERI_CHAT_COMPOSER_DESIGN.md`'s own mapping table row for "Queue / '+ Add another' / 'Send all'"
  to reflect the removal (that document's own convention, per its "Status" section, is to record
  what's shipped and current — leaving a stale row would misdescribe the live system).

---

## 2. Architecture principles (Owner's requirements, stated directly)

These are restated precisely, with the one factual correction from the self-audit (§0, item 2)
folded in — the correction sharpens where the "one common location" lives, it does not weaken the
requirement that there be only one.

1. **The UI/UX lives in ONE common location, shared across every VERIDIAN brand.** Confirmed real:
   `package.json:25` pins `"@fchecklist/veridian-ui-kit": "github:FChecklist/veridian-ui-kit#v0.2.2"`
   — a separate GitHub repository, consumed as a normal package dependency, not vendored into this
   repo. The actual shared, cross-brand UI primitives live **there**, not in this repo's own
   `src/components/`. Confirmed real consumers of it in this repo: `AppShellFrame`/`AppHeader`
   (`@fchecklist/veridian-ui-kit/shell`, used by `AppShell.tsx:3` and `AppTopbar.tsx:15`),
   `SharedAppSidebar` (`@fchecklist/veridian-ui-kit/shell`, used by `AppSidebar.tsx:6`),
   `PanelShell`/`ThreadView` (`@fchecklist/veridian-ui-kit/panel`, used by `VeriChatPanel.tsx:23` and
   `HomeThreadSlot.tsx:14`), and `createVeriChatContext()` (`@fchecklist/veridian-ui-kit/context`,
   used by `veri-chat-context.tsx:19`). This repo's own `src/components/veri-chat/*`,
   `AppSidebar.tsx`, `AppShell.tsx`, and `AppTopbar.tsx` are **this product's consumer/wrapper layer**
   around that shared kit — they hold compliance-tracker's real business logic, data-fetching, and
   per-repo extensions (e.g. `veri-chat-context.tsx`'s own comment at lines 9-17 explicitly describes
   itself as "a second, inner context rather than forking the factory"), not the cross-brand-shared
   layer itself. **Every direction in this document that touches shared visual/interaction behavior
   (nav highlight, panel resize, generic shell chrome) belongs in `veridian-ui-kit`, not in
   compliance-tracker's own `src/components/`; every direction that touches this product's real data
   (capability tree, task dispatch, org-specific nav data) belongs here.** Where a direction below is
   ambiguous about which side it belongs on, that ambiguity is called out explicitly rather than
   guessed at.
2. **Brands consume this common UI/UX via API/config, not by forking it.** Confirmed real evidence:
   this repo's own service-layer comments (`erp-selling-service.ts:61`, `erp-accounting-service.ts:221`,
   `erp-company-service.ts:36`, `erp-invoicing-service.ts:284`, and others) repeatedly describe
   **PROJEXA's `callVeridian()`** as a server-to-server Bearer-token proxy that "never carries a
   session cookie" — i.e., PROJEXA (a separate brand/repo, `FChecklist/projexa`, not present in this
   clone) calls into this VERIDIAN backend as an API client, not by forking compliance-tracker's own
   UI code. This document could not independently inspect `callVeridian()`'s own source (that
   function lives in the PROJEXA repo, which this session does not have access to) — flagged
   honestly rather than assumed. The pattern is nonetheless clearly real and consistent across every
   citation found.
3. **VERIDIAN is the backend for all brands.** Consistent with the above — confirmed no evidence of
   the reverse (compliance-tracker calling out to a brand-specific backend).
4. **The mode-pill/chain/composer AND the left-rail menu are DATA-DRIVEN per brand/organization/
   end-user; the UI CODE stays common.** Confirmed real for the composer: `capability-tree-service.ts`'s
   own header comment states it "Assembles the cascading task-chain selector's option tree from REAL
   registered capabilities — no hand-authored taxonomy," built per-org from `orgProductBranchEnablements`,
   real Worker Agents, real Products/Projects, and real Customer/Vendor entities. Confirmed real for
   the sidebar: `getNavSections()` (`AppSidebar.tsx:112-530`) branches on real per-org flags
   (`pmsEnabled`, `firmEnabled`, `accountType`) to include/exclude whole sections, while the
   **component code itself** (`SharedAppSidebar`) is one shared implementation per principle 1. This
   principle is **already correctly implemented** for both surfaces today — no gap to close here.
5. **VERI Chat itself is IDENTICAL for every brand — no per-brand variation.** Consistent with
   principles 1 and 4: the composer/panel/context code is the shared-kit + this-repo's-thin-wrapper
   pattern described above, with no per-brand branch anywhere in `VeriComposer.tsx`,
   `VeriChatPanel.tsx`, or `veri-chat-context.tsx`. The one visual per-org variation found
   (`AppShell.tsx:80-93`'s BYOB white-label logo/brand-color CSS variables) is cosmetic theming, not
   a behavioral or structural fork, and does not contradict this principle.
6. **Everything should support agile/modular iteration — flag tight coupling.** Two real instances of
   coupling worth flagging, found while grounding this document:
   - `selectedPath` (the in-progress chain selection) is **private `useState` inside
     `VeriComposer.tsx:132`**, not exposed via `veri-chat-context.tsx`. §3.1's sidebar-convergence
     direction and §3.2's per-segment-× direction both need this state to be read/written from
     outside `VeriComposer.tsx` (the sidebar, in one case). Lifting it into the context (base
     factory or this repo's inner context) is a real, disclosed architectural change this document
     asks for — not a hidden side effect of some other change. Doing so is exactly the kind of move
     principle 6 calls for: it turns a single-component-private piece of state into something other
     consumers can share without forking the composer.
   - `AppShell.tsx:37-47`'s own comment already discloses a real instance of *reduced* modularity
     from the `veridian-ui-kit` migration: `AppShellFrame` owns the right-panel resize width
     internally with no prop surface for externally-persisted width, so a previously-working
     "survives a hard reload" behavior was lost and cannot be restored without forking
     `AppShellFrame`. This is pre-existing, not something this document's changes cause, but it is
     directly relevant to §3.5 (resizable composer): if the composer's own vertical resize is built
     the same way (state owned entirely inside the shared kit, no persistence hook), the same
     regression will recur for it. §3.5's direction calls for the persisted-height state to live in
     **this repo's own code** (e.g. `AppShell.tsx` or `VeriComposer.tsx`), not inside
     `veridian-ui-kit`, specifically to avoid repeating this.

---

## 3. Per-feature specification

### 3.1 Sidebar / left rail

**3.1.1 Compacted vertical spacing.**
- *Mockup reasoning*: denser spacing between nav items/section labels lets more of a long,
  GRC-heavy nav (13+ sections, `AppSidebar.tsx:112-530`) fit on screen without scrolling, at some
  cost to touch-target size (acceptable for a desktop-first ERP nav).
- *Real current state*: the actual spacing/padding rules live inside `SharedAppSidebar`
  (`@fchecklist/veridian-ui-kit/shell`), not in this repo. This repo's `AppSidebar.tsx` only supplies
  `sections`/`logo`/`productName`/`collapsed` props (`AppSidebar.tsx:642-647`) — it has no local
  spacing CSS to change.
- *Direction*: this change belongs in the **`veridian-ui-kit` repository**, not compliance-tracker,
  per principle 1 (§2) — it is a shared, cross-brand visual rule. **Do not** attempt to override it
  with local CSS overrides/`!important` hacks inside compliance-tracker; that would silently
  re-introduce a per-brand fork of shared UI, the exact anti-pattern principle 1 forbids. If the
  `veridian-ui-kit` repo is not reachable from the implementing session, flag this item as blocked
  on that repo rather than working around it locally.
- *Acceptance criteria*: nav row height/section-label margins reduced in `veridian-ui-kit`'s own
  sidebar component; compliance-tracker's `bun run build` picks up the new version with no local
  code change other than a `package.json` version bump.

**3.1.2 Sidebar clicks sync to the same `selectedPath`/chain mechanism as the composer.**
- *Mockup reasoning*: "one system, not two" — in the mockup, clicking a sidebar module
  (`.module-nav-item[data-tree]`, mockup lines 3385-3394) calls `syncModuleFromTree()`, which sets
  the exact same `selectedPath` the mode-pill chain picker uses, and any sidebar item that has a
  dedicated screen instead calls `openModuleScreen()`. The Owner's underlying complaint (documented
  in the mockup's own inline comments) was that most sidebar items used to be inert/decorative in
  earlier design passes — clicking them did nothing chain-aware.
- *Real current state*: **this convergence does not exist in production.** Every real nav item in
  `getNavSections()` (`AppSidebar.tsx:112-530`) is a plain `href` consumed by `SharedAppSidebar` as a
  normal link (`toSharedItem()`, `AppSidebar.tsx:562-569`) — clicking one does a real Next.js
  navigation to a real page (e.g. `/erp/journal-entries`, `/legal-matters`), which is **already
  correct and complete on its own terms** (every one of those ~140 nav items routes to a real,
  built page — nothing decorative). What's genuinely missing relative to the mockup's idea is the
  *second* thing: there is no mechanism today by which clicking a sidebar item also pre-seeds the
  composer's `selectedPath`/`composerMode` to match that page's equivalent chain, the way the
  mockup's `syncModuleFromTree()` does. `selectedPath` is private state inside
  `VeriComposer.tsx:132` (§2, coupling note) — nothing outside that component can set it today.
- *Direction*: this is a **real, net-new feature**, not a bug fix. Concretely:
  1. Lift `selectedPath` (and its setter) out of `VeriComposer.tsx`'s private `useState` into
     `veri-chat-context.tsx` (as a new field alongside `composerMode`/`activeTaskId`), so both
     `VeriComposer.tsx` and `AppSidebar.tsx` can read/write it.
  2. Each real nav item in `getNavSections()` that has an obvious capability-tree equivalent (e.g.
     `/erp/journal-entries` → the Finance chain's Journal Entries leaf) needs an explicit mapping
     from `href` to a `PathSegment[]` prefix. This mapping does **not** exist today and must be
     built new — do not assume it can be derived automatically from the href string, since nav
     hrefs and capability-tree keys are two independently-evolved naming schemes (confirmed by
     comparing `getNavSections()`'s href list against `capability-tree-service.ts`'s tree-building
     logic — no shared identifier links them). Build this as an explicit lookup table, and treat
     any nav item with no mapping as "navigate only, no chain sync" rather than silently guessing.
  3. On click, in addition to the existing `Link` navigation, dispatch `setSelectedPath(mappedPrefix)`
     and `setComposerMode(topLevelKey)` via context, so the persistent composer (mounted globally by
     `AppShell.tsx`, always visible) reflects the clicked module immediately.
- *Acceptance criteria*: clicking a mapped sidebar item (a) navigates to its real page as it does
  today (no regression), and (b) the composer's mode pill + Step 2 chain visibly reflect that
  module's chain prefix within the same render, verified live in the browser (not just asserted) per
  §5's testing-discipline requirement.

**3.1.3 "More modules (real)" sidebar section.**
- *Mockup reasoning*: the mockup's original demo tree only modeled Finance/Accounts/GST-style
  illustrative modules; this session added a section using real page names pulled from the actual
  `AppSidebar.tsx` (Governance, Legal, Risk, Audit, Tools), explicitly labeled as sourced from real
  data, to make the mockup's own demo feel grounded.
- *Real current state*: **production already has this, and more.** `getNavSections()`
  (`AppSidebar.tsx:112-530`) already contains real, live sections named exactly `Governance`
  (line 297), `Legal` (line 319), `Risk` (line 342), `Audit` (line 354), and `Tools` (line 417,
  the largest section, 20 real items), plus `Company Secretarial`, `People & HR`,
  `Sector Regulators`, `Third-Party & ESG`, `Integrity`, `Incidents & Events`, `Access & Approvals`,
  and `Admin` — none of which are illustrative or invented; every item has a real `href` to a real
  built page.
- *Direction*: **no new sidebar section needs to be built.** The mockup's "More modules (real)"
  section was solving a problem — "make the demo feel grounded in real data" — that production
  never had, because production's sidebar was never demo data to begin with. The only real
  remaining gap here is §3.1.2's convergence work (making these already-real items also drive the
  composer's chain state), not adding more nav items. Do not add a duplicate/second "More modules"
  section — that would create exactly the two-parallel-navigation-systems problem principle 6 warns
  against.

**3.1.4 Stale active-highlight regression.**
- *Mockup reasoning*: in the mockup, navigating to a different page could leave a stale
  `.active` class on the last-clicked sidebar item, because active state was manually toggled via
  `classList.add`/`classList.remove` (mockup lines 3391-3392) rather than derived from the current
  URL.
- *Real current state*: **this bug does not exist in production**, and no fix is required. Per the
  self-audit (§0, item 3), `AppSidebar.tsx:548-552`'s own disclosed-tradeoffs comment confirms the
  shared `SharedAppSidebar` component computes `active` via
  `pathname === href || pathname.startsWith(href + "/")` **on every render**, driven by the real
  Next.js `usePathname()` value — there is no manually-toggled class to go stale. The one real,
  already-disclosed limitation is different and narrower: a few nav items route via query string
  (e.g. `/compliance?status=overdue`, `AppSidebar.tsx:119`) and won't visually highlight as active
  while on that exact view, because the active-check has no query-string awareness. This is a
  cosmetic gap, not a staleness bug, and is already known/disclosed in the existing code comment.
- *Direction*: no action required for the mockup's described bug. If the Owner separately wants the
  query-string-aware active-highlight gap closed, that is a `veridian-ui-kit` change (the active
  computation lives there, per principle 1), and should be scoped as its own small, explicitly-named
  follow-up rather than folded silently into this work.

---

### 3.2 Chain picker (Step 1 / Step 2)

**3.2.1 Step 2 auto-expand-as-overlay / auto-collapse-to-strip.**
- *Mockup reasoning*: while a chain is actively being built, Step 2 floats over a greyed-out
  composer (`#composerBackdrop`, mockup lines 337, 586-591) instead of pushing the textbox down and
  growing the composer's total height; the instant the chain completes, it collapses to a narrow
  "Selection complete" strip and the backdrop disappears.
- *Real current state*: **production has no overlay/backdrop/auto-collapse behavior at all.** The
  chain-picker banner in `VeriComposer.tsx:565-613` (the amber `rounded-2xl border-amber-200` block)
  is a plain block-flow element sitting **above** the composer textbox in normal document flow — it
  is always fully expanded while `isChainMode && !isThreadOpen` is true (line 565), regardless of
  whether the chain is complete, and it does grow the composer's total vertical footprint as rows
  accumulate (confirmed: no `max-height`/`overflow`/backdrop/`position: absolute` anywhere in that
  block). `PathBreadcrumb` (lines 35-49) does render in a lighter, muted style once complete, but
  the banner itself never shrinks or overlays.
- *Direction*: wrap the existing banner (`VeriComposer.tsx:566-612`) and the textbox container
  (`VeriComposer.tsx:671-718`) in a shared `relative` wrapper, mirroring the mockup's structure
  (mockup lines 325-337). Add:
  1. A conditional CSS class (e.g. `scope-overlay`) applied to the banner when
     `isChainMode && !chainComplete` is true, giving it `position: absolute` layering over the
     textbox with a semi-opaque backdrop element behind the textbox (a new sibling `div`, mirroring
     `#composerBackdrop`).
  2. When `chainComplete` becomes true, remove the overlay class so the banner collapses to a
     narrow strip — concretely, hide the `ChainRows` output (already addressed by §3.2.2 below,
     which limits it to the current-depth row only) and shrink the banner's vertical padding, so the
     strip mainly shows the "Selection complete"/breadcrumb label (§3.2.3).
  3. Toggle the label text itself (`"Narrow it down"` vs `"Selection complete"`, mirroring the
     mockup's `step2Label`/`updateScopeOverlay()`, lines 586-591) based on the same
     `!chainComplete` condition.
- *Acceptance criteria*: with a chain in progress, the textbox area visibly dims/greys behind the
  expanded picker; the instant the last required chip is picked (`chainComplete` flips true in the
  same render `VeriComposer.tsx:200`), the picker visibly collapses to a strip with no separate user
  action needed. Verify live in the browser across at least one 2-level chain and one deeper
  (4+ level) chain, per §5.

**3.2.2 Show only the current (deepest, undecided) depth's row.**
- *Mockup reasoning*: Owner's own words — "why show all layers, the chatbox already shows the full
  chain, why show them here" — so Step 2 only renders the row for the depth still being decided,
  not every prior depth stacked up.
- *Real current state*: **production shows every depth stacked, exactly the behavior the Owner
  objected to.** `ChainRows` (`ChainSelector.tsx:120-229`) builds a `rows` array with one entry per
  depth from 0 up to the current depth (the `for (let depth = 0; ; depth++)` loop, lines 146-169,
  pushes a row for every depth before breaking), and the render (`rows.map(...)`, line 175) renders
  **all** of them, each depth's already-made selection included, with only the deepest row's chip
  set filterable by search (line 176-179 checks `isDeepestRow` only for the search filter, not for
  visibility). Confirmed this is used identically by both `VeriComposer.tsx:597-605` (the inline
  chain-mode banner) and `ChainSelectorDialog` (`ChainSelector.tsx:363-370`, the new-workflow-thread
  dialog) — a change here affects both call sites, which is expected and desired (one shared
  component, per principle 6).
- *Direction*: in `ChainRows` (`ChainSelector.tsx:120-229`), after building the `rows` array, filter
  to render only the **last** entry (`rows[rows.length - 1]`) instead of mapping over all of `rows`.
  Keep the full `rows` array computation as-is internally (other logic, e.g. the breadcrumb, still
  needs the complete path), but change only the render step (currently `rows.map((row) => {...})`,
  line 175) to render a single row. This mirrors the mockup's own approach exactly (mockup lines
  1059-1072: `currentRowEl`/`currentRowDepth` are tracked through the loop but only the final one is
  appended to the DOM).
- *Acceptance criteria*: for a 4-level chain (e.g. Finance → Accounts → GST → a customer), only one
  row of chips is visible at any time while picking; prior selections are no longer shown as
  separate chip rows in Step 2 (they remain visible via the breadcrumb, §3.2.3, and — once this
  document's §3.2.4 lands — via per-segment × chips inline). Verify both call sites
  (`VeriComposer.tsx` inline picker and `ChainSelectorDialog`'s new-thread picker) still render
  correctly after the shared-component change, since both consume `ChainRows`.

**3.2.3 Breadcrumb repositioned + made a clickable "create another" link.**
- *Mockup reasoning*: move the breadcrumb from far-right (`justify-between`) to sit immediately left
  of the "Selection complete"/"Narrow it down" label; once the chain is complete, clicking it prompts
  `confirm("Create another task for this chain?")` and, if confirmed, stages another instance via the
  same mechanism as "Create similar task again."
- *Real current state*: production's `PathBreadcrumb` (`VeriComposer.tsx:35-49`) is rendered inside a
  `flex items-center justify-between` row (line 567) alongside the `"Select the task you want me to
  do."` label — i.e. **already at the far right**, exactly the position the mockup moved away from.
  It is plain text with no click handler, no cursor styling, and no confirm dialog.
- *Direction*: 1) Restructure the flex row at `VeriComposer.tsx:567-570` so `PathBreadcrumb` renders
  immediately after the step label instead of being pushed right by `justify-between` (simplest:
  drop `justify-between`, add a small fixed gap, e.g. `flex items-center gap-2`). 2) Add an
  `onClick` handler to `PathBreadcrumb` (or wrap it in a `<button>`) that fires only when
  `chainComplete` is true: show a `confirm("Create another task for this chain?")`-equivalent (a
  native `window.confirm` is acceptable here, matching the mockup's own choice and this repo's
  existing precedent of using `window.prompt` for rejection reasons in `VeriChatPanel.tsx:158,166,172`)
  and, if confirmed, call the same handler §3.2.5 wires up for "Create similar task again."
- *Acceptance criteria*: breadcrumb sits immediately after the Step 2 label, not at the far right;
  once a chain is complete, hovering it shows a pointer cursor and clicking it prompts for
  confirmation before creating another task against the same chain; declining the confirm does
  nothing (no task created, no state change).

**3.2.4 Per-segment removable ×.**
- *Mockup reasoning*: rather than a single trailing × that only pops the last segment (requiring
  repeated clicks to go back further), each segment of the completed chain gets its **own** × —
  clicking segment *i*'s × truncates the chain to right before *i*, jumping back to that depth in one
  click. Rendered both under the Step 2 breadcrumb and inline in the chatbox's own chain label.
- *Real current state*: **neither version exists in production today.** `PathBreadcrumb`
  (`VeriComposer.tsx:35-49`) renders each segment as plain text with a chevron separator — no ×, no
  click handler, no per-segment removability at all (confirmed: no `onClick`, no button element
  anywhere in that component). There is also **no inline chain label next to the textbox** in
  production at all — the mockup's `#composerChainLabelWrap`/`#composerChainSegments`
  (mockup lines 346-349, rendered right before the `<textarea>`) has no production equivalent;
  today the completed chain is only ever shown once, in the Step 2 banner's breadcrumb.
- *Direction*: this needs two real, separate additions, not one:
  1. **A `stepBackToDepth(depth)` function**, added to `VeriComposer.tsx` (mirroring the mockup's own
     `stepBackToDepth`, lines 1168-1176): `setSelectedPath((prev) => prev.slice(0, depth))`, gated so
     `depth` cannot go below the mode's pre-seed floor (the existing `preseedKeyForMode()` logic at
     lines 176-180 already establishes what that floor is for a given mode — reuse it, don't
     re-derive it).
  2. **Per-segment × rendering** in `PathBreadcrumb` (`VeriComposer.tsx:35-49`): change each mapped
     segment from a bare `<span>` to a small inline group with a `×` button wired to
     `stepBackToDepth(i)`, gated to only render on segments at or past the mode's pre-seed floor
     (mirroring the mockup's own `floor` check, lines 1169, 1187).
  3. **A new inline chain-label element**, added just before the `<textarea>` in
     `VeriComposer.tsx`'s render (near line 680), shown only when `chainComplete` is true, reusing
     the same segment-plus-× rendering as item 2 (extract a shared sub-component so the Step 2
     breadcrumb and the inline label don't duplicate the × logic — two render sites, one
     implementation, per principle 6).
- *Acceptance criteria*: for a completed 4-segment chain, clicking segment 2's × truncates the chain
  back to exactly 2 segments (segment 1 and its pre-seed, if any) and immediately re-opens Step 2's
  picker at that depth, showing that depth's next options (verifying §3.2.2's single-row behavior
  still applies correctly after a truncation, not just on a fresh forward walk).

**3.2.5 "+ Add another" → "Create similar task again."**
- *Mockup reasoning*: Owner's words — "must actually create another task using the SAME chain, not
  stage-and-reset." The label changes and, more importantly, the mechanism changes: instead of
  staging into a queue and resetting the chain (so the next chain has to be rebuilt from scratch),
  clicking it dispatches immediately against the *same* selected chain and only clears the typed
  message, ready for the next instruction against that identical chain right away. The old
  queue/"Send all" UI is removed entirely as dead code, since nothing uses it once this lands.
- *Real current state*: production's button is still literally named `"+ Add another"`
  (`VeriComposer.tsx:709`) and still does the **old** behavior: `queueCurrent()`
  (`VeriComposer.tsx:480-494`) pushes `{path: selectedPath, text: value, display: ...}` onto a
  `queue` array, clears `value`, and — critically — **resets `selectedPath` back to the mode's
  pre-seed** (line 493: `setSelectedPath(preseedKeyForMode(composerMode) ? [...] : [])`), forcing the
  next chain to be rebuilt from scratch. A separate `queue` UI block (lines 654-669) lists staged
  items with a "Send all (N)" button calling `sendAllQueued()` (lines 496-499), which loops
  `dispatchInstruction()` over every queued item. This is exactly the mechanism the Owner now wants
  replaced, and it is the same mechanism `VERI_CHAT_COMPOSER_DESIGN.md` currently documents as
  shipped, working functionality (§1's reconciliation note above).
- *Direction*:
  1. Rename the button label from `"+ Add another"` to `"Create similar task again"`
     (`VeriComposer.tsx:709`).
  2. Replace its `onClick={queueCurrent}` with a new handler that calls
     `dispatchInstruction(selectedPath, value.trim())` directly (the same function `send()` already
     calls at line 469) and then clears **only** `value` — explicitly **not** `selectedPath` — so the
     chain stays selected for the next message.
  3. Delete `queueCurrent()`/`sendAllQueued()` (lines 480-499), the `queue` state (line 135), and the
     queue UI block (lines 654-669) entirely, per the Owner's explicit "removed as dead code" framing
     — do not leave them disabled/unreachable, remove them, since nothing will call them once step 2
     lands.
  4. Update the button's `disabled` condition (currently `!chainComplete || !value.trim()`, line 708)
     — unchanged in substance (still needs a complete chain and non-empty text), but re-verify it
     against the new handler rather than assuming it transfers unmodified.
  5. Update `VERI_CHAT_COMPOSER_DESIGN.md`'s mapping-table row for "Queue / '+ Add another' / 'Send
     all'" (currently reads "Same UI and behavior... in `VeriComposer.tsx`") to reflect that this was
     removed and replaced, per §1's reconciliation note.
- *Acceptance criteria*: after sending one task via "Create similar task again" against a 4-segment
  chain, the same 4-segment chain remains fully selected and visible (Step 2 strip still shows
  "Selection complete", breadcrumb unchanged), the message box is empty, and no queue/"Send all" UI
  is rendered anywhere in chain mode. Grep the final diff for `queueCurrent`, `sendAllQueued`, and
  the `queue` state variable to confirm zero remaining references.

---

### 3.3 Standardized ERP "task document" screen

- *Mockup reasoning*: "irrespective of which option is chosen, the same screen template appears,
  only the data changes" — once any chain completes, the main content area shows one standardized
  document screen (editable Party name/Reference no./Date/Status, a live-recalculated line-items
  table with Subtotal/18% GST/Total, Submit and Make Duplicate buttons) instead of showing nothing,
  so a user can work directly on the screen like a traditional ERP or via the chatbox — same
  underlying dispatch mechanism either way. This is described in the task as "the biggest addition."
- *Real current state*: **no equivalent exists anywhere in production.** Confirmed by reading
  `VeriComposer.tsx`, `VeriChatPanel.tsx`, `HomeThreadSlot.tsx`, and `home/page.tsx` in full: when a
  chain completes today, the *only* thing that happens is the textbox becomes enabled
  (`VeriComposer.tsx:518`, `chainComplete` unlocks the `disabled` condition) and, on Home, the
  greeting/briefing card (`home/page.tsx:260-289`) plus `HomeThreadSlot` (a scrolling message-history
  view, `HomeThreadSlot.tsx:36-40`) continue to render unchanged. There is no document/record view,
  no field grid, no line-items table, no arithmetic, and no "Make Duplicate" affordance anywhere in
  this codebase today.
- *Direction — this is the largest, hardest item in this document, and needs to be built as new,
  real feature work, not a port*:
  1. **New component**: `src/components/veri-chat/TaskDocumentScreen.tsx`, rendered conditionally
     wherever the app's main content area is composed for a `veriChatV2Enabled` org — the natural
     hook point is `AppShell.tsx`'s `children` wrapper (around line 173-182), gated on a new
     `documentScreenActive` boolean (see item 5 below), rendered in place of `{children}` when true.
  2. **Title/entity derivation — a genuinely reusable rule, not per-chain hardcoding.** Port the
     mockup's fixed-position heuristic exactly (mockup lines 2100-2112, this session's own bug fix):
     for a completed `PathSegment[]` of length ≥ 3, `functionSeg = path[2]`, `qualifiers =
     path.slice(3)`; for shorter paths, `functionSeg = path[path.length - 1]`, `qualifiers = []`.
     Implement this as a small, independently unit-testable pure function — e.g.
     `deriveDocumentTitle(path: PathSegment[]): { functionLabel: string; qualifierLabels: string[] }`
     — exported from `ChainSelector.tsx` alongside its sibling helpers `pathSegmentDisplay`/
     `pathDisplayString` (lines 30-37), since it operates on the same `PathSegment[]` shape and
     belongs with the other pure path-derivation logic, not duplicated inside the new component.
     Add a unit test (this repo's convention per `PROGRESS.md`'s own citations, e.g.
     `hr-loan-service.test.ts` — pure-function tests, no live DB) covering: a 2-level chain (no
     qualifiers), a 7-level chain (module/area/function/4 qualifiers, matching the
     Finance→Accounts→GST→Acme Corp→Mumbai HQ→FY2025-26→Q1 example from the task), and a 3-level
     chain (function with zero qualifiers).
  3. **Field values — do NOT port the mockup's mock data mechanism as-is.** The mockup's
     `mockRefNumber()` (a hash of the path string) and hardcoded `lineItems` (mockup lines 2068-2072,
     2113-2127) are explicitly labeled `"Mock record — auto-filled"` in its own UI (mockup line
     2140) precisely because there is no real backend behind a static HTML file. Production **does**
     have a real backend, so this is the one part of the mockup that must NOT be copied literally —
     doing so would ship fabricated numbers in a real product. Concretely:
     - For a completed leaf that already resolves to a real entity (`resolveLeaf()` in
       `VeriComposer.tsx:115-126` — a leaf carrying `projectId`, `codeReference`/`agentId`, or
       `engineKey`, per the existing structured-dispatch fields documented in
       `VERI_CHAT_COMPOSER_DESIGN.md`'s "Deliberate divergences" section), fetch that entity's real
       fields from its real backing table/API (e.g. a Project's real name/dates, a Customer's real
       billing details) rather than inventing them.
     - For a completed leaf with **no** real backing record (most of the tree today, since
       `WAVE_114_DETERMINISTIC_DISPATCH.md`'s own "What's still open" section — cited in
       `VERI_CHAT_COMPOSER_DESIGN.md` — documents that only a minority of leaves carry real
       `codeReference`/`engineKey` data), the honest choice is to show the field grid **empty and
       editable** (a genuine blank form the user fills in), not a plausible-looking fabricated
       reference number and line items the way the mockup does. Label this state plainly (e.g.
       "New record — nothing to prefill yet") rather than reusing the mockup's
       "Mock record — auto-filled" language, since production's blank-form case and the mockup's
       fake-but-labeled-fake case are different situations that deserve different copy.
     - This is a real product decision the implementing session should not make unilaterally beyond
       the two cases above — if a specific module's leaves need a real schema built out further
       (e.g. a genuine `task_documents` table linking a dynamic chain to a real editable
       record), that is out of scope for this spec and should be raised as its own follow-up rather
       than improvised inline.
  4. **Line-items arithmetic**: this part *can* be ported directly — `Subtotal = Σ(qty × rate)`,
     `Tax = round(Subtotal × 0.18)`, `Total = Subtotal + Tax` (mockup lines 2199-2206) is genuine,
     backend-agnostic arithmetic with no fabricated-data problem; add/remove-line (mockup lines
     2208-2256) similarly ports directly as real client-side list editing.
  5. **Submit** must call the *same* dispatch path `send()`/`dispatchInstruction()` already uses
     (`VeriComposer.tsx:262-377`), not a second parallel POST — concretely, compose the same kind of
     summary text the mockup builds (mockup lines 2276-2284) and route it through
     `dispatchInstruction(selectedPath, summaryText)`, then clear the document-screen's local state
     the same way the mockup does (`delete taskDocumentState[docKey]`, line 2283) — but keep in mind
     production's `dispatchInstruction` already has real side effects (task creation via
     `POST /api/tasks`, high-impact confirmation gating, `bumpRefresh()`) that the mockup's fake
     `dispatchInstruction` does not, so this call must go through the *existing* function, never a
     re-implementation of it.
  6. **"Make Duplicate"** reuses the exact same handler §3.2.5 wires up for "Create similar task
     again" (mockup line 2294 does this literally: `duplicateBtn.addEventListener("click",
     createSimilarTaskAgain)`) — one real mechanism, two entry points, not a second subtly-different
     duplication path. Build §3.2.5 first; this button is then a two-line addition, not new logic.
  7. **Full-takeover behavior — needs ONE shared toggle, not several independently-checked
     conditions.** The mockup's own comment (lines 2073-2079) is explicit that this must be driven
     from a single place so it can't drift out of sync — replicate that discipline. Add a single
     derived boolean, e.g. `documentScreenActive = isChainMode(composerMode) && chainComplete`,
     computed **once** in `veri-chat-context.tsx` (alongside the `chainComplete`/`selectedPath` state
     already being lifted there per §2's coupling note and §3.1.2), and consumed by every section
     that needs to hide:
     - `src/app/(app)/home/page.tsx`'s `veriChatV2Enabled` branch (lines 260-288): the greeting/stats
       block and `<AchievementCard />`/`<VeriTreasureWidget />` (lines 284-285) — confirmed these are
       the actual real elements on that branch today, not a placeholder list.
     - `AppShell.tsx`'s `homeThreadSlot={<HomeThreadSlot />}` prop (line 171) — pass
       `documentScreenActive ? null : <HomeThreadSlot />` (or an equivalent conditional) instead of
       always rendering it.
     - The new `TaskDocumentScreen` itself is the thing shown *instead*, gated on the same boolean,
       in the same content region.
     Do **not** reproduce the mockup's own mechanism (a hardcoded array of DOM element IDs,
     `HOME_SECTIONS_HIDDEN_WHEN_DOC_ACTIVE`, mockup lines 2080-2084) literally — that pattern only
     makes sense for a single monolithic script manipulating raw DOM nodes. In React, the equivalent
     discipline is: one context-level boolean, consumed via conditional rendering at each real
     component that needs to hide, never a duplicate boolean recomputed independently at each site
     (which is exactly the "drift out of sync" risk the mockup's own comment warns about).
- *Acceptance criteria*: completing any chain (verified across at least two different modules, e.g.
  Finance and Compliance) replaces the Home page's greeting/achievement/treasure content and the
  thread history with the document screen, with a title correctly derived per the positional rule
  (verify the exact GST/Acme Corp/Mumbai HQ/FY2025-26/Q1 example from the task produces
  `"GST — Acme Corp, Mumbai HQ, FY2025-26, Q1"`, not `"Q1 — ..."`); editing line items live-updates
  Subtotal/Tax/Total with correct 18% GST arithmetic; Submit dispatches through the real
  `/api/tasks` pipeline (confirm a real task row is created, not just a UI-only success toast); after
  Submit, all previously-hidden Home sections reappear.

---

### 3.4 External-AI handoff

- *Mockup reasoning*: a "copy this" link near the composer copies a plain-text prompt (brand +
  current chain context + typed instruction) to the clipboard, captioned "You can copy this to work
  via ChatGPT, Gemini, Grok, etc." — explicitly not a fabricated persistent URL (a static mockup
  can't host one); the honest version of "a link to share" is a copyable context prompt. Falls back
  to `window.prompt` with the text if clipboard access is denied.
- *Real current state*: **no equivalent exists in production.** `VeriComposer.tsx`'s caption row
  (lines 719-733) has exactly one link today — `/connectors` (a "Connect your tools" affordance) —
  and nothing else. No copy-to-clipboard affordance, no external-AI framing, exists anywhere in this
  component or elsewhere in `src/components/veri-chat/`.
- *Direction*: add a second small button/link to the same caption row (`VeriComposer.tsx:719-733`),
  next to the existing `/connectors` link, captioned to match the mockup's own honest framing
  ("You can copy this to work via ChatGPT, Gemini, Grok, etc."). On click, build a plain-text prompt
  from real, already-available state — brand name (`AppShell.tsx`'s existing `brandName`
  prop/`me?.brandName`, already threaded through this component tree, not a new fetch), the current
  `selectedPath` (via `pathDisplayString()`, already imported at `VeriComposer.tsx:26`) plus whether
  `chainComplete`, and the current `value` (typed instruction) — mirroring the mockup's
  `buildExternalAiHandoffPrompt()` (mockup lines 3336-3344) structurally, but sourced from real
  component state instead of mockup globals. Use `navigator.clipboard.writeText()` with a
  `window.prompt(text)` fallback on rejection/unavailability (mirroring mockup lines 3352-3356
  exactly — this fallback pattern is genuinely reusable as-is, not mockup-specific).
- *Acceptance criteria*: with a chain in progress and text typed, clicking "copy this" places a
  plain-text prompt containing the real brand name, the real current chain breadcrumb, and the
  typed text onto the system clipboard (verify via a real paste, not just absence of a thrown
  error); denying clipboard permission in the browser falls back to a visible `window.prompt` dialog
  containing the same text rather than failing silently.

---

### 3.5 Resizable composer

- *Mockup reasoning*: a drag handle at the top edge of the composer dock, styled like the existing
  left/right sidebar resize handles, lets the user resize the composer vertically — drag down to
  shrink toward just the message box, drag up to restore, never taller than its own natural content
  height (same min/max pattern already used for the two sidebars). A real structural bug was found
  and fixed while building this: caption lines and the alternate Chats/Discuss/To-Do composer boxes
  were incorrectly nested *inside* the resizable/clippable region, so shrinking the composer hid the
  actual message box while keeping caption text pinned visible — fixed by moving those elements to
  be true siblings outside the resizable wrapper.
- *Real current state*: **no vertical resize of the composer exists in production.** Confirmed by
  reading `VeriComposer.tsx` in full: there is no drag handle, no `max-height` state, and no resize
  logic anywhere in this component. The *sidebars themselves* do have real resize behavior today, but
  it lives inside `AppShellFrame` (`@fchecklist/veridian-ui-kit/shell`)'s own `useResizableWidth`
  hook (per `AppShell.tsx:37-47`'s own comment) — i.e. the pattern to mirror for width already exists
  in the shared kit, but nothing equivalent exists for the composer's height, in either the shared
  kit or this repo.
- *Direction*:
  1. Add a drag handle above `VeriComposer.tsx`'s outer wrapper (the `<div className="shrink-0
     border-t ...">` at line 535), styled consistently with whatever visual language
     `AppShellFrame`'s existing sidebar handles use (inspect the shared kit's handle styling before
     inventing new CSS, so the new handle doesn't look like a third, inconsistent resize affordance).
  2. Track a `maxHeight` state **in this repo** (`VeriComposer.tsx` or a hook it uses), not inside
     `veridian-ui-kit` — per §2's coupling note (item 6), this is specifically to avoid the
     already-disclosed "no prop surface for persisted width" regression `AppShell.tsx:37-47`
     documents for the sidebar. If persistence across reloads is wanted (the mockup doesn't persist
     it either — confirmed no `localStorage` call in the mockup's own resize code, mockup lines
     3444-3471 — so this is optional, not a hard requirement), it should be straightforward to add
     later specifically because the state lives in this repo's own code, not the shared kit's.
  3. Clamp between a minimum height (enough for just the message box + send button) and the
     composer's own natural/full content height (`scrollHeight`), mirroring the mockup's exact
     approach (`MIN_HEIGHT`, `naturalMax = target.scrollHeight`, mockup lines 3444-3464) — the
     `scrollHeight` trick (it reports true full content height regardless of an already-applied
     `max-height`) is a genuinely reusable technique, not mockup-specific.
  4. **Structural requirement, stated explicitly so the same bug isn't re-introduced**: apply the
     resizable `max-height`/`overflow` wrapper **only** around the mode-pills + Step 2 chain banner +
     textbox group (`VeriComposer.tsx:538-718`, ending at the closing `</div>` for the textbox
     container) — the caption `<p>` at line 719-733 and the "Back" button at lines 735-739 must
     remain **true siblings outside** that wrapper, not nested inside it. Verify this explicitly once
     built: shrinking the composer to its minimum height must still show a visible, readable caption
     line, never hide it.
- *Acceptance criteria*: dragging the new handle down shrinks the composer toward just the message
  box while the caption line and any active alternate composer box (Chats/Discuss/To-Do, if those
  render as separate boxes in this codebase — verify against current `composerMode` branches in
  `VeriComposer.tsx` before assuming a 1:1 structural match to the mockup) remain visible; dragging
  up restores it; the composer is never draggable taller than its own natural content height.

---

### 3.6 "Your Frequent Tasks" mode / real prompt library

- *Mockup reasoning*: an illustrative end-user task-shortcuts list (unchanged, existing feature)
  sits alongside a **new**, separate "AI Team prompt library on the server (real)" card — sourced
  from a real investigation of the server's actual `compliance.prompt_templates` table. The Owner's
  belief that this table held 1000+ end-user prompts did not hold up on investigation — the real
  count is 219, and they are AI-Team **role** system-prompts (e.g. "you are the Access Auditor..."),
  not end-user task shortcuts. This was surfaced honestly in the UI rather than silently assumed, and
  backed by a genuine small IndexedDB database (one object store, seeded from a real 7-row sample,
  queried asynchronously) per the Owner's explicit "create a small database for it, for mock, in
  local" instruction.
- *Real current state*: confirmed `promptTemplates` is a real table (`src/lib/db/schema.ts:2134`),
  and confirmed it is genuinely 219 rows of AI-Team role prompts per the mockup's own investigation —
  this document did not independently re-run that count (no live DB connection available in this
  session), so it is repeated here as-cited, not independently re-verified; flagging that
  distinction honestly rather than presenting it as freshly confirmed. Separately, **production
  already has a real, working, more sophisticated analog of "recall a previous workflow"**:
  `IntentCommandPalette.tsx` (197 lines) + `browser-intent-cache.ts`, opened via `/` or Tab on an
  empty composer (`VeriComposer.tsx:692-695`), which queries a **real IndexedDB store first**
  (`queryIntents()`, per-user, per-device, populated from the user's own actual chain+text
  submissions via `saveIntent()` at send time, `VeriComposer.tsx:279`) and falls back to a real
  server endpoint, `GET /api/dynamic-chains/my-library`, when the local cache is empty for the
  current mode (`IntentCommandPalette.tsx:73-96`). This is a genuinely real, already-shipped
  per-user workflow-recall feature — not a static prompt catalog, and not something this document
  found lacking. There is, however, **no dedicated "Your Frequent Tasks" screen/mode** and **no
  end-user-facing surface for `promptTemplates`** anywhere in production today — both are genuinely
  absent, confirmed by searching `src/components/veri-chat/` and `src/app/(app)/home/` for either
  concept.
- *Direction — recommend NOT porting this feature as literally described, for the same honesty
  reason the mockup itself surfaced*: building an end-user-facing "Frequent Tasks" screen backed by
  `promptTemplates` would misrepresent 219 AI-Team role system-prompts as end-user task shortcuts,
  the exact confusion the mockup's own investigation was trying to prevent. Two real options,
  neither of which is "port the mockup's UI as-is":
  1. **Preferred**: treat "recall your own recent/frequent workflows" as **already solved** by
     `IntentCommandPalette`/`browser-intent-cache.ts` — genuinely per-user, genuinely real data, no
     new feature needed. If the Owner specifically wants a persistent (not just `/`-or-Tab-triggered)
     "Your Frequent Tasks" card visible on Home without opening the palette, that's a small,
     legitimate UI addition: surface the palette's own already-real `queryIntents()` results (most-
     used or most-recent, already tracked via the `pinned`/`favorite` fields visible in
     `IntentCommandPalette.tsx:161-162`) as a small card, reusing that existing data layer — not a
     new IndexedDB store.
  2. **If** the Owner separately wants a genuine surface for the real 219-row `promptTemplates`
     table, build it as an **ops/admin-facing** view, not an end-user Home feature — the natural
     home for it is one of the two real, already-built admin surfaces this repo has for exactly this
     kind of AI-Team-facing data: `/orchestra` (`src/app/(app)/orchestra/`, "VERI Operations AI" per
     `AppSidebar.tsx:420-423`) or `/prompt-eval` (`src/app/(app)/prompt-eval/`, "Prompt Eval Lab" per
     `AppSidebar.tsx:425-428`). This is a genuinely different, separately-scoped feature from
     "Frequent Tasks" and should be tracked/prioritized as its own item, not bundled into this
     document's Home-page work.
  Do **not** build a new mock IndexedDB database seeded with a hardcoded 7-row sample in production
  — that pattern is specifically a mockup convenience (no real server to fetch from in a static
  file). Production has a real `promptTemplates` table and a real API layer; a genuine
  implementation of option 2 should query it for real, not simulate it locally.
- *Acceptance criteria*: if option 1 is pursued, a "Your Frequent Tasks" card on Home shows the
  same real per-user recall data `IntentCommandPalette` already surfaces (verify by comparing the
  card's contents against what `/` on the composer shows for the same user/session — they should
  agree, since they'd share the same data layer). If option 2 is pursued instead/also, verify the
  resulting admin view queries the real `promptTemplates` table live (not a hardcoded sample) and is
  clearly labeled as AI-Team role prompts, not end-user shortcuts, continuing the honest labeling
  the mockup itself established.

---

## 4. Consolidated "very clear directions" checklist

For the implementing session to work through in order (later items depend on earlier ones where
noted):

| # | Change | Primary file(s) | Depends on |
|---|---|---|---|
| 1 | Lift `selectedPath` into `veri-chat-context.tsx` | `veri-chat-context.tsx`, `VeriComposer.tsx` | — |
| 2 | `ChainRows` renders only the deepest row | `ChainSelector.tsx:120-229` | — |
| 3 | Step 2 overlay/backdrop + auto-collapse | `VeriComposer.tsx:565-613` | 2 |
| 4 | Breadcrumb repositioned + clickable "create another" | `VeriComposer.tsx:35-49, 567-570` | 5 |
| 5 | "Create similar task again" replaces queue (delete queue code) | `VeriComposer.tsx:135, 480-499, 654-669, 707-711` | — |
| 6 | Per-segment × (breadcrumb + new inline chain label) | `VeriComposer.tsx:35-49, ~680` | 1, 5 |
| 7 | Sidebar-click → composer chain sync + href-to-path mapping | `AppSidebar.tsx`, `veri-chat-context.tsx` | 1 |
| 8 | `deriveDocumentTitle()` pure helper + unit tests | `ChainSelector.tsx` | — |
| 9 | `documentScreenActive` single toggle in context | `veri-chat-context.tsx` | — |
| 10 | `TaskDocumentScreen.tsx` new component | `src/components/veri-chat/TaskDocumentScreen.tsx` (new) | 5, 8, 9 |
| 11 | Wire full-takeover hiding at Home + `homeThreadSlot` | `home/page.tsx:260-288`, `AppShell.tsx:171` | 9, 10 |
| 12 | External-AI "copy this" link | `VeriComposer.tsx:719-733` | — |
| 13 | Resizable composer drag handle (structural care re: caption siblings) | `VeriComposer.tsx:535-741` | — |
| 14 | Update `VERI_CHAT_COMPOSER_DESIGN.md`'s queue mapping-table row | `VERI_CHAT_COMPOSER_DESIGN.md` | 5 |
| 15 | Frequent Tasks: prefer surfacing existing palette data; scope any real `promptTemplates` UI as a separate admin item | `IntentCommandPalette.tsx` or new admin view | — |
| 16 | Sidebar spacing (§3.1.1) — flag as `veridian-ui-kit`-repo work, not local | *(external repo)* | — |

Every row above has its own fully-specified acceptance criteria in §3 — this table is a sequencing
aid, not a substitute for reading the corresponding §3 subsection before implementing it.

---

## 5. Testing discipline

Per this repo's own established convention (confirmed in `CLAUDE.md`, `AGENTS.md`, and
`PROGRESS.md`'s own citations): unit tests are pure-function tests with no live DB
(`*.test.ts`, run via `bun test` — `PROGRESS.md` cites "2073 pass / 0 fail" as a real recent run),
and `bunx tsc --noEmit` is run for full-repo type-checking. Neither of these substitutes for real
browser verification of UI behavior — most of what this document specifies (overlay/collapse
animation, drag-resize, clipboard copy, per-segment × interaction, the document screen's live
arithmetic) is **interactive, visual UI behavior that a pure-function test cannot verify**. This
repo's own `e2e/` directory (Playwright, `playwright.config.ts`, e.g.
`e2e/browser-execution-tiers.spec.ts`) is the closest existing convention for this, but note the
same disclosed limitation `VERI_CHAT_COMPOSER_DESIGN.md`'s own "Status" section already flags: local
dev in this environment throws on any DB-touching route because `DATABASE_URL` is a Vercel Sensitive
var not available locally, which blocks a fully local E2E run for anything that touches real data
(task creation, capability-tree fetch, conversation messages — nearly everything this document
touches). Concretely, for each item in §3/§4:
- Verify **live**, either against a deployed preview/staging environment or directly on the
  production server session this document is handed to (per the Owner's own instruction that this
  document is for a session "running directly on the production server") — not solely via
  `bun run dev` locally.
- For anything with a pure, extractable piece of logic (§3.2.2's row-filtering, §3.3's
  `deriveDocumentTitle()`, §3.3's arithmetic), write a real `*.test.ts` unit test first — these
  **can** and should be verified via `bun test` without needing a live DB, matching this repo's
  existing convention exactly.
- For everything else (overlay/collapse, drag-resize, clipboard, full-takeover hide/show,
  sidebar-to-composer sync), the acceptance criteria in §3 are written as literal steps to perform
  in a real, running browser session against real data — treat each "verify live in the browser"
  instruction in §3 as a mandatory step, not optional polish, before considering that item done.
- Follow this repo's own PR/CI gate (`AGENTS.md` Rule 6): work on a branch, open a PR, let CI
  (Lint/Type Check/Build/Unit Tests) run and pass, and — per Rule 10 — post an `AUDIT: PASS`/
  `AUDIT: FAIL` comment from whichever agent did not implement the change, before merge. No direct
  push to `main`.
