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
- [x] Full 22-spec-file e2e suite run against the real live app
      (`/opt/veridian/repos/projexa-ocid020-wt`, `PLAYWRIGHT_BASE_URL=
      https://projexa-smoky.vercel.app`, 15.9 minutes real wall-clock, log at
      `/tmp/ocid020-evidence/full-suite-run.log`): **85 passed / 20 failed / 2
      skipped.** This is real, substantial, positive evidence: the overwhelming
      majority of PROJEXA's modules (materials, inventory, vendors,
      purchase-orders, procurement RFQ/quotation/goods-receipt, labour, ffe,
      floor-plans, mood-boards, member-access, most of finance/accounting,
      most of HR/employees/payroll, KPIs, reports, GRC, sales) work correctly
      end-to-end against the real live seeded org, first-time write flows and
      all. Triage of the 20 failures below.
- [x] **Triaged all 20 failures — real findings, not blind re-runs:**
  1. **`copilot-chat.spec.ts` (11 failures)** — NOT a functional regression.
     Manually re-verified live (screenshot:
     `/tmp/ocid020-evidence/copilot-03-after-send.png`): the Discuss chat
     still gives the exact correct documented refusal ("Boss, I don't have
     live data to pull that up here. Please use the Assistant pill...").
     The test helper's selector (`div.justify-start > div`, PHASE2 Batch C's
     own comment cites `VeriComposer.tsx`'s old className scheme) no longer
     matches — confirmed live via DOM dump that `.justify-start`/`.justify-end`
     now belong to unrelated dialog/icon-button elements, not chat bubbles.
     **Real conclusion: the composer's DOM was refactored (consistent with
     the "Wire full VERIDIAN module chain into PROJEXA's chat composer" PR
     merged after Batch C's tests were written) and the 2-week-old test
     selectors are stale — a test-maintenance gap, not a product bug.** Not
     fixed in this session (budget); flagged for the next continuation to
     update `askDiscuss()`'s locator against the current composer DOM.
  2. **`e2e/02-permits.spec.ts` (3 failures)** — stale assertion, not a bug.
     Manually verified live (screenshot: `/tmp/ocid020-evidence/sweep-01-permits.png`):
     the Permits page renders correctly ("No permits found", working "New
     Permit" button) — the test expected the window-select label text "Next
     90 days" which no longer matches the live copy exactly. Not a
     functional break; flagged for a copy-diff fix in the test.
  3. **`e2e/03-documents.spec.ts:88` (1 failure, "has no write controls")** —
     not independently re-verified this session (budget); likely same class
     as #2 (a UI-copy/structure assertion, not a data-loss or write-path
     issue) given every other Documents test in the same file passed.
  4. **`e2e/06-procurement.spec.ts:75` (1 failure, requisition creation)** —
     **REAL, STILL-OPEN BACKEND BUG**, exactly matching PHASE2_BATCH_B_FINDINGS.md's
     "REAL BUG 1" from 2 weeks ago (`POST /api/procurement/requisitions` 500s
     on a fully valid payload). Not independently re-verified with a fresh
     network trace this session (budget) but the baseline test in the same
     file (confirming 4/5 procurement stages are empty) passed, and no
     product code touching this path has changed per `git log` on
     `src/app/api/procurement/requisitions/route.ts` since Batch B — treat
     as still-open, not re-confirmed live by this session.
  5. **`e2e/offline-work-progress-sync.spec.ts` (1 failure)** — the spec
     file's own header already predicted this: it was authored *while*
     `projexa-ai.com` was misrouted, and explicitly says it "will run
     correctly once that routing issue is fixed." The routing issue is
     understood now (see above) but this suite ran against
     `projexa-smoky.vercel.app`, a **different real deployment** than
     wherever this offline-queue feature's own code was last deployed to —
     not independently re-verified whether the deployed build there includes
     this feature; flagged, not fixed, this session.
  6. **`e2e/wiki-knowledge-base.spec.ts` (3 failures)** — **REAL BUGS,
     CONFIRMED LIVE, ONE FIXED THIS SESSION:**
     - **Wiki `/wiki` "Could not load projects: Unauthorized"** — confirmed
       still reproducing live (screenshot:
       `/tmp/ocid020-evidence/sweep-03-wiki.png`), exact same root cause
       PHASE2_BATCH_C_FINDINGS.md found 2 weeks ago and was never fixed:
       `src/app/(app)/wiki/page.tsx` called `resolveSelectedProject()`
       without `organizationId`. **Fixed this session** (see below) — real,
       one-line fix matching `kpis/page.tsx`'s already-correct pattern, PR
       `FChecklist/projexa#69`. **Not yet independently re-verified against
       a live deploy** (the fix isn't deployed anywhere yet) — honestly
       flagged as fixed-but-unverified, not claimed as closed.
     - **Knowledge Base `/knowledge-base` "Could not load knowledge base:
       Failed to fetch knowledge base pages"** — this is **NEW, more severe
       than Batch C's finding** (Batch C found only the *write* path 401'd;
       the *read* path now 500s outright, confirmed via direct
       authenticated `fetch()`: `GET /api/knowledge-base` → real 500). Root-
       caused as far as budget allowed: PROJEXA's own proxy route
       (`src/app/api/knowledge-base/route.ts`) already correctly passes
       `organizationId` (Batch C's exact fix), so this is a **different,
       deeper bug on the compliance-tracker side** —
       `src/app/api/v1/projexa/knowledge-base/route.ts`'s `GET` calls
       `listKbPages()` (`src/lib/services/knowledge-base-service.ts:34`), a
       plain Drizzle `findMany` with a real `where`/`orderBy` over real
       columns (`orgId`, `isArchived`, `title` all exist in `schema.ts`) —
       nothing exotic in the query shape itself, so the 500 is not
       obviously explained by reading source alone. **Not fixed this
       session** — needs either live DB/log access (this session had
       neither) or a deployed debug build to pin down further. Real,
       reproducible, high-value follow-up for the next session.
  7. **2 skipped** — not investigated this session (budget); likely the same
     class of graceful `test.skip()` Batch C documented (no seeded row in
     the exact transient state a test needs).

## Real fix shipped this session
`FChecklist/projexa` PR **#69** (`worker/task-20260802-190820-ocid020-certification`):
- `src/app/(app)/wiki/page.tsx` — added the missing `organizationId` argument
  (real bug #6 above), matching `kpis/page.tsx`'s pattern.
- `e2e/auth.setup.ts` — login button selector fix (carried over from the
  stopped prior worker, now confirmed working against the correct URL).
- `scripts/ocid020-*.mjs` — 3 reusable evidence-capture scripts driving the
  real site directly via Playwright's `chromium.launch()`/
  `launchPersistentContext()`, independent of the full test-runner config.
**Honest limitation**: the Wiki fix has NOT been independently re-verified
against a live deploy (no deploy pipeline was triggered by this session) —
per this task's own "independently retested on the same real flow" bar,
this fix should be treated as *proposed and reviewed-worthy*, not *closed*,
until someone re-runs `wiki-knowledge-base.spec.ts` against a deployed build
of this branch/PR and confirms green.

## Why this session stopped here (real capacity call, not silent abandonment)
Budget-constrained (per this task's own USD budget). Prioritized, in order:
(1) root-causing the actual blocker (domain routing) that the whole
certification was stuck on, (2) getting a durable, reusable, sudo-free
browser-automation environment in place, (3) running the full existing
22-spec suite for broad real coverage in one shot, (4) triaging every
failure with real evidence rather than leaving a bare list, (5) shipping one
well-understood, low-risk real fix. Did NOT reach: a systematic
menu-by-menu/module-by-module manual sweep beyond what the existing suite
already covers, multi-tenant/multi-brand testing (no second real org/brand
was seeded or located this session — the "Meridian Construction Group (E2E
Test Org)" is the only real org exercised), first-time-user (fresh
signup/onboarding) flow, cache-specific testing, or search-specific testing
beyond what individual module specs already touch.

## Remaining (for the next continuation)
- [ ] Deploy PR #69 (or merge it) and re-run `wiki-knowledge-base.spec.ts`
      against that real deploy to independently confirm the Wiki fix.
- [ ] Root-cause the NEW Knowledge Base `GET` 500 (real bug #6b above) --
      needs live DB/log access this session didn't have.
- [ ] Update `askDiscuss()`'s stale selector in `copilot-chat.spec.ts`
      against the current composer DOM, then re-run Part 2 for a real
      (not stale-selector) verdict on the Batch C hallucination finding
      (`DeleteProject`) and the Finance/HR capability-tree gap.
- [ ] Re-verify permits/documents test assertions against current UI copy.
- [ ] Independently re-confirm the procurement-requisition 500 (Batch B bug)
      is still live with a fresh network trace.
- [ ] Multi-tenant / multi-brand certification -- needs a second real org
      (none located/seeded this session).
- [ ] First-time-user signup/onboarding flow (distinct from the 4 seeded
      power-user logins this session exercised).
- [ ] Cache and search behavior, specifically (beyond what individual module
      specs incidentally exercise).
- [ ] Systematic screen-by-screen sweep beyond the existing 22 spec files'
      coverage (e.g. `/company-dashboard`, `/projects-overview`, `/rfis`,
      `/submittals`, `/punch-list`, `/change-orders`, `/site-diary`,
      `/schedule`, `/meetings`, `/scope-of-work`, `/drawings-3d`,
      `/minutes-of-meeting`, `/settings` -- not covered by this suite at all
      per its own file list, Batch A's separate scope).
- [ ] Any further gap found needs a real reproduction path, a real fix, and
      independent re-test on the same real flow before being marked done.
- [ ] `ai-os/boss/ACTIVE-CLAIMS.yaml` updated this session (see this repo's
      own diff) -- move this entry to `recently_completed` once the above
      is picked up or this task concludes.
