# PROGRESS -- task-20260809-012652-ocid-020--fix-real-remaining-gtm-categor

Governing chain: OCID-020 (UMR-20260802-165606-4413), UMR-20260806-124812-93f8 /
UMR-20260806-142729-ed21 (category 17), UMR-20260806-133845-32eb (category 23).
This task's own UMR: UMR-20260809-011903-335e.

## Completed
- [x] Read ai-os/boss/ACTIVE-CLAIMS.yaml (this task's own worktree copy) -- no
      conflicting active claim found for category 17/23 or this task id; the
      one 2026-08-06 category-23 claim (H2/H4/H9/H10) is >4h stale and its
      work already merged (PR #987).
- [x] Category 17 (browser compatibility) re-evaluated fresh, as instructed:
  - [x] Confirmed real, live state: chromium + firefox load the real page
        (`https://projexa-ai.com/login`); webkit does not (2/3 engines).
  - [x] Root-caused webkit's failure precisely at the source level (not
        inference): read playwright-core's own bundled
        `dependencies.ts`/`registry.ts` (via coreBundle.js) and confirmed
        webkit's `dlOpenLibraries` check (`libGLESv2.so.2`, `libx264.so`) is
        validated via `/sbin/ldconfig -p` (absolute path, system-wide
        `/etc/ld.so.cache`, no `LD_LIBRARY_PATH` override) -- fundamentally
        different from the `ldd`-based check used for directly-linked deps
        (e.g. `libwoff1`, which a prior session in this same UMR *did*
        successfully vendor+resolve this way).
  - [x] Confirmed live: `/sbin/ldconfig -p | grep -iE "libGLESv2|libx264"` ->
        zero matches; `dpkg -l libgles2 gstreamer1.0-libav` -> neither
        installed (candidates exist in the apt mirror); `sudo -n true` ->
        "a password is required" (root genuinely unavailable this session).
  - [x] Conclusion: genuine, exact, root-only blocker. No non-root vendoring
        strategy can satisfy this check regardless of effort spent, because
        the check never dlopens/ldd's the vendored files -- it only reads
        the static system cache. Exact real fix: `sudo apt-get install
        libgles2 gstreamer1.0-libav`.
  - [x] Updated `/opt/veridian/scripts/gtm_check_browser_compatibility.py`'s
        docstring with this precise, source-cited root cause (superseding a
        prior version's less precise "ffmpeg dependency tree too large"
        framing -- same correct bottom-line judgment, better evidence) and
        corrected the "blocked" framing to "fail" (all 3 engine binaries are
        now genuinely present and tested, so absence-based `blocked` no
        longer applies -- 2/3 pass is a real, evidenced `fail`).
  - [x] Re-ran the real check script; result recorded live via
        `gtm_write_category_result.py`: category_index=17, result=fail,
        passed=0 (unchanged from before -- correctly NOT marked passed=1,
        since 3/3 genuinely does not pass and root is genuinely unavailable).
  - [x] Committed + pushed directly to `veridian-scripts` main (own repo,
        no branch protection, matches this repo's own established direct
        docs-commit precedent) -- commit b9acbc4.
- [x] Category 23 (UX audit) -- read current live evidence in full
      (`gtm_certification_categories` row 23, `checked_at`
      2026-08-08T21:37:48Z): 4 real severity-3 heuristic failures across 5
      pre-auth pages (H2 Match w/ real world, H4 Consistency & standards,
      H6 Recognition rather than recall, H10 Help & documentation).
  - [x] H6 (severity 3, clearest single mechanical violation): `/contact`
        form's 4 fields (`ContactUsForm.tsx`, shared with `/join-us`) render
        `<label>` text with **no `htmlFor`/`id` pairing** -- purely visual,
        no real accessible-name association, so it disappears from
        assistive tech exactly as the audit describes. Real, safe, scoped
        fix applied: `id`+`htmlFor` on every field, plus `autoComplete`
        values matching `/login`/`/signup`'s own already-established
        convention (name/email/tel) -- closes H6's primary finding and
        contributes to H4's third sub-finding and H7's autofill-consistency
        sub-finding. Zero new TS errors introduced (`bunx tsc --noEmit`
        diffed clean against pre-change baseline, 152 pre-existing errors
        unchanged both sides).
  - [x] H2 (title/brand switches to "PROJEXA" only on `/login`, nowhere
        else in the funnel), H4's primary finding (`/pricing` vs `/contact`
        showing an entirely different brand name *and* nav structure), and
        H10 (`/help` redirects unauthenticated visitors to `/login` instead
        of showing pre-auth content) were investigated and NOT force-fixed:
        - H2/H4-brand: `/login`'s PROJEXA resolution
          (`resolvePreAuthBrandByHost`) is a deliberate, Owner-directed,
          page-scoped Stage-1 rollout (OCID-038, quoted Owner decision in
          `org-branding-service.ts`). Extending it to `/signup`/`/pricing`/
          `/contact` would mean rewriting hardcoded brand strings across
          several files' real marketing copy (footer, FAQ content
          referencing "VERIDIAN AI" by name, CTA text) -- a content/design
          scope beyond a mechanical swap, and `/contact`'s nav
          ("Research/Products/On cost/Join Us") vs the rest of the funnel's
          nav ("Log in/Get Started") reflects what looks like a genuinely
          different, never-unified marketing template, not a bug to
          mechanically patch.
        - H10: `/help` lives under `src/app/(app)/help/page.tsx` -- inside
          the auth-gated route group by design (same gate every other
          authenticated page uses). Making it public pre-auth is a real
          access-control/product decision (what content is safe to expose
          unauthenticated, and whether a separate public help surface
          should exist), not a mechanical fix.
  - [x] Real re-run not yet possible in this session: the live audit probes
        `https://projexa-ai.com` (production), so the H6 fix only reflects
        in fresh evidence once merged + deployed (see Remaining).

## Remaining
- [ ] Commit `ContactUsForm.tsx`, push, open PR, let CI run, merge (no
      blocking review configured -- `required_approving_review_count: 0`).
- [ ] Once merged/deployed, re-run the real category-23 UX audit check
      script against production and confirm H6 no longer fails; update
      `gtm_certification_categories` row 23 with the fresh real evidence.
      passed=1 only if the AI-assisted pass finds zero severity>=3 findings
      across all 10 heuristics for real -- H2/H4-brand/H10 will very likely
      still fail (honest, product-decision blockers, not mechanical), so
      category 23 will most likely stay a real, evidenced fail this cycle,
      not pass.
- [ ] Call `agent_work_briefing.py record-completion` for
      UMR-20260809-011903-335e with the real summary once the PR is up.
- [ ] Category 17 stays a real `fail` (2/3 engines) -- no further action
      possible without root; already reported honestly, not deferred.
