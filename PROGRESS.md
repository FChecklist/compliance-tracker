# PROGRESS -- task-20260806-222538-owner-mandate--z-ai-gtm-findings-closure

Owner standing mandate: Z.AI 8-part real black-box audit of projexa-ai.com, governing
UMR-20260806-101802-a350. This is a real, large, multi-cycle work program (SPEC's own words) --
this file tracks the running total across cycles/sessions, not just this one invocation.

## Completed (across all cycles so far, this session + predecessors)

- [x] **Step 1 (merge):** all 8 real Z.AI report parts landed at
      `/opt/veridian/ai-os/memory/zai-gtm-findings/` and merged verbatim into one file at
      `/opt/veridian/ai-os/memory/ZAI_BLACKBOX_AUDIT_MERGED.md`, via FChecklist/veridian-ai-os
      PR #3 (merged 2026-08-06T10:38:57Z). Live-reconfirmed this cycle (file sizes, `git ls-tree`).
- [x] **Step 2 (enumerate):** a reusable parser (`/opt/veridian/ai-os/scripts/zai_gtm_audit_parser.py`,
      same PR #3) produced `/opt/veridian/ai-os/memory/ZAI_BLACKBOX_AUDIT_POINTS_MANIFEST.json` --
      **139 real atomic points** (61 labeled findings: 1 BLOCKER + 10 CB + 20 HP + 20 MP + 10 OBS,
      plus 78 sub-checks each carrying their own FAIL/WARN/PARTIAL verdict). Per-part breakdown:
      P1 17, P2 12, P3 11, P4 15, P5 14, P6 13, P7 7, P8 50. (154 further sub-checks correctly
      excluded as PASS/UNTESTABLE/UNVERIFIABLE/BLOCKED/n-a.)
- [x] **Step 3 (mint child UMRs), Tranche 1 (11 -> 10 highest-severity points):** honest dedup
      confirmed live -- P1-BLOCKER-001 and P8-CB-01 both describe the same invalid-demo-credential
      issue, collapsed to one point (P8-CB-01). All 10 remaining Tranche-1 points (P8-CB-01..CB-10)
      have real child UMRs under UMR-20260806-101802-a350 (`UMR-20260806-145437-*`, `umr_tasks` rows).
- [x] **Step 4, reproduce-verify:** all 10 Tranche-1 points independently live-reproduce-verified
      (curl/git grep/code inspection against projexa-ai.com and origin/main), verdicts + evidence
      recorded in each child UMR's `outputs_json`.
- [x] **Step 4, propose+PM-decide:** all 10 filed via `insert-owner-proposal` and PM-decided
      (`pm_decisions_pending` ids 92-101): 92/93 completed (PR opened), 94/96/97/99/100 approved,
      95/98 held for Owner, 101 open (credential-access gap, correctly not fabricated).
- [x] **Step 4, implement (partial):** CB-02 (no CSP) + CB-03 (no X-Frame-Options) implemented
      together as PR #994 (`fix/ocid-csp-frame-protection`), locally quality-gated. CB-09 (sitemap
      wrong domain) implemented as PR #978 (DeepSeek external-agent pilot, byte-verified).
      **Both PRs open, unmerged** -- see Blocked, below.
- [x] **This cycle's own real work:** live-reverified the whole chain above rather than trusting the
      dispatched SPEC text (which still framed the 8 files as "being transferred right now" -- stale).
      Corrected/completed the two investigation-only approved points:
      - **CB-06 (HttpOnly code_verifier cookie, decision 96):** confirmed via the real auth code
        (`src/lib/supabase/client.ts` + `src/app/auth/callback/route.ts`) that this app already runs
        @supabase/ssr's own documented client-initiated PKCE pattern with no supported
        fully-server-initiated alternative -- **not reasonably feasible** without forking the
        library's browser-client flow. Recorded as an accepted residual risk (mitigated by the
        CB-02/03 CSP+X-Frame-Options work), per the PM's own stated condition.
      - **CB-07 (sw.js 404 + no PNG icons, decision 97):** found the *prior* investigation's own
        evidence was wrong (claimed `public/sw.js` + a `ServiceWorkerRegister` component already
        existed on `origin/main` -- live `git grep`/`git ls-tree` show neither exists there; PR #54
        never shipped this). Real root cause: a complete fix already exists on branch
        `fix/ocid038-offline-service-worker` (commit `c07f9e55`, OCID-038) as **PR #889** -- also
        blocked by the same deadlock, not a build/deploy gap. PNG icons remain a separate, still
        fully-open gap (zero PNG files under `public/` on `origin/main` or PR #889's branch).
      - Both corrections written to the real `umr_tasks.outputs_json` rows for
        `UMR-20260806-145437-a0e0` and `UMR-20260806-145437-bf4c` via the canonical
        `update_umr_task()` function (imported, never raw SQL), merged onto (not overwriting) the
        prior evidence.
      - Registered this cycle's work in `ai-os/boss/ACTIVE-CLAIMS.yaml` (`recently_completed`).

## Blocked / Held (not certified, per "never fabricate a pass")

- **Systemic blocker affecting every code-touching Tranche-1 point:** compliance-tracker `main` has
  an active branch-protection self-approval deadlock (1 PR review required, only one real GitHub
  identity exists -- `[[veridian-branch-protection-self-approval-deadlock-active]]` memory, also
  separately tracked under governing UMR-20260806-071025-1d28's own long `pm_decisions_pending`
  chain). PR #994 (CB-02/03), PR #978 (CB-09), and PR #889 (CB-07 sw.js half) are all real,
  quality-gated, and **BLOCKED/REVIEW_REQUIRED** as of this cycle (`gh pr view` live-checked, not
  assumed). No point whose fix requires a merge can honestly reach "real re-test evidence against
  the live site" until this clears -- out of this task's scope to fix; flagged, not worked around.
- **CB-01 / BLOCKER (invalid demo credentials, decision 101):** genuinely cannot be
  reproduce-verified from this server without either a real login attempt (disallowed by the
  standing no-credential-entry rule) or Supabase service-role/dashboard access (not available in
  this session). Held, per the SPEC's own explicit instruction for exactly this case.
- **CB-05 (Supabase platform rate limits, decision 95)** and **CB-08 (brand inconsistency,
  decision 98):** correctly PM-held for the Owner (a live third-party dashboard setting, and a
  brand-identity business decision) -- not actionable by any agent-side path.

## Remaining

- [ ] Implement CB-04 (passcode-login rate limiting, decision 94 -- approved, durable
      shared-state + fail-closed, not yet started).
- [ ] Implement CB-10 (`/forgot-password` 404, decision 100 -- approved, not yet started).
- [ ] Once the merge deadlock clears: get PR #994 / #978 / #889 merged, then run the real live
      re-test + certify (boolean) step on CB-02, CB-03, CB-07(sw.js half), CB-09, and record the
      CB-06 residual-risk acceptance as the point's terminal state.
- [ ] Add PNG icons (192x192/512x512 min) for the still-open half of CB-07, once a merge path exists.
- [ ] Await Owner decision on CB-05 and CB-08 (held).
- [ ] Await Owner decision on CB-01/BLOCKER credential-access path (open).
- [ ] Continue past Tranche 1 into the remaining ~128 of 139 total points: 20 HP, 20 MP, 10 OBS,
      and the 78 verdicted sub-checks (parts 1-7, plus HP/MP/OBS points within part 8) -- mint child
      UMRs, reproduce-verify, propose, and work each through the same lifecycle, in future cycles,
      exactly as this SPEC instructs ("do not attempt to close every point in one pass").
- [ ] For every point that maps cleanly onto one of the 25 OCID-020 GTM categories, cross-link via
      `update-gtm-category` once real closure (not just investigation) exists for that point.
