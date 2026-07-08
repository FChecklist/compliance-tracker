# VERI Chat Composer — Design Documentation

## Source

The prototype: [veridian-scope-selector-in-home.html](veridian-scope-selector-in-home.html) (repo root), a standalone, dependency-free HTML/Tailwind/vanilla-JS mockup titled *"merged home / persistent composer mockup"*. It was built and iterated on as a throwaway click-through prototype, then committed alongside its own production port in commit `c8cd6ce` ("Add persistent VERI Chat composer with dynamic capability-tree chain selector") — kept in the repo as the reference this feature was validated against, not as dead weight.

No design doc existed for it until now; the only prior trace of intent was that commit's message and the inline comments in the production files it produced. This document exists to close that gap.

## The problem it was prototyping

Before this, the only AI surface was a floating chat dock (`GlobalChatDock`) — free text in, free text out, with the LLM guessing intent from scratch every time. For a multi-tenant ERP/compliance product with dozens of modules, "just type what you want" doesn't scale: most users don't know the right words for "run payroll" vs. "generate payslips" vs. "check leave balance," and free text gives the LLM nothing structured to dispatch against.

The mockup tests a different idea: **a persistent input surface, always in the same place, that narrows what you can type via clicks before you type it** — so by the time the textbox is even enabled, the system already knows *who* and *what* this is about.

## Core UX concepts (as built in the mockup)

**1. Mode Pills** — a pill row above the composer answering "what am I about to do": `Tasks`, `Reports`, `Analysis`, `Email`, `Chats`, `Discuss`, `To Do`. Each pill either pre-seeds the Chain Selector at a fixed starting branch (`Reports`, `Analysis`, `Email` jump straight past the top-level list) or switches to a wholly different composer behavior (`Chats` = pick a person and type free text; `Discuss` = ask anything, no selection required; `To Do` = a bare add-a-line checklist, not routed through the assistant at all).

**2. Chain Selector ("scope banner")** — below the pills, a stack of rows that cascade one level at a time through a hand-authored taxonomy tree (`TREE` in the mockup: Finance → Accounts → GST → [customer] → [branch] → [FY] → [quarter], and similarly for Procurement/Sales/Inventory/HR/Compliance/Email/Calendar/Reports/Analysis/Documents/Customer/Vendor/Internal/"Create new"/Settings). Clicking a chip either:
   - **Single-select** (`rchip`): selects one option at that depth, revealing the next row; clicking the same chip again backs out. Chips for a genuine leaf (no further children) render in teal instead of navy so "this is a stopping point" is visually distinct from "there's more to pick."
   - **Multi-select** (`chip`, checkbox-style): only used where the node is flagged `__multi: true` (the mockup's `Customer` and `Vendor` branches, so a user can fire the same instruction — e.g. "send reminder" — at several customers in one shot). When multiple values are picked at a multi-select depth, the next row shows the **union** of all their children (`childrenUnion()`), and sending expands back out into one concrete instruction per selected value (`expandPathsForSend()`).

   The textarea stays disabled and greyed out until the chain reaches a leaf (`chainComplete`); a breadcrumb line ("Building: Finance-Accounts-GST-Acme Corp…") tracks progress live, turning green once complete.

**3. Queue ("+ Add another")** — once a chain is complete and text is typed, the user can stage it (`queueCurrent()`) instead of sending immediately, which resets the chain for a second instruction without losing the first. A queue strip lists staged items as removable chips with a "Send all (N)" button (`sendAllQueued()`).

**4. The merge mechanic** — this is the mockup's namesake idea. On the Home page, the assistant's thread renders inline in the page body (`homeThreadSlot`), and the right-hand VERI Chat panel is hidden entirely — "everything's merged into one screen." Navigate to any *other* page (Dashboard, Accounts, Email) and the exact same DOM node (`threadArea`) physically relocates (`appendChild`) into a persistent right-side panel instead, un-merging so the main content area is free for real page content. Same render functions, same state, only the parent element changes.

**5. Right panel — independent of the composer.** The right panel has its own four view tabs — `Overview` / `Tasks` / `Chats` / `To Do` — deliberately on a separate state variable (`rightPanelView`) from the composer's mode, because *what you're doing* (composer) and *what you're looking at* (panel) are genuinely different questions that shouldn't fight each other when you switch one. `Overview` merges recent/attention-worthy items across all three categories, sorted by recency, so navigating to a non-Home page always lands on something useful rather than whatever list was open last. Opening a specific task or human conversation is the one thing that's shared between both sides (`activeTaskKey` / `activeHumanChatId`) — continuing a thread genuinely needs the composer and the panel to agree on what's open.

**6. Resizable, collapsible sidebars** — left nav and right panel are both drag-resizable (`makeResizable()`) and independently toggleable via header icon buttons, so the layout survives being squeezed for a real page's own content.

The mockup's `dispatchInstruction()` has **no real backend** — it's a `setTimeout`-delayed canned acknowledgment ("New task started — I'm on it") purely to validate the interaction loop, not the execution.

## Mapping: mockup construct → production code

| Mockup construct | Production equivalent |
|---|---|
| `TREE` (hardcoded taxonomy) | [`capability-tree-service.ts`](src/lib/services/capability-tree-service.ts)'s `buildCapabilityTree()` — assembled live from real product branches → modules → worker agents, real Product/Project data, real Customer/Vendor entities, real compliance items, and real VCEL calculators. Nothing hand-authored. |
| `renderChain()` / row cascade / `rchip`/`chip` | [`VeriComposer.tsx`](src/components/veri-chat/VeriComposer.tsx)'s `ChainRows` sub-component + `nodeChildrenAt()`/`toggleSingle()`/`toggleMulti()` — same walk algorithm, same single-vs-multi chip logic, same leaf-color distinction (`bg-emerald-700` for leaves). |
| `COMPOSER_MODES` / `CHAIN_PRESEED` | `FIXED_MODES` (`discuss`, `chats`, `todo` — a fixed, small set) plus every *other* pill now generated dynamically, one per top-level `CapabilityNode` returned by the API (`tree.filter(n => !FIXED_MODES.includes(n.key))`) — the mockup's fixed 7-pill array became data-driven. |
| `expandPathsForSend()` / multi-select fan-out | Same function, same name, in `VeriComposer.tsx` — ported near-verbatim. |
| Queue / "+ Add another" / "Send all" | Same UI and behavior, `queue` state + `queueCurrent()`/`sendAllQueued()` in `VeriComposer.tsx`. |
| `resetChain()` re-seeding after send | `useEffect` on `composerMode` change in `VeriComposer.tsx`, same reasoning documented inline. |
| Right panel view tabs (Overview/Tasks/Chats/To Do) | [`VeriChatPanel.tsx`](src/components/veri-chat/VeriChatPanel.tsx) — same four tabs, same badge-count logic, same "Overview mixes all three, sorted by recency" behavior, now backed by real `/api/tasks`, `/api/conversations`, `/api/veri-todo`. |
| `activeTaskKey` / `activeHumanChatId` shared state | [`veri-chat-context.tsx`](src/components/veri-chat/veri-chat-context.tsx)'s `VeriChatProvider` — `activeTaskId`/`activeConversationId`, `openTask()`/`openConversation()`/`closeThread()`, plus `composerMode` and `rightPanelView` kept as the same two deliberately-independent axes the mockup's comments called out. |
| `dispatchInstruction()` (fake ack) | Real `POST /api/tasks` → `task-service.ts`'s `createTask()` → `task-execution-engine.ts`'s `executeTask()` — genuinely dispatches (LLM-planned by default; deterministic/non-LLM when the leaf carries `codeReference`/`engineKey`, added later in Wave 114 — see [WAVE_114_DETERMINISTIC_DISPATCH.md](WAVE_114_DETERMINISTIC_DISPATCH.md)). |
| Resizable/collapsible sidebars | [`AppShell.tsx`](src/components/AppShell.tsx) — `ResizablePanelGroup`/`ResizablePanel`/`ResizableHandle` (shadcn primitives, not hand-rolled drag math) + `sidebarCollapsed` state wired through `AppTopbar`. |

## Deliberate divergences from the mockup

- **The DOM-relocation "merge" trick was not carried into production.** The mockup literally moves one DOM node between two parents depending on which page is open. Production instead keeps `VeriComposer` and `VeriChatPanel` **permanently mounted side-by-side** via `AppShell.tsx`'s `ResizablePanelGroup`, on every page, all the time — visually equivalent to the mockup's "away from Home" state, but structurally simpler (two components, no node-relocation) at the cost of the mockup's Home-only full-merge illusion. Home compensates for this with its own special case (below).
- **The Home page's `veriChatV2Enabled` branch renders only a greeting/briefing card** and relies entirely on the AppShell-level composer/panel for everything else — an explicit, disclosed simplification of the mockup's "same thread, same DOM node, different parent" idea, documented inline: *"The AppShell-level VeriComposer + VeriChatPanel already provide the composer/thread/chat-list experience for these orgs — this page only needs to contribute the greeting/briefing card above it, not its own parallel composer."*
- **Flag-off orgs get a different, older Home experience entirely.** `src/app/(app)/home/page.tsx` also contains a second, independently-built "Home 2" layout (dated 2026-07-06, predates/parallels this feature) — its own resizable two-column AI-thread view reusing `/veri-ai`'s conversation plumbing directly. Orgs without the `veri_chat_v2` product branch enabled see *that* instead of anything described in this document. This is intentional feature-flag branching, not accidental duplication — but it does mean two separate chat-thread UIs are maintained in parallel until `veri_chat_v2` is the only path (a known, disclosed cost of the gradual-rollout approach; also flagged in the platform audit's "duplicate chat UIs" finding alongside `/veri-ai` and `/chat`).
- **Real dispatch replaces the fake `setTimeout` acknowledgment.** Covered above — this is the entire point of shipping it for real rather than just as UX validation.
- **Structured/deterministic dispatch has no mockup equivalent at all.** `CapabilityNode.codeReference`/`engineKey`/`agentId`/`fixedInputs`/`inputFields` and the calculator-input form in `VeriComposer.tsx` (Wave 114) are a pure production addition, added after the mockup was already ported, to let a completed chain skip LLM planning entirely when the leaf already carries a real, resolvable id.
- **Everything is reversible per-org.** The mockup is a single hardcoded demo with no concept of tenancy. Production gates the entire feature behind the `veri_chat_v2` product branch (`veri-chat-v2-enablement-service.ts`), flip-off-able without a redeploy — flag-off orgs render byte-identical to pre-existing production.

## Where the real implementation lives

- [`src/components/veri-chat/veri-chat-context.tsx`](src/components/veri-chat/veri-chat-context.tsx) — shared state (`VeriChatProvider`, `CapabilityNode`/`PathSegment` types)
- [`src/components/veri-chat/VeriComposer.tsx`](src/components/veri-chat/VeriComposer.tsx) — the persistent bottom composer
- [`src/components/veri-chat/VeriChatPanel.tsx`](src/components/veri-chat/VeriChatPanel.tsx) — the independent right-side panel
- [`src/lib/services/capability-tree-service.ts`](src/lib/services/capability-tree-service.ts) — builds the real tree from live data
- [`src/app/api/capability-tree/route.ts`](src/app/api/capability-tree/route.ts) — serves it to the client
- [`src/components/AppShell.tsx`](src/components/AppShell.tsx) — flag-gated mounting, resizable layout
- [`src/app/(app)/home/page.tsx`](src/app/(app)/home/page.tsx) — the Home-specific branch described above
- [`drizzle/0095_veri_chat_v2_branch.sql`](drizzle/0095_veri_chat_v2_branch.sql) — the enabling migration
- [`WAVE_114_DETERMINISTIC_DISPATCH.md`](WAVE_114_DETERMINISTIC_DISPATCH.md) — the later wave that made completed chains dispatch for free (no LLM) when possible

## Status

Live and rolled out platform-wide as of Wave 131 (2026-07-09). `product_branches.status` for `veri_chat_v2` is `'live'` (was `'building'`), and all 15 orgs on the platform have it enabled — previously only the internal demo org did. [`drizzle/0112_veri_chat_v2_rollout.sql`](drizzle/0112_veri_chat_v2_rollout.sql) backfilled every pre-existing org; [`src/lib/supabase/auth-guard.ts`](src/lib/supabase/auth-guard.ts)'s `autoProvisionUser()` now auto-enables it for every org created from here on (same free/on-by-default shape as `veri_reward`, not an opt-in vertical like `pms`). Confirmed live via direct SQL against Supabase (`orgs_enabled: 15` of `total_orgs: 15`) — local browser E2E isn't possible for this check due to the environment's pre-existing missing-`DATABASE_URL` limitation (documented all session; local dev throws on any DB-touching route).

The interaction model in this document is fully shipped; what remains open is widening *which* leaves carry real `codeReference`/`engineKey` dispatch data (tracked in `WAVE_114_DETERMINISTIC_DISPATCH.md`'s "What's still open" section), not the composer/panel mechanism itself.
