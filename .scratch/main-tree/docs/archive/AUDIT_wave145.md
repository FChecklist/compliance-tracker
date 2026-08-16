> **ARCHIVED / STALE — do not treat as current.** See docs/master/INDEX.md or ai-os/MASTER-TRACKER.yaml for current status.

# AUDIT — wave145: `PathBreadcrumb` extraction in `VeriComposer.tsx`

**Scope:** Independent security/code audit of the `PathBreadcrumb` function component
and its single call site in `src/components/veri-chat/VeriComposer.tsx`.
This is an AUDIT-ONLY task; no application code was modified.

**Reviewer:** Security & Code Reviewer (VERIDIAN AI Workforce)
**Verdict:** **APPROVE WITH NOTES** (one minor a11y nit, no blocking issues)

---

## 1. Empty-path handling

```tsx
if (!path.length) return null;
```
Correct. An empty `selectedPath` (the initial state for non-preseeded modes, and the
state right after a mode switch where `preseedKeyForMode` returns `null`, e.g. `tasks`)
renders nothing rather than a dangling "Building:" label with no segments. Matches the
old flat-string behavior, which would have produced an empty/meaningless string in the
same case.

## 2. Reuse of `pathSegmentDisplay()`

```tsx
<span>{pathSegmentDisplay(seg)}</span>
```
Correct. Each segment is rendered through the existing `pathSegmentDisplay()` helper
(lines ~16-19), which already handles both the plain-string segment case (`return seg`)
and the multi-select segment case (`"[" + seg.values.join(" + ") + "]"`). No segment-label
logic was reimplemented inside `PathBreadcrumb`. This is the right call — it guarantees
the breadcrumb text stays in lockstep with `pathDisplayString()` (used for task titles in
`dispatchInstruction` and for the queue `display` field), so a future change to segment
formatting can't drift between the visible crumb and the dispatched task title.

## 3. Chevron separators only between segments

```tsx
{path.map((seg, i) => (
  <span key={i} className="inline-flex items-center gap-0.5">
    {i > 0 && <span className="opacity-50 text-[9px]">›</span>}
    <span>{pathSegmentDisplay(seg)}</span>
  </span>
))}
```
Correct. The `›` chevron is gated on `i > 0`, so it appears *before* every segment except
the first — i.e. only *between* segments. No leading chevron, no trailing chevron, no
double chevrons. For a single-segment path (the common preseeded case, e.g. `[modeKey]`)
no chevron renders at all, which is the desired behavior.

## 4. "Building:" label gating

```tsx
{!chainComplete && <span className="opacity-70">Building:</span>}
```
Correct. The label only renders while the chain is incomplete. Once `chainComplete`
flips true (leaf reached / no further children), the label disappears and only the
emerald-colored resolved path remains. This matches the old flat-string version's
conditional prefix behavior as described in the change brief.

## 5. Color classes

```tsx
const colorClass = chainComplete ? "text-emerald-700" : "text-ct-muted";
```
Correct and consistent with the rest of the component's completion palette: the
`ChainRows` leaf-selected button uses `bg-emerald-700 ... text-white` for deterministic
leaves, and the engine-inputs panel uses `border-emerald-200 bg-emerald-50/60` for the
completed-leaf state. `text-emerald-700` for the resolved breadcrumb and `text-ct-muted`
for the in-progress breadcrumb match the old flat-string version's classes per the brief.

## 6. Bugs / key props / accessibility

- **`key={i}` (array index):** Generally an anti-pattern, but acceptable *here*. The
  `selectedPath` array is only ever mutated by prefix-preserving operations
  (`prev.slice(0, depth)` then append, or `[...prev.slice(0, depth), key]` /
  `{ multi, values }`). Segments are never reordered or inserted in the middle; a
  segment at index `i` always represents the same depth. Positional identity therefore
  equals content identity, so index keys cannot cause the stale-state bugs index keys
  are usually warned about. No change required, though a `key={\`${i}-${pathSegmentDisplay(seg)}\`}`
  would be strictly more defensive. **Non-blocking.**

- **Decorative chevron has no `aria-hidden`:** The `›` is purely decorative (the
  segment labels themselves carry the meaning), but it is exposed to assistive tech as
  a literal "›" character with no semantic role. For a tiny inline status indicator in
  a composer (not a site-nav breadcrumb) this is low-impact, but adding
  `aria-hidden="true"` to the chevron `<span>` would be the clean fix. **Non-blocking nit.**

- **Not a `<nav>`/`<ol>` breadcrumb:** This is a *status indicator* ("here is the path
  you are building"), not navigational breadcrumbs, so the ARIA `nav`/`breadcrumb` role
  pattern does not apply. No issue.

- **No injection / XSS surface:** All rendered text flows through `pathSegmentDisplay`,
  which only ever returns (a) a raw `seg` string that originates from capability-tree
  `key`/`values` (server-controlled, not user free text) or (b) a joined
  `"[" + values.join(" + ") + "]"`. React escapes all of this by default. No
  `dangerouslySetInnerHTML`, no `href`/`javascript:` construction, no event-handler
  attribute injection. **Clean from an OWASP/XSS standpoint.**

- **No new routes / no auth surface:** This change is purely presentational inside an
  existing client component. It touches no API route, no `fetch`, no auth/RBAC path.
  The `requireAuth()`/RBAC audit scope does not apply to this diff. (The surrounding
  `dispatchInstruction` POSTs to `/api/tasks` etc. are unchanged pre-existing code and
  out of scope for this wave.)

## 7. Call site

```tsx
<PathBreadcrumb path={selectedPath} chainComplete={chainComplete} />
```
Single call site, in the "Select the task you want me to do." header row, rendered only
when `isChainMode && !isThreadOpen`. Both props are passed correctly:
`selectedPath` is the live chain state, `chainComplete` is the derived completion flag.
No prop drift, no stale closure — both come from the component scope on each render.

---

## Overall verdict: **APPROVE WITH NOTES**

The extraction is faithful to the old flat-string behavior on every checked axis
(empty-path null, `pathSegmentDisplay` reuse, between-only chevrons, `!chainComplete`
"Building:" gating, emerald/muted color classes). No bugs, no security/injection
surface, no auth-scope changes. The only notes are cosmetic a11y nits (add
`aria-hidden` to the decorative chevron; optionally strengthen the `key`) — neither
blocks merge.
