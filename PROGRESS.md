# PROGRESS -- task-20260718-074005-accessibility--wcag-compliance---visual

PR: https://github.com/FChecklist/compliance-tracker/pull/1226 (open, CI running)

VERIDIAN Review Framework gap-closure: Accessibility (WCAG Compliance) /
Visual Accessibility. 2 findings, closed together in one PR since both are
UI-accessibility remediation touching overlapping component files.

## Completed

- [x] Re-verified both findings against the live codebase before writing
      any code (per this task's own instruction -- the evaluation could be
      stale). Both were still real and unresolved:
      - Saffron brand accent (`--color-ct-saffron` / `#F5820A`, imported
        from `@fchecklist/veridian-ui-kit`) computes to ~2.6:1 contrast
        against this app's light backgrounds (white/cream/card) --- well
        under WCAG 2.1 AA's 4.5:1 minimum for normal text. Confirmed via
        manual relative-luminance calculation, not assumed.
      - 48 of 57 icon-only `size="icon"` buttons across the app had no
        accessible name (no `aria-label`, no `title`, no visually-hidden
        text) -- confirmed via a scripted sweep, not a guess.

- [x] **Finding 1 (color contrast).** Did NOT touch `--color-ct-saffron`
      itself (it's the shared cross-product brand token re-exported from
      `@fchecklist/veridian-ui-kit`, and it's still correct for non-text
      uses -- borders, tinted chip backgrounds, and saffron-on-navy text,
      which already clears ~5.5:1). Instead, per the recommended approach:
      added a new local `--color-ct-saffron-text: #B45309` token in
      `src/app/globals.css` (verified >=4.5:1 against `#FFFFFF`,
      `#FFFDF9`, and the `--color-ct-pend-under30-bg` tint), then swept
      every real `text-ct-saffron` / `hover:text-ct-saffron` /
      `text-ct-saffron/80` usage across `src/**/*.tsx` (240 occurrences
      across 101 files -- the real count; a naive `grep -r` under-reports
      due to a known ~51-result cap in this environment, so `git grep`
      was used instead) to `text-ct-saffron-text`. Also fixed
      `--color-ct-pend-under30-text`, which used the same raw
      `#F5820A` as text on a light chip background -- same failure
      pattern, same fix.
      Verified zero same-line collisions between `text-ct-saffron` and any
      navy/dark background class anywhere in the codebase before doing
      the sweep, so no already-compliant saffron-on-navy usage was
      accidentally darkened into a *new* contrast failure.
      Explicitly out of scope (not part of either finding, and would be a
      much larger, separately-scoped redesign): the `bg-ct-saffron` /
      shadcn `default` Button variant's white-on-saffron text, which has
      its own, separate contrast question -- not the "Saffron accent
      color used as text on light background" pattern this gap named.

- [x] **Finding 2 (icon/alt-text accessibility), CI gate first:** added
      `eslint-plugin-jsx-a11y` as an explicit devDependency (it was
      already an undeclared transitive dependency of `eslint-config-next`)
      and wired its full `recommended` rule set into `eslint.config.mjs`
      -- `eslint-config-next/core-web-vitals` only enables 6 jsx-a11y
      rules at `warn`; this adds the other ~25 (anchor-is-valid,
      label-has-associated-control, click-events-have-key-events,
      html-has-lang, heading-has-content, etc.) as a real `error`-level
      CI gate.
      Turning the full set to `error` surfaced ~35 pre-existing violations
      of 6 rules across ~15 files this task's findings never named
      (custom div-based dropdown/palette widgets missing keyboard
      handlers, `<label>`s not wired to their control's id). Fixing all of
      those is a separately-scoped keyboard-accessibility audit, not a
      drive-by in this PR -- downgraded exactly those 6 rule keys to
      `warn` (visible in `bun run lint`, doesn't fail CI) with a
      documented rationale in `eslint.config.mjs`, matching this file's
      own existing precedent for `react-hooks/set-state-in-effect`. Fixed
      the 3 genuinely cheap/real ones directly instead: `global-error.tsx`
      was missing `lang="en"` on its standalone `<html>` (root
      `layout.tsx` already had it); 2 `anchor-has-content` false positives
      (`MessageContent.tsx`'s react-markdown link renderer,
      `ui/pagination.tsx`'s `PaginationLink`) got a targeted
      `eslint-disable-next-line` with rationale, since both pass their
      content through a `...props` spread the rule can't statically see.
      `jsx-a11y/no-autofocus` set to `off` (not `warn`) -- it's opinionated
      rather than a hard WCAG failure (SC 2.4.3 permits deliberate initial
      focus), and the 3 existing uses (MFA code input, inline-edit
      autofocus) are legitimate UX.

- [x] **Finding 2, one-time sweep:** added `aria-label` to all 46 of the
      48 icon-only buttons the sweep found missing one, across 26 files
      (`app/(app)/**` pages + `components/**`), inferring the label from
      the icon + click handler (e.g. `Trash2` -> "Remove X",
      `ChevronLeft`/`ChevronRight` pagination -> "Previous/Next page",
      `X` -> "Close"/"Dismiss X", numbered pagination buttons also got
      `aria-current="page"`). The other 2 were false positives on
      manual review, left untouched: `components/ui/calendar.tsx`'s day
      button has the day number as real visible text content (not
      icon-only, just square-styled), and `components/ui/sidebar.tsx`'s
      trigger already has a `sr-only` "Toggle Sidebar" span.
      Deliberately scoped to the `size="icon"` shadcn convention (the
      dominant icon-only-button pattern in this codebase, 57 of them) --
      not a claim that literally every icon anywhere in the app now has
      an aria-label; a residual few outside that convention may exist and
      are left for the ongoing jsx-a11y CI gate / a future pass to catch
      incrementally, since jsx-a11y itself has no rule that can catch
      that class of gap automatically (accessible-name computation for
      arbitrary icon children isn't statically decidable).

- [x] Verification: `bun run lint` -- 0 errors, 35 warnings (all
      pre-existing-scope `jsx-a11y` downgrades noted above, or the 3
      pre-existing unrelated warnings that were already there before this
      PR). `bunx tsc --noEmit` -- 0 errors (needed
      `NODE_OPTIONS=--max-old-space-size=6144` in this sandbox; unrelated
      to this change, the whole-repo type-check is just large). `bun test`
      -- 2549 pass / 0 fail / 5084 expect() calls across 224 files, full
      suite, no regressions (this PR touches zero `src/lib/services/*`
      logic, only className/aria-label JSX attributes + eslint config +
      one CSS token file, so this was a confirmation run, not an expected
      source of new failures).
      Confirmed no edits to `src/lib/services/permission-service.ts` or
      any other in-flight worker's declared scope.

## Remaining

- [ ] None for this task's 2 named findings -- both closed. Noted above,
      as separately-scoped follow-ups (not silently dropped):
      - The `bg-ct-saffron` / default-Button white-on-saffron text
        contrast question (a different pattern than either named finding).
      - The ~35 warn-level jsx-a11y findings (keyboard-interactivity on
        custom widgets, label/control association) the new CI gate now
        surfaces but doesn't block on.
