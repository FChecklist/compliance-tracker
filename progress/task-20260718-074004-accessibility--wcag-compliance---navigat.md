# PROGRESS -- task-20260718-074004-accessibility--wcag-compliance---navigat
Task: Accessibility (WCAG Compliance): Navigation & Input Accessibility

No prompt.txt existed in the task dir/workspace at any invocation (checked
again at invocation 14) -- only the title in task.yaml. 13 prior invocations
never touched real code: mostly OpenRouter-balance credit_accountant
pre-flight rejections (2026-07-20, resolved 2026-08-15 per the resume-task
note in task.yaml) or blank in_progress/failed checkpoints. Scoped the work
myself from the title, against the real codebase.

## Completed
- [x] Read governance docs pointers (AGENTS.md, CLAUDE.md) and
      ai-os/boss/ACTIVE-CLAIMS.yaml; registered this task's own claim there
      (no overlapping in-flight claim found for this file area).
- [x] Audited the persistent authenticated-app chrome (AppShell.tsx,
      AppSidebar.tsx, AppTopbar.tsx) for nav/input accessibility gaps --
      confirmed zero `aria-*`/`role=` usage anywhere in AppSidebar.tsx,
      only one pre-existing `aria-label` in AppTopbar.tsx.
- [x] Checked src/components/ui/form.tsx (shadcn Form/FormControl) --
      already wires `aria-invalid`/`aria-describedby`/`htmlFor` correctly
      via react-hook-form's FormField/useFormField. Not a real gap; left
      untouched.
- [x] AppShell.tsx: added a "Skip to main content" link (WCAG 2.4.1 Bypass
      Blocks) -- sr-only until focused, jumps to `#main-content`; added
      `id="main-content"` + `tabIndex={-1}` to both `<main>` branches
      (veriChatV2 and legacy).
- [x] AppSidebar.tsx: split the sidebar into two labelled `<nav>` landmarks
      (`aria-label` "Quick navigation" / "Modules", via next-intl --
      added `Nav.top.quickNavLabel`/`modulesNavLabel` keys to both
      messages/en.json and messages/hi.json); added `aria-current="page"`
      to every nav Link (quick-nav + section items); added
      `aria-label="Open navigation menu"` to the mobile hamburger trigger.
- [x] AppTopbar.tsx: added `aria-label` to the notification bell (includes
      live unread count, e.g. "Notifications, 3 unread"), the
      sidebar-collapse toggle, and the user-avatar dropdown trigger
      (`aria-hidden` on its decorative icon/avatar); marked the unread-dot
      indicator `aria-hidden` since it's redundant with the label text.
- [x] `bun install` (node_modules was missing), `bunx tsc --noEmit` on the
      touched files (clean -- full-project run OOMs on this box regardless
      of these changes, a pre-existing resource constraint, not something
      this diff caused), `bunx eslint` on the touched files (clean),
      JSON-parse-validated both messages/*.json.
- [x] Found PROGRESS.md (shared file) had already been silently overwritten
      with this task's stub content before this invocation started,
      destroying a different task's (cost-estimate-5org-50user) real
      progress log -- restored it via `git checkout -- PROGRESS.md` per
      this task's own protocol ("do not recreate a shared PROGRESS.md").
      This progress/*.md file is the real, correct record for this task.

## Remaining
- [ ] None known. Scope was deliberately kept to the persistent nav chrome
      (the concrete, title-named surface) rather than a full app-wide WCAG
      audit, which would be a much larger, separately-scoped effort (icon
      buttons scattered across ~80 feature pages, color-contrast pass,
      focus-trap audit for every modal/Sheet/Dialog instance, etc.) -- not
      claiming those as done.

## Rebase note (2026-08-31)
Original PR #1224 (Aug-15) went stale as main advanced; rebased onto current
main in a fresh worktree and re-opened as a new PR. Real, substantial
drift found and hand-resolved, not a trivial auto-merge:
- AppSidebar.tsx has been fully migrated (2026-07-19 veridian-ui-kit wave,
  merged after this PR's branch was cut) to delegate nav rendering to the
  external `@fchecklist/veridian-ui-kit` package's shared `<AppSidebar>`
  component (`buildSharedSections()` + one shared `<nav>`, no separate
  landmarks). This PR's original two-`<nav>`-landmark / per-Link
  `aria-current` work no longer has a target to apply to in this repo --
  kept main's real, later, already-shipped architecture rather than
  reverting it. The mobile hamburger `aria-label="Open navigation menu"`
  carried forward unchanged (main already had it). The `quickNavLabel`/
  `modulesNavLabel` i18n keys were dropped from messages/en.json and
  messages/hi.json since nothing consumes them anymore.
- AppTopbar.tsx was also rewritten by the same migration (now composes the
  shared `<AppHeader>`). Re-applied this PR's real accessibility intent
  onto the new structure: `aria-label` on the notification bell (with live
  unread count) and `aria-hidden` on its dot indicator, `aria-label` on the
  user-menu trigger, `aria-hidden` on the avatar and chevron -- all still
  this repo's own markup. The sidebar-collapse toggle button moved into the
  shared `<AppHeader>` component itself (external repo) and still has no
  `aria-label` there (only `title`) -- a real, same-class gap, but out of
  this PR's scope to fix without patching that separate package.
- AppShell.tsx: kept the skip-link + `#main-content` target intent, but
  moved the skip-link to render once (outside the `veriChatV2Enabled`
  ternary) instead of duplicated per-branch, and pointed the id/tabIndex at
  the real per-branch content wrapper -- the surviving `<main>` in the
  legacy branch, and the content `<div>` passed into `<AppShellFrame>` in
  the veriChatV2Enabled branch (that branch's own `<main>` tag, in the
  external package, is actually the assistant/chat column, not routed page
  content -- mislabeled in that package, out of scope to fix here).
- ai-os/boss/ACTIVE-CLAIMS.yaml: real conflict (both sides appended a
  different entry at the same point) -- kept both as sibling list entries,
  updated this task's own `pr:` field since it's being merged now via a new
  PR superseding #1224.
