# Part 6 of 6 — Study of VERIDIAN.docx (lines 11632–13259), FINAL part

This is Part 6 (the final part) of an **independent** study by **z.ai GLM-5.2** of the source document `VERIDIAN.docx` ("VERIDIAN AI OS Engineering Standard / CSV 221 / UEIP Architecture v1.0"). A separate AI (Claude) performed its own independent study of the same document in parallel; the two will be cross-reviewed later, so the analysis below is my own genuine reading, not a guess at another AI's conclusions. This chunk covers Study 28 (UI/UX Constitution), Study 29 (Dynamic Mode Pills / Human Intent Engine), Study 30 (Visual Design & UX Guidelines), Study 31 (Standard Visual Design System v1.0), and Study 32 (VERIDIAN Design Language / Calm Intelligence Design System v1.0 — brand color, semantic color system, mode pills, context-path breadcrumb, chat coloring, confidence badges, motion/typography).

**Repo verification note:** I attempted to read `CLAUDE.md` to compare its stated live design tokens against Study 32's proposals, but that path is **governance-protected and could not be read** — so any "gap vs CLAUDE.md" claim below is explicitly marked *unverified*. I did read `tailwind.config.ts`, `src/app/globals.css`, `src/components/veri-chat/VeriComposer.tsx`, and `src/components/veri-chat/veri-chat-context.tsx` (the actual chat-context path; the `src/lib/veri-chat-context.tsx` path in the task does not exist).

---

## Study 28 — UI/UX Constitution

### 28.1 The Constitution as a governing document (source lines ~11632–11680)
- **Understanding:** Study 28 frames a "UI/UX Constitution" — a set of inviolable principles that every screen in VERIDIAN must obey, positioned above any individual design spec. It is governance for the UI layer, analogous to how CSV 221 governs the data/engineering layer.
- **Architecture/Schema implications:** No data model; implies a documented, versioned constitution that design reviews check against. Could be enforced via a lint rule or a `docs/ui-constitution.md` referenced in CI.
- **Gap vs current repo:** Could not verify — no constitution doc found in the paths I read. `CLAUDE.md` (which might reference it) is governance-protected.
- **Implementation recommendation:** Author `docs/ui-constitution.md` and add a pre-PR checklist item; do not gate CI on it yet.

### 28.2 Core principles: calm, no surprise, deterministic-first (source lines ~11680–11740)
- **Understanding:** The constitution's pillars are: calm UI (no flashing, no urgency theater), no-surprise behavior (controls do exactly what they say), and deterministic-first (real software runs before any AI is invoked; AI is a fallback, never the default path).
- **Architecture/Schema implications:** Reinforces the `deterministic` flag already present on `CapabilityNode`. Implies UI must visually distinguish deterministic leaves from AI-routed ones.
- **Gap vs current repo:** `veri-chat-context.tsx` already carries `deterministic?: boolean` on `CapabilityNode` and the comment "guaranteed to run as real software with zero AI involvement" — the data model supports this. The *visual* distinction in `VeriComposer.tsx` is not clearly present (no deterministic badge/tint found).
- **Implementation recommendation:** Add a small deterministic-vs-AI visual marker on capability leaves; reuse the existing flag, no schema change.

### 28.3 Human-in-the-loop and reversibility (source lines ~11740–11800)
- **Understanding:** Destructive or state-changing actions must be reversible or require explicit confirmation; the UI must never silently mutate compliance state. This is the UI expression of the broader UEIP audit/reversibility stance.
- **Gap vs current repo:** Could not verify a generic confirm/revert pattern from the files read. `VeriComposer.tsx` collects inputs but I did not see a destructive-action confirmation gate.
- **Implementation recommendation:** Standardize a `<ConfirmAction>` wrapper for any leaf whose `fixedInputs` imply a status mutation (e.g. "Mark completed").

---

## Study 29 — Dynamic Mode Pills / Human Intent Engine

### 29.1 Mode pills as the primary intent selector (source lines ~11800–11870)
- **Understanding:** Instead of a free-text box that guesses intent, VERIDIAN surfaces "mode pills" — clickable chips representing the available modes/engines — so the user declares intent by clicking, never by typing something that could be misspelled. This is the Human Intent Engine's UI surface.
- **Architecture/Schema implications:** Implies a finite, enumerated set of modes derived from the capability tree, rendered as pills. Each pill maps to a `composerMode` value.
- **Gap vs current repo:** **Partially exists.** `veri-chat-context.tsx` exports `FIXED_MODES = ["discuss","chats","todo"]` and a `composerMode` state; `VeriComposer.tsx` renders mode pills. However the fixed set is only three generic modes, not the per-engine/per-module pills Study 29 envisions, and the pills are not pastel-tinted per module (see Study 32).
- **Implementation recommendation:** Drive pill generation from `CapabilityNode` top-level children rather than a hardcoded `FIXED_MODES` array; keep `composerMode` as the state slot.

### 29.2 "select" input type — click, never type (source lines ~11870–11930)
- **Understanding:** When an engine bundles several functions, the UI offers a dropdown of fixed choices (`type: "select"`) so the user picks rather than types. This is explicitly the anti-typo pattern.
- **Architecture/Schema implications:** Already modeled: `CapabilityInputField.type` includes `"select"` with an `options` array.
- **Gap vs current repo:** **Exists.** `veri-chat-context.tsx` defines `CapabilityInputField` with `type: "number" | "text" | "select" | "number_list"` and `options`. The "select renders as a dropdown of fixed choices (a click, never typed text)" comment matches Study 29 verbatim in intent.
- **Implementation recommendation:** No schema change; verify `VeriComposer.tsx` actually renders `select` fields as a dropdown (appears to via ChainRows).

### 29.3 Human Intent Engine — inferring context from open entity (source lines ~11930–12000)
- **Understanding:** Beyond explicit pills, the Intent Engine uses the currently-open task/conversation/entity to narrow which capabilities are relevant, so the offered pills adapt to context (e.g. opening a compliance item surfaces item-scoped actions).
- **Architecture/Schema implications:** Implies context-aware filtering of the capability tree by `activeTaskId`/`activeConversationId`.
- **Gap vs current repo:** **Partial.** Context state exists (`activeTaskId`, `activeConversationId`, `openTask`, `openConversation`), and `CapabilityNode` supports entity-scoped leaves (`agentId` fallback, `fixedInputs`). But I did not find logic in the files read that *filters* the tree by the open entity — the tree is fetched once and rendered whole.
- **Implementation recommendation:** Add a context-filter pass over `tree` keyed on `activeTaskId` before rendering pills.

---

## Study 30 — Visual Design & UX Guidelines

### 30.1 Calm palette and restraint (source lines ~12000–12060)
- **Understanding:** Visual guidelines mandate a restrained, low-saturation palette, generous whitespace, and avoidance of alarmist color (no red urgency unless truly an error). The screen should feel quiet even when busy.
- **Architecture/Schema implications:** Design-token constraint: semantic colors must be muted; error red reserved for real errors.
- **Gap vs current repo:** `globals.css` uses a saffron/navy/teal palette that is reasonably calm, but it is **not** the VERIDIAN Lavender system Study 32 prescribes (see 32.x). Error red exists as `--destructive`.
- **Implementation recommendation:** Reconcile the existing saffron brand with Study 32's lavender brand — this is the single largest drift point (detailed under Study 32).

### 30.2 Progressive disclosure and step messaging (source lines ~12060–12130)
- **Understanding:** Complex actions are broken into steps; the composer locks during multi-step collection and shows "Step 1 of 2"-style messaging so the user knows where they are.
- **Architecture/Schema implications:** Implies a step counter derived from the count of required `inputFields` on a leaf.
- **Gap vs current repo:** `CapabilityNode.inputFields` exists and `VeriComposer.tsx` collects them via ChainRows, but I did **not** find explicit "Step X of Y" locked-composer messaging or a locked state in the files read.
- **Implementation recommendation:** Add a derived `stepIndex/stepTotal` from `inputFields.filter(f => !f.optional)` and render a step label; lock send until all required fields are filled.

### 30.3 Feedback states: thinking, understanding, done (source lines ~12130–12200)
- **Understanding:** The UI must communicate AI processing states explicitly — "VERI is understanding…", "VERI is thinking…" — rather than a generic spinner, so the user trusts the system is working deterministically.
- **Architecture/Schema implications:** Implies a processing-phase enum on the chat/message state.
- **Gap vs current repo:** Could not verify — no "VERI is understanding" thinking-state text found in `VeriComposer.tsx` or `veri-chat-context.tsx`. `aiThreadId` exists but no phase state.
- **Implementation recommendation:** Add a `veriPhase: "idle" | "understanding" | "thinking" | "done"` to chat context and surface it in the composer.

---

## Study 31 — Standard Visual Design System v1.0

### 31.1 Token structure: primitive → semantic → component (source lines ~12200–12260)
- **Understanding:** Study 31 defines a three-tier token system: primitive raw values, semantic tokens (background/foreground/border/muted), and component-level tokens. This is the standard shadcn structure.
- **Architecture/Schema implications:** CSS custom properties in `:root` / `.dark`, consumed by Tailwind.
- **Gap vs current repo:** **Exists and matches.** `globals.css` defines `--background/--foreground/--primary/--muted/--border/...` in HSL, and `tailwind.config.ts` maps them via `hsl(var(--...))`. This is exactly the three-tier model.
- **Implementation recommendation:** No change; this layer is already aligned.

### 31.2 Radius scale (source lines ~12260–12310)
- **Understanding:** Prescribes a radius scale (roughly 8px / 12px / pill-999).
- **Gap vs current repo:** **Partial mismatch.** `tailwind.config.ts` defines `--radius: 0.625rem` (10px) and `globals.css` exposes `6/10/16/20/28px` variants — close but not the 8/12/999 scale Study 31 names.
- **Implementation recommendation:** Minor; either update the doc to match the repo's 6/10/16/20/28 scale or align the repo to 8/12. Low priority.

### 31.3 Typography: Inter, scale, weights (source lines ~12310–12370)
- **Understanding:** Inter as the UI typeface, with a defined type scale and weight discipline (regular for body, medium/semibold for emphasis).
- **Gap vs current repo:** **Partial.** `globals.css` loads Inter for body but also `DM Serif Display` for headings — Study 31/32 specify Inter/SF Pro only, no serif. The serif heading is a drift point.
- **Implementation recommendation:** Decide intentionally: keep `DM Serif Display` as a deliberate brand choice (then document the exception) or drop it to comply.

### 31.4 Spacing and layout grid (source lines ~12370–12430)
- **Understanding:** A consistent spacing scale and a layout grid (composer fixed at bottom, panel on the side) — the "always in the same spot" principle.
- **Gap vs current repo:** **Matches.** `veri-chat-context.tsx`'s header comment explicitly states "VeriComposer (bottom, always in the same spot) and VeriChatPanel (right side)" — the layout intent is implemented as described.
- **Implementation recommendation:** No change.

---

## Study 32 — VERIDIAN Design Language / Calm Intelligence Design System v1.0

This is the densest section and the one with the largest gap vs the live repo. The repo's actual brand is **saffron (#F5820A) + navy + teal** with a purple `--draft` token; Study 32 prescribes **VERIDIAN Lavender (#7C6CF2)** as the brand color with a full pastel semantic system. These are incompatible as-is.

### 32.1 Brand color: VERIDIAN Lavender #7C6CF2 (source lines ~12430–12490)
- **Understanding:** The canonical VERIDIAN brand color is lavender `#7C6CF2`, used for the AI/VERI presence specifically (not as a generic primary).
- **Architecture/Schema implications:** A dedicated `--veri` / `--brand-lavender` token distinct from `--primary`.
- **Gap vs current repo:** **Missing.** `globals.css` has no `#7C6CF2` token. The closest is `--draft: #7C3AED` (a different purple, used for drafts, not VERI intelligence). `--primary` is saffron. `CLAUDE.md` comparison *unverified* (governance-protected).
- **Implementation recommendation:** Add `--veri: #7C6CF2` as a new semantic token; do not repurpose `--draft`. Decide whether saffron remains the product brand and lavender is the AI-only accent, or migrate fully.

### 32.2 Semantic color system — pastel tints per module (source lines ~12490–12560)
- **Understanding:** Each module/engine gets its own pastel tint (background + border + text) so mode pills and context paths are color-coded by domain at a glance, while staying calm (low saturation).
- **Architecture/Schema implications:** A map of module-key → `{tintBg, tintBorder, tintText}` tokens.
- **Gap vs current repo:** **Missing.** No per-module pastel tint map in `globals.css` or `tailwind.config.ts`. Mode pills currently use white/navy selected state, not per-module color.
- **Implementation recommendation:** Define a `moduleTints` record keyed by capability-tree top-level node `key`; expose as CSS vars or a TS map consumed by the pill renderer.

### 32.3 Mode pill visual spec (source lines ~12560–12620)
- **Understanding:** Mode pills are pill-shaped (radius 999), use the module's pastel tint when selected, neutral when not, with a clear selected/inactive contrast. They are the primary intent selector from Study 29.
- **Gap vs current repo:** **Partial.** Pills exist in `VeriComposer.tsx` and `composerMode` drives selection, but selection styling is white/navy, not pastel-per-module; radius 999 may or may not be applied (the repo radius scale leans toward 6–28px).
- **Implementation recommendation:** Restyle selected state to consume the `moduleTints` map; ensure `rounded-full`.

### 32.4 Context-path breadcrumb (source lines ~12620–12690)
- **Understanding:** As the user drills through the capability tree, a breadcrumb "context path" shows the chosen path as a series of capsules (e.g. *Compliance → Item X → Mark completed*), each capsule tinted by its module, so the user always sees what they've built.
- **Architecture/Schema implications:** A `PathSegment[]` state (already typed as `PathSegment = string | { multi: true; values: string[] }`) rendered as capsule chips.
- **Gap vs current repo:** **Partial — data exists, UI does not.** `veri-chat-context.tsx` defines `PathSegment` and `VeriComposer.tsx` builds a `pathDisplayString` (a flat text string "Building: …"), but there is **no capsule/breadcrumb chip UI** and no per-segment tinting. The path is rendered as text, not as the prescribed capsule trail.
- **Implementation recommendation:** Replace the flat `pathDisplayString` with a `<Breadcrumb>` of `PathSegment` capsules consuming `moduleTints`. No schema change — `PathSegment` already supports it.

### 32.5 Chat message coloring by source (source lines ~12690–12750)
- **Understanding:** Chat messages are colored by who spoke: VERI/AI messages use the lavender tint, user messages use a neutral/primary tint, system/deterministic messages use a distinct (likely teal/green) tint — so the user can visually distinguish AI output from deterministic software output.
- **Architecture/Schema implications:** A message-source enum → color mapping.
- **Gap vs current repo:** Could not fully verify — `VeriComposer.tsx` is the composer, not the message list; I did not read the message-rendering component. `aiThreadId` exists to identify the AI thread. No source-tinted message bubble spec found in the files read.
- **Implementation recommendation:** When implementing the message list, key bubble color off a `source: "user" | "veri" | "system"` field; reuse `--veri` for VERI bubbles.

### 32.6 Confidence badges (source lines ~12750–12810)
- **Understanding:** AI outputs carry a confidence badge (e.g. High/Medium/Low) so the user knows how much to trust a non-deterministic answer — reinforcing the deterministic-first constitution.
- **Architecture/Schema implications:** A `confidence` field on AI messages + a badge component with three visual tiers.
- **Gap vs current repo:** **Missing.** No `confidence` field in `veri-chat-context.tsx` state or `CapabilityNode`. Not found in `VeriComposer.tsx`.
- **Implementation recommendation:** Add `confidence?: "high" | "medium" | "low"` to the AI message type; render a small badge. Requires backend to emit confidence.

### 32.7 Motion rules — calm, no bounce (source lines ~12810–12860)
- **Understanding:** Motion must be calm: short fades, no bounce/elastic, no parallax theater. Transitions exist to clarify state change, not to entertain.
- **Architecture/Schema implications:** A motion token set (durations/easings) and a ban-list for bounce/elastic.
- **Gap vs current repo:** Could not verify a motion token set in `globals.css` or `tailwind.config.ts` (no `--duration-*` / `--ease-*` vars seen). Tailwind defaults would apply.
- **Implementation recommendation:** Add `--ease-calm` and `--duration-fast/normal` tokens; forbid `back`/`bounce` easings in lint.

### 32.8 Typography rules — Inter, scale, line-height (source lines ~12860–12910)
- **Understanding:** Reaffirms Inter, defines a type scale and generous line-height for readability.
- **Gap vs current repo:** Same as 31.3 — Inter present, but `DM Serif Display` heading is a drift.
- **Implementation recommendation:** Same as 31.3.

### 32.9 "VERI is understanding" thinking state (source lines ~12910–12960)
- **Understanding:** Repeats the explicit thinking-state copy requirement from 30.3 with the canonical phrasing "VERI is understanding…".
- **Gap vs current repo:** Same as 30.3 — not found.
- **Implementation recommendation:** Same as 30.3.

### 32.10 Deterministic-vs-AI visual distinction (source lines ~12960–13010)
- **Understanding:** Deterministic (real-software) outputs must look different from AI outputs — e.g. a "computed" badge or teal tint — so the user trusts the no-AI path.
- **Gap vs current repo:** Data flag `deterministic` exists on `CapabilityNode`; visual distinction not found in `VeriComposer.tsx`.
- **Implementation recommendation:** Render a "computed" marker on deterministic leaves/results.

### 32.11 Color contrast / accessibility floor (source lines ~13010–13060)
- **Understanding:** All tint combinations must meet a contrast floor (WCAG AA implied) despite the pastel calm aesthetic.
- **Gap vs current repo:** Could not verify an automated contrast check. Tokens are HSL-based and plausibly compliant but unverified.
- **Implementation recommendation:** Add a contrast lint step over the `moduleTints` map once defined.

### 32.12 Dark mode parity (source lines ~13060–13110)
- **Understanding:** The semantic system must have a full dark-mode counterpart; pastels become muted-deeper in dark.
- **Gap vs current repo:** **Partial.** `globals.css` defines a `.dark` block with HSL overrides for the core semantic tokens — dark mode exists. But the proposed lavender/pastel-module system has no dark counterpart yet (because it doesn't exist in light either).
- **Implementation recommendation:** When adding `--veri` and `moduleTints`, define dark variants in the same `.dark` block.

### 32.13 Component token mapping (source lines ~13110–13150)
- **Understanding:** Maps semantic tokens onto specific components (pill, breadcrumb capsule, message bubble, badge) so each component pulls from the semantic layer, not raw hex.
- **Gap vs current repo:** Core components already pull from semantic vars (shadcn pattern). The new VERIDIAN components (breadcrumb capsule, confidence badge) do not yet exist.
- **Implementation recommendation:** Build new components on top of semantic vars only.

### 32.14 Iconography stance (source lines ~13150–13190)
- **Understanding:** Icons are minimal, line-based, consistent stroke; no decorative emoji in chrome.
- **Gap vs current repo:** Could not verify icon library choice from files read.
- **Implementation recommendation:** Pick one line-icon set (e.g. lucide, already common with shadcn) and forbid emoji in UI chrome.

### 32.15 Empty/loading states (source lines ~13190–13230)
- **Understanding:** Every list/view has a calm empty state and a skeleton loading state — never a blank panel.
- **Gap vs current repo:** `veri-chat-context.tsx` has `treeLoading` and `tree` fallback to `[]`; `VeriComposer.tsx` handles loading. Specific skeleton/empty-copy not verified.
- **Implementation recommendation:** Add explicit empty-state copy per view.

### 32.16 Focus and keyboard navigation (source lines ~13230–13259)
- **Understanding:** Full keyboard navigability and visible focus rings; the constitution's no-surprise principle extends to keyboard users.
- **Gap vs current repo:** Could not verify focus-ring styling specifics from files read; shadcn defaults usually provide `--ring`.
- **Implementation recommendation:** Audit focus visibility once pills/badges are restyled.

---

## Cross-cutting gap summary

1. **Largest drift: brand color.** Repo = saffron/navy/teal (+ purple `--draft`); Study 32 = VERIDIAN Lavender `#7C6CF2` with pastel-per-module semantics. These are incompatible; a product decision is required before any token work.
2. **Data model is ahead of UI.** `veri-chat-context.tsx` already has `PathSegment`, `CapabilityInputField` (with `select`), `deterministic`, `engineKey`, `fixedInputs`, `agentId` — most of Study 29/32's data needs are met. The **rendering** (breadcrumb capsules, pastel pills, confidence badges, thinking-state copy, deterministic marker) is largely missing.
3. **`CLAUDE.md` unverified** — governance-protected, so I could not confirm whether the repo's *documented* tokens already acknowledge the lavender system. This must be checked by someone with read access.
4. **Serif heading drift** — `DM Serif Display` in `globals.css` contradicts the Inter-only typography rule in Studies 31/32; minor but real.
5. **Radius scale** is close (6/10/16/20/28 vs prescribed 8/12/999) — minor.
