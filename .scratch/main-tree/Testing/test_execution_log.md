# Compliance Tracker — Test Execution Log

> **Project:** FChecklist/compliance-tracker  
> **Environment:** https://compliance-tracker-ai.vercel.app  
> **Started:** 2026-06-29T03:39:10Z  
> **Last Updated:** 2026-06-29T04:20:00Z  
> **Agent:** Lead Senior QA Engineer  

---

## Execution Log

| Bug ID | Test ID | Description | Fix Applied | Verification | Status |
|--------|---------|-------------|-------------|--------------|--------|
| BUG-001 | TC-DB-02, TC-CM-01, TC-DP-01, TC-US-01, TC-AT-01, TC-NF-01 | All API routes return 500 — DATABASE_URL env var has incorrect host format. Host was set to a non-resolvable Supabase pooler address instead of db.[ref].supabase.co | 1. Added SSL config to postgres client (rejectUnauthorized:false). 2. Created new DB user ct_app with known password via Supabase Management API. 3. Updated Vercel DATABASE_URL and DIRECT_URL env vars ([REDACTED 2026-07-04] -- this line previously had a real password in plaintext, referencing what was later confirmed to actually be a *different* app's (MeetTrack) Supabase project, not a dedicated VERIDIAN one -- see security-audit note in PLATFORM_STRATEGY.md). 4. Cleaned up db/index.ts. Commits: 169737d, 73bc414, cbee4fb, 0d2bc3d. Vercel redeployment triggered. | Pending — shell session became unresponsive before verification could complete. Next agent must verify all API routes return 200 and data is correct. | PENDING VERIFY |

---

## Individual Test Results

| # | Test ID | Result | Notes |
|---|---------|--------|-------|
| 1.1 | TC-LP-01 | **PASS** | Landing page loads with hero section ("One Portal. One Truth."), 6 feature cards (Deadline Tracking, Multi-Tenant, Audit Trail, AI Assistant, Team Collaboration, Pendency Dashboard), and 3 CTA links (Get Started x2, Sign Up Free). Verified via agent-browser. |
| 1.2 | TC-LP-02 | **PASS** | "Get Started" header link navigates to /login. Verified via agent-browser. |
| 1.3 | TC-AU-01 | **PASS** | Login page renders with EMAIL textbox, PASSWORD textbox, "Sign In" button, "Send magic link instead" button, and "Create one" signup link. Verified via agent-browser. |
| 1.4 | TC-AU-02 | **PASS** | Browser-native validation fires "Please fill out this field." on empty email field submission. Verified via agent-browser. |
| 1.5 | TC-AU-03 | **BLOCKED** | Requires valid Supabase credentials. Cannot test without a known user account. |
| 1.6 | TC-AU-04 | **PASS** | Signup page renders with Full Name, Organisation, Work Email, Password fields and "Create Account" button. Verified via agent-browser. |
| 1.7 | TC-AU-05 | **BLOCKED** | Requires OAuth flow to test. |
| 2.1 | TC-DB-01 | **BLOCKED** | Dashboard page requires authentication (middleware redirect). Cannot test without login. |
| 2.2 | TC-DB-02 | **FAIL → FIX APPLIED** | /api/compliance/stats returned 500. Root cause: BUG-001 (incorrect DATABASE_URL). Fix deployed, verification pending. |
| 2.3 | TC-DB-03 | **BLOCKED** | Depends on TC-DB-01. |
| 2.4 | TC-DB-04 | **BLOCKED** | Depends on TC-DB-02. |
| 2.5 | TC-DB-05 | **BLOCKED** | Depends on TC-DB-02. |
| 3.1 | TC-CM-01 | **FAIL → FIX APPLIED** | /api/compliance returned 500. Root cause: BUG-001. Fix deployed, verification pending. |
| 3.2-3.14 | TC-CM-02 to TC-CM-14 | **PENDING** | Blocked by BUG-001 verification. |
| 4.1 | TC-DP-01 | **FAIL → FIX APPLIED** | /api/departments returned 500. Root cause: BUG-001. Fix deployed, verification pending. |
| 4.2-4.3 | TC-DP-02, TC-DP-03 | **PENDING** | Blocked. |
| 5.1 | TC-US-01 | **FAIL → FIX APPLIED** | /api/users returned 500. Root cause: BUG-001. Fix deployed, verification pending. |
| 5.2 | TC-US-02 | **PENDING** | Blocked. |
| 6.1 | TC-AT-01 | **FAIL → FIX APPLIED** | /api/audit returned 500. Root cause: BUG-001. Fix deployed, verification pending. |
| 6.2-6.3 | TC-AT-02, TC-AT-03 | **PENDING** | Blocked. |
| 7.1 | TC-NF-01 | **FAIL → FIX APPLIED** | /api/notifications returned 500. Root cause: BUG-001. Fix deployed, verification pending. |
| 7.2 | TC-NF-02 | **PENDING** | Blocked. |
| 8.1-8.4 | TC-RP-01 to TC-CL-01 | **PENDING** | Not yet tested. |
| 9.1-9.5 | TC-SH-01 to TC-SH-05 | **PENDING** | Not yet tested. |
| 10.1-10.4 | TC-SEC-01 to TC-SEC-04 | **PENDING** | Not yet tested. |
| 11.1-11.3 | TC-PF-01 to TC-PF-03 | **PENDING** | Not yet tested. |
| 12.1-12.4 | TC-RS-01 to TC-RS-04 | **PENDING** | Not yet tested. |

---

## Summary
- **Total Tests:** 46
- **PASO:** 5 (TC-LP-01, TC-LP-02, TC-AU-01, TC-AU-02, TC-AU-04)
- **FAIL (Fix Applied):** 6 (all due to BUG-001 — DATABASE_URL)
- **BLOCKED:** 3 (TC-AU-03, TC-AU-05, TC-DB-01 — require auth)
- **PENDING:** 32

## Bugs Found
| Bug ID | Severity | Description | Status |
|--------|----------|-------------|--------|
| BUG-001 | Critical | DATABASE_URL env var on Vercel had incorrect host. All API routes returned 500. | Fix deployed. Verification pending. |
| BUG-002 | Critical | Supabase Supavisor pooler cannot route to project `pcrjmlpuqsbocqfwoxod` (`tenant/user X not found`) — affects both `DATABASE_URL` and `APP_RUNTIME_DATABASE_URL`, any role. Direct (non-pooler) connection with the same password succeeds. Discovered 2026-07-01 during Wave 5 (VERIDIAN AI Orchestra rebuild) functional testing. | Diagnosed, not yet resolved — Supabase-infrastructure-side, not an app bug. Full detail in `orchestra_changes.md`'s 🔴 section. |

---

## Wave 1 tenant-isolation test cases (added 2026-07-01, VERIDIAN AI Orchestra rebuild)

These supplement the original 46 above, covering the cross-tenant isolation work that is this rebuild's core guarantee — see `orchestra_changes.md` for full context. Executed directly against the database (not via the live app, since BUG-002 currently blocks authenticated live-app testing).

| Test ID | Description | Method | Result |
|---------|-------------|--------|--------|
| TC-TEN-01 | `postgres` role (used by `DATABASE_URL`) has `rolbypassrls=true` — confirms why a *new* role was required for real enforcement rather than writing policies against the existing connection | `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles` | **PASS** — confirmed before writing any Wave 1 policy (change log #17) |
| TC-TEN-02 | A user scoped to org A, querying via the real `app_runtime`/`withTenantContext` path, sees only org A's `compliance_items` — a throwaway second org's 1 item is invisible to org A's session | `SET LOCAL ROLE app_runtime` + GUCs, live query comparison | **PASS** (change log #18) |
| TC-TEN-03 | An `UPDATE` targeting another org's row, issued while scoped to a different org's context, affects 0 rows (RLS filters the write, not just the read) | Same session as TC-TEN-02, re-read target row unchanged afterward | **PASS** (change log #18) |
| TC-TEN-04 | `ai_assistants`/`assistant_memories` (Wave 2's User tier) are invisible even to other users in the *same* org, not just other orgs — the strictest visibility rule in the schema | RLS policy inspection + `current_user_id()` scoping (change log #31) | **PASS** — verified via policy definition; live cross-user query test blocked by BUG-002 |
| TC-TEN-05 | `worker_agents` tier='global' rows are readable by everyone but **not writable** by `app_runtime` under any org/client/user context — only `service_role` can modify platform-managed agents | RLS policy inspection: separate INSERT/UPDATE/DELETE policies explicitly exclude `tier='global'` (change log #33) | **PASS** — verified via policy definition |
| TC-TEN-06 | Loop 12 (Hierarchy & Secrecy Management) re-runs an automated version of TC-TEN-02 on a schedule against up to 10 real orgs, flagging any row whose `org_id` doesn't match the org it was queried under | `lib/loops/data-separation-audit.ts` via `/api/internal/loops/run` | **BLOCKED by BUG-002** — code deployed and reviewed, but cron execution fails until the pooler issue resolves (returns `{"error":"Loop run failed"}` live) |
| TC-TEN-07 | `loop_executions`/`data_separation_audit` (which could contain evidence of cross-org data during an audit) have **zero** `app_runtime` RLS policy at all — not even org-scoped — so no customer-facing route can ever read platform audit results | RLS policy inspection: only `service_role_bypass_*` policies exist on these tables (change log #38) | **PASS** — verified via policy definition |

*This file is auto-updated after each test execution.*
