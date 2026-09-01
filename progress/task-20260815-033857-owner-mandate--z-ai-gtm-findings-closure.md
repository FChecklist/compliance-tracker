# Owner mandate: Z.ai GTM findings closure (governing UMR-20260806-101802-a350)

Separate, additional exercise to OCID-020's 25-category run. 139 real enumerated
points total (11 CB, 20 HP, 20 MP, 10 OBS, 78 individually-verdicted sub-checks).
Multi-cycle program by design — this file tracks real, incremental progress, not a
single-pass close.

## State on arrival (per Rule 12 index-first check, before any fresh search)

- `/opt/veridian/ai-os/memory/zai-gtm-findings/Part1..8_*.txt` — the 8 real files,
  already landed (dated 2026-08-14).
- `/opt/veridian/ai-os/memory/ZAI_BLACKBOX_AUDIT_MERGED.md` — merged single file,
  already done by a prior cycle. **Step 1 of the SPEC: already complete, not redone.**
- `/opt/veridian/ai-os/memory/ZAI_BLACKBOX_AUDIT_POINTS_MANIFEST.json` (139 points)
  + `..._MANIFEST_EXCLUDED_NON_POINTS.json` — enumeration, already done by a prior
  cycle. **Step 2 of the SPEC: already complete, not redone.**
- 10 child UMRs already minted (`zai-gtm-tranche1-p8-cb-01..10`, parented to owner-task
  UMR-20260806-144454-d00c, 2026-08-06). All 10 had only completed the VERIFY
  sub-step (evidence_json holds `reproduce_verdict` only — no fix/audit/retest/
  certify on any of them). `p8-cb-01` itself was still `queued`, never verified.

## Completed this cycle

- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml`, no conflicting active claim found; registered
      this session's own claim there.
- [x] Confirmed inventory (steps 1+2) already real and complete — did not redo.
- [x] Independently re-verified, live against `https://projexa-ai.com`, every P8-CB
      point the prior tranche1 cycle had touched (not trusted unchecked):
  - **P8-CB-04** (no rate limiting on `/api/auth/passcode-login`) — prior tranche1
    verdict (`REPRODUCES`) was **WRONG**. Live: 7 consecutive POSTs → `401 401 401 401
    401 429 429` (real 429 after 5 fails). Code: `src/lib/passcode-login-service.ts`
    (committed 2026-07-24, PR #552, predates the 2026-08-06 tranche1 check) already
    has real dual email+IP rate limiting. Root cause of the false prior verdict: the
    tranche1 evidence's `git grep 'rateLimit|rate-limit|rate_limit|RateLimit'` used
    unescaped `|` alternation without `-E`, so it searched for the literal string
    (basic regex) instead of alternating — a real tooling bug, not a real gap. This
    point does not need a code fix; only the incorrect evidence needed correcting.
  - **P8-CB-02** (no CSP), **P8-CB-03** (no X-Frame-Options) — confirmed still
    reproducing live (`curl -sI https://projexa-ai.com/login`, no
    content-security-policy/x-frame-options headers). Also confirmed missing:
    x-content-type-options, referrer-policy, permissions-policy (overlaps P1-OBS-004).
  - **P8-CB-09** (sitemap references a different domain) — confirmed live:
    `https://projexa-ai.com/sitemap.xml` lists `<loc>` entries under
    `veridian-ai-os.vercel.app`, not the real domain being served.
  - **P8-CB-10** / **P1-OBS-003** (`/forgot-password` 404) — confirmed live
    (`curl -sI https://projexa-ai.com/forgot-password` → 404).
  - **P8-CB-01** / **P1-BLOCKER-001** (demo credentials `democeo@projexa-ai.com` /
    `Demo@1234` rejected) — genuinely could not be independently verified/fixed from
    this server: this session's env has no `SUPABASE_SERVICE_ROLE_KEY` or
    `DATABASE_URL`, only `SUPABASE_ACCESS_TOKEN` (management-API token, not
    Auth-admin). **Held, not fabricated** — real Supabase dashboard/service-role
    access is required to reset or confirm this account.
- [x] Wrote real deterministic close-ended fix plans and implemented real code fixes
      for the 4 confirmed-reproducing points:
  - `next.config.ts` — added `headers()`: Content-Security-Policy (frame-ancestors
    'none', object-src 'none', base-uri 'self'; script/style/img/connect kept broad —
    named honestly as a follow-up to tighten, not silently done here),
    X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy,
    Permissions-Policy. Closes P8-CB-02, P8-CB-03; contributes to P1-OBS-004.
  - `src/app/forgot-password/page.tsx` (new) — real redirect to
    `/login?reason=forgot-password`, per the finding's own recommended option B (no
    new password-reset mechanism invented, consistent with this app's existing,
    deliberate no-recovery-mechanism design). `src/app/login/login-form.tsx` — reads
    that query param and shows an inline prompt pointing at the existing "Send magic
    link instead" option. `messages/en.json` + `messages/hi.json` — added
    `forgotPasswordPrompt` key (both locales, matching this file's existing pattern).
    Closes P8-CB-10, P1-OBS-003.
  - `src/app/sitemap.ts` + `src/app/robots.ts` — `BASE` changed from
    `https://veridian-ai-os.vercel.app` to `https://projexa-ai.com` (the real live
    custom domain this app is actually served at). Closes P8-CB-09. Does not touch
    the separate, still-open brand-NAME question (P8-CB-08).
- [x] `bun install` (repo node_modules were absent in this fresh workspace) +
      `NODE_OPTIONS=--max-old-space-size=6144 bunx tsc --noEmit` — clean, 0 errors.
      `bunx eslint` on every changed file — clean, 0 errors/warnings.
- [x] Independent audit obtained via a separate subagent pass (not self-certified,
      per Rule 7(c)) — see PR for the AUDIT verdict comment.

## Remaining (explicitly NOT done this cycle — do not read as closed)

- [ ] **Retest against live site + final boolean certify** for P8-CB-02/03/09/10 —
      genuinely blocked on this PR merging and Vercel deploying to production; cannot
      be faked from a pre-merge branch. Holding certification, not fabricating a pass.
      Next cycle: once merged+deployed, re-run the same live curl checks used above
      and only then flip `certified: true` in the relevant umr_tasks evidence_json.
- [ ] Correct the P8-CB-04 evidence_json (currently a real, live-confirmed
      `NOT_REPRODUCING` — the point is already resolved, just needs the record fixed)
      and write it back to `UMR-20260806-145437-bf10`.
- [ ] Mint/update the real child UMR rows for the 5 points touched this cycle
      (CB-02, CB-03, CB-04-correction, CB-09, CB-10) with fix-plan/implementation/
      audit evidence, via the canonical `resource_governor.py --submit` +
      `superboss-register.py mark-umr-terminal` mint pattern, parented to the
      governing UMR. Not yet done as of this commit — next immediate step.
- [ ] P8-CB-01 / P1-BLOCKER-001 (demo credentials) — held, needs real Supabase
      dashboard/service-role access this session doesn't have.
- [ ] P8-CB-05 (Supabase Auth platform rate limits, dashboard-only setting), P8-CB-06
      (code-verifier cookie not HttpOnly — structural to client-side PKCE, needs a
      real architecture decision, not a quick fix), P8-CB-07 (PWA icons/service
      worker) — not started this cycle.
- [ ] P8-CB-08 (brand inconsistency PROJEXA vs VERIDIAN AI) — not started; overlaps
      the already-tracked OCID-038 brand/domain work, needs an Owner brand decision,
      out of scope for a unilateral fix.
- [ ] The remaining ~128 of 139 points (all of Parts 1–7's HP/MP/OBS/sub-checks, and
      Part 8's HP-20/MP-20/OBS beyond the CB group) — not started. Real, large,
      multi-cycle program; next cycles continue tranche-by-tranche the same way this
      one did.
