# PROGRESS -- task-20260802-190820-resume-real-ocid-020-certification--usin

Resuming real OCID-020 end-user certification of PROJEXA-AI.COM. Cites
`UMR-20260802-165606-4413` throughout (parent directive). `UMR-20260802-173631-ca85`
(ERP Functional Completeness Master Program) implementation stays locked until this
certification is independently verified complete, per that directive's own instruction.

## Completed
- [x] Collision check: `ai-os/boss/ACTIVE-CLAIMS.yaml` shows a prior session
      (`task-20260802-172449`) explicitly stood down mid-session from OCID-020,
      citing collision with `task-20260802-172443` "which already owns this scope".
      No currently-active claim entry for OCID-020 exists in the registry as of this
      session's start (2026-08-02), and this task's own prompt (UMR-20260802-181025-0d4b)
      is itself the authorization to resume -- registering this session's claim now.
- [x] Read prior real state: `/opt/veridian/repos/projexa`'s shared checkout (branch
      `feat/ai-cost-governance-cross-repo-guardrail`, unrelated in-progress work from
      other concurrent tasks) had one uncommitted fix left by the stopped worker:
      `e2e/auth.setup.ts` login-button selector changed from
      `getByRole("button", {name: /log in|sign in/i})` (ambiguous -- also matches
      "Sign in with Google") to `button[type="submit"]`. Confirmed via
      `e2e-results.json` (generated after that fix, timestamped after the fix's mtime)
      that all 4 seeded-user logins STILL failed with the fix applied
      (`TimeoutError` waiting for `**/dashboard` after 20s) -- so the selector was a
      real but insufficient fix; a deeper problem remained.
- [x] **ROOT CAUSE FOUND, LIVE, VERIFIED FRESH (not cached)**: `https://projexa-ai.com`
      does **NOT** serve the PROJEXA application at all right now. `curl -sI` shows
      `age: 0`, `x-vercel-cache: MISS` (fresh origin response, not stale CDN); the
      page title is `VERIDIAN COGNITIVE AI OS — AI Cognitive Research` and body
      contains "One Portal"/"VERIDIAN AI" -- this is **compliance-tracker's** app, not
      PROJEXA's. This is because of a real, Owner-approved, already-documented
      decision: `ai-os/boss/COMPLETED.yaml` id `WAVE-10-REDO` (2026-08-02,
      `UMR-20260802-134939-145d`, direct Owner instruction) re-pointed
      `projexa-ai.com`/`www.projexa-ai.com`'s Vercel domain binding from the
      standalone `projexa` project back onto `veridian-compliance-ai` -- reversing an
      undocumented 2026-07-27 flip the other way. **This is intentional, current,
      correct infra state, not a bug** -- my own pre-existing memory
      (`veridian-projexa-domain-ownership-conflict.md`, written 12:46, i.e. BEFORE
      this 13:49 redo) was stale on this point; corrected as part of this session.
- [x] **However — a real, separate, still-open gap**: host-header/domain-based brand
      routing (making `projexa-ai.com` actually *look and behave* like PROJEXA within
      the merged compliance-tracker deployment) was **explicitly deferred, never
      built**. `ai-os/boss/COMPLETED.yaml`'s own Wave-5-brand entry says this in so
      many words: "Host-header/domain-based brand routing... correctly belongs to
      this same plan's later DNS/Vercel cutover wave, once projexa-ai.com is actually
      aliased to this deployment" -- that wave (WAVE-10-REDO) has now happened, but the
      brand-routing follow-up was never done. Confirmed live: `grep -rln
      "projexa-ai.com" src/` and `grep -n "host\|hostname" src/middleware.ts` both
      return nothing -- **zero host-based tenant/brand routing exists anywhere in
      compliance-tracker**. Net effect: visiting `projexa-ai.com` today shows
      compliance-tracker's generic default-branded login/shell to real end users who
      expect PROJEXA -- a real, live, user-facing product gap.
- [x] **Real PROJEXA app confirmed still live and testable** at its actual current
      Vercel-assigned domain: `https://projexa-smoky.vercel.app` (the standalone
      `projexa` Vercel project's own alias, per `WAVE-10-REDO`'s own verification:
      "projexa's real remaining domains are now only ['projexa-smoky.vercel.app']").
      `curl https://projexa-smoky.vercel.app/login` returns real PROJEXA branding
      (`<title>PROJEXA — Construction Intelligence AI OS</title>`), matching this
      repo's own `src/app/login/page.tsx` source -- confirmed this is genuinely the
      right app to certify.
- [x] Set up an isolated git worktree for this task's own use,
      `/opt/veridian/repos/projexa-ocid020-wt` (branch
      `worker/task-20260802-190820-ocid020-certification`, off fresh `origin/main`) --
      the shared checkout at `/opt/veridian/repos/projexa` is mid-flight on an
      unrelated branch/task and was left untouched, per this codebase's own
      shared-worktree-risk precedent.

## Decision on how to proceed (real capacity call, not a silent workaround)
The literal OCID-020 ask ("test projexa-ai.com's own authenticated screens") cannot
be fulfilled as literally worded: that URL does not run PROJEXA's code right now, by
real Owner-approved design, and there is no brand-routing layer to make it do so.
Continuing to certify the REAL PROJEXA product end-to-end against its real current
live URL (`https://projexa-smoky.vercel.app`, same codebase, same Supabase project,
same seeded E2E test org) -- this is the only way to produce real, meaningful
end-user certification evidence for PROJEXA as a product, which is the actual intent
behind OCID-020/UMR-20260802-165606-4413. The `projexa-ai.com` brand-routing gap is
flagged as its own, separate, real finding above (not silently dropped) and needs a
PM/Owner decision on priority -- not something this task should unilaterally build as
a side quest, and not something fixable by touching DNS (that's an application-layer
gap, not infra).

## Environment setup (real, working, no sudo, no `playwright install-deps`)
The existing `~/.cache/ms-playwright/chromium-1232` binary needs 26 real shared
libraries (`libnspr4`, `libnss3`, `libatk-1.0`, `libcairo2`, `libpango-1.0-0`, etc --
full list in git history of this file) that are genuinely absent from this box (not
a stale-cache illusion -- confirmed via `ldd`, a filesystem-wide `find` for
`libnss3.so*` found zero copies anywhere). Resolved WITHOUT sudo and WITHOUT
`playwright install-deps` (which would need root to `apt-get install`): used
`apt-get download <pkg>` (does not require root, only fetches the .deb) +
`dpkg-deb -x <deb> <dir>` (extracts files without installing/touching system
package state) for all 26 packages (including 2nd-order transitive deps found via
repeated `ldd` passes), copied the resulting `.so` files to
`/home/rajat/.local/chrome-system-libs/` (durable, outside `/tmp`), and set
`LD_LIBRARY_PATH=/home/rajat/.local/chrome-system-libs` before launching chromium.
Verified: `ldd chrome` now reports zero "not found" entries; both a standalone
`chromium.launchPersistentContext()` script and the real `npx playwright test`
runner launch and drive the real browser successfully. Zero system-wide changes --
nothing was `dpkg -i`'d or `apt install`'d, only extracted to a user-owned
directory. This is now a one-time, reusable setup for any future session on this box.

## Completed (continued)
- [x] Re-ran `e2e/auth.setup.ts` (with the button-selector fix) against the REAL
      PROJEXA URL (`PLAYWRIGHT_BASE_URL=https://projexa-smoky.vercel.app`, not the
      old default `projexa-ai.com`) -- **all 4 seeded users (CEO, Finance, HR, Site
      Supervisor) authenticated successfully in 22.7s total, zero failures.** This
      confirms the earlier login-timeout failures were caused ENTIRELY by testing
      against the wrong domain (compliance-tracker's shell has no matching
      Supabase-Auth users, obviously), not any real PROJEXA login bug and not any
      browser/dependency issue.
- [ ] Full 22-spec-file e2e suite launched against the real live app (all modules:
      materials, permits, documents, vendors, inventory, procurement,
      purchase-orders, labour, ffe, floor-plans, mood-boards, member-access,
      copilot-chat, finance x2, grc, hr, kpis-reports, offline-sync,
      pivot-chart-reports, sales, wiki) -- running now, results to follow in next
      update (real, long-running, against the real live site -- not truncated for
      speed).

## Remaining
- [ ] Real login flow certification (all 4 roles: CEO/owner, Finance, HR, Site
      Supervisor) -- first-time and power-user paths.
- [ ] Workspace / multi-tenant / multi-brand certification.
- [ ] Every menu, module, function, screen -- systematic sweep.
- [ ] Prompt flow / VERI Chat / AI assistant, real browser<->server round trip.
- [ ] Reports, cache, search.
- [ ] ERP workflows, real business scenarios (first-time + power user).
- [ ] Any gap found gets a real reproduction path, a real fix, and independent
      re-test on the same real flow before being marked done.
- [ ] Update `ai-os/boss/ACTIVE-CLAIMS.yaml` and the canonical
      `ai-os/IMPLEMENTATION_MATRIX_2026-08-02.md` with this session's findings.
- [ ] Commit + push incrementally, not only at the end.
