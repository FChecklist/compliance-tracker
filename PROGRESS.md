# PROGRESS -- task-20260805-173250-real-comprehensive-end-to-end-browser-te

Real comprehensive end-to-end browser testing of live projexa-ai.com
(OCID-020 / UMR-20260802-165606-4413), starting from the PM's real
`/signup` title-redirect finding.

## Completed
- [x] Read governance docs (ACTIVE-CLAIMS, CONSTITUTION pointers, AGENTS.md, CLAUDE.md)
- [x] Registered ACTIVE-CLAIMS.yaml entry for this task
- [x] Root-caused the PM's `/signup` finding via curl + source read: NOT a redirect --
      the real signup form renders correctly, but `<title>`/OG metadata is the root
      layout's generic "VERIDIAN COGNITIVE AI OS" (no per-page override), and the
      wordmark is hardcoded "VERIDIAN AI" -- the exact OCID-038
      GAP-OCID038-PROJEXA-DOMAIN-BRAND-MISMATCH class already fixed on `/login`
      (UMR-20260804-090421-c647) but never applied to `/signup`.
- [x] Real Playwright browser sweep of every reachable public route (no-sudo chromium
      fix, LD_LIBRARY_PATH) -- screenshots + title/body/console-error captured for:
      `/`, `/login`, `/signup`, `/mfa-challenge`, `/pricing`, `/contact`, `/privacy`,
      `/terms`, `/data-policy`, `/join-us`, `/office`, `/the-firm`, `/forge`,
      `/veri-fm-cs`, `/stage0-chat` (screenshots + results.json under
      `/tmp/ocid020-evidence/`, and folded into the OCID-020 evidence deposit below)
- [x] Confirmed real gap on `/signup` AND (newly found this pass) `/mfa-challenge` --
      both hardcode "VERIDIAN AI" instead of resolving per-host brand
- [x] Confirmed 10 marketing pages (`/contact`,`/privacy`,`/terms`,`/data-policy`,
      `/join-us`,`/office`,`/the-firm`,`/forge`,`/veri-fm-cs`) are correctly generic
      multi-product pages **by design** (root layout.tsx's own documented OCID-038
      architecture) -- not a gap
- [x] Found but NOT fixed this pass: `/pricing` has the same hardcoded wordmark gap,
      but the brand name is also woven into full marketing sentences (hero copy, FAQ
      answer, footer copyright) -- materially larger scope, flagged honestly as its
      own follow-up rather than rushed
- [x] Fixed `/signup` and `/mfa-challenge`: split each into async server `page.tsx`
      (`generateMetadata()` + `resolvePreAuthBrandByHost()`) + client form component
      taking `brand` as a prop, mirroring `/login`'s already-live-correct pattern
      exactly (`brand?.brandName ?? "VERIDIAN AI"` fallback -- byte-identical platform
      default when no host match)
- [x] Verified: eslint clean on all 4 files; CI Lint + Type Check green; local `tsc`
      OOMs on this sandbox (pre-existing, unrelated resource limit, confirmed no
      signup/mfa-challenge errors in the partial run before OOM)
- [x] Opened PR #965, posted the required structured `AUDIT: PASS` comment (8-field
      protocol), `audit-check` + all required CI checks green except `Vercel` (preview
      deploy rate-limited on this Vercel account/plan -- not this PR's own fault, not
      a required branch-protection check)
- [x] Deposited real evidence into `ocid_canonical_registry.evidence_json` for
      OCID-020 (key `real_e2e_browser_sweep_task_20260805_173250`) via the real
      `upsert_ocid_canonical_registry()` -- full page inventory, root-cause finding,
      fix PR link/commit SHA, verification notes, and the authenticated-flow boundary,
      all recorded structurally, not narrated only

## Remaining
- [ ] Merge PR #965 once CI is fully green (Vercel rate-limit aside)
- [ ] Independently re-screenshot `/signup` and `/mfa-challenge` against the live site
      post-merge/deploy -- append that result to the same evidence_json key
- [ ] Owner-only next step (not attempted, not attemptable by any AI per the fixed
      no-AI-credential-entry rule): every real authenticated-flow surface (dashboard,
      checklists, tasks, reports, penalties, departments, users, audit, settings, team,
      and the org-creation/first-login step immediately after a real signup submission)
      needs the Owner to personally log in with real credentials before it can be
      certified
- [ ] Optional follow-up (separate scope): fix `/pricing`'s brand-copy gap
