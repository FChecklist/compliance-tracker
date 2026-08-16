# Compliance Tracker — Last Known State (Handover Document)

> **Last Updated:** 2026-06-29T04:20:00Z  
> **Agent:** Lead Senior QA Engineer  

---

## Current Progress

- **Phase 1 (Task Inventory):** COMPLETE — test_tasks.md created with 46 test scenarios across 12 categories.
- **Phase 2 (Execution):** IN PROGRESS — 14 tests executed (5 PASS, 6 FAIL-fixed, 3 BLOCKED). 32 tests pending.
- **Phase 3 (Remediation):** IN PROGRESS — BUG-001 fixed (DATABASE_URL). Deployment triggered but unverified due to shell timeout.

### Completed Tests (PASS)
1. TC-LP-01: Landing page renders hero, features grid, CTAs
2. TC-LP-02: "Get Started" navigates to /login
3. TC-AU-01: Login page renders email/password form
4. TC-AU-02: Login form validates empty fields
5. TC-AU-04: Signup page renders correctly

### Fixed Bugs (Verification Pending)
- BUG-001: All API routes returned 500. Root cause: DATABASE_URL had incorrect host. Fixed by creating ct_app DB user and updating Vercel env vars. Commits: 169737d, 73bc414, cbee4fb, 0d2bc3d.

### NEXT IMMEDIATE ACTION
1. **Verify BUG-001 fix:** `curl https://compliance-tracker-ai.vercel.app/api/compliance/stats` — should return JSON with stats, not 500.
2. If still 500, check Vercel deployment status and logs.
3. Once APIs work, continue from TC-DB-01 (dashboard page test).

### Pending Tests (32 remaining)
TC-AU-03, TC-AU-05, TC-DB-01 through TC-RS-04. See test_tasks.md for full list.

---

## Active Environment Configuration

- **Vercel URL:** https://compliance-tracker-ai.vercel.app
- **Vercel Project ID:** prj_80z9Rz3BYvvExvGXyt5LNoPPMgiZ
- **GitHub Repo:** FChecklist/compliance-tracker (main branch)
- **Database:** Supabase PostgreSQL (jusqumifsmtcaujqyjuy.supabase.co, region: ap-northeast-2)
- **DB Schema:** `compliance` (where all tables and data exist)
- **Auth:** Supabase Auth (email/password + magic link + OAuth)
- **DB User:** ct_app (created for this project)

### API Tokens in Use
- GitHub PAT: Configured (Secret: GITHUB_PAT)
- Vercel Token: Configured (Secret: VERCEL_TOKEN) 
- Supabase Access Token: Configured (Secret: SUPABASE_TOKEN)
- **New DB user:** ct_app (created via Supabase Management API -- password redacted 2026-07-04, was previously committed in plaintext; see security-audit note in PLATFORM_STRATEGY.md)

### Key Vercel Env Vars (Updated)
- `DATABASE_URL` = [REDACTED 2026-07-04 -- previously a real password in plaintext; set the actual value in Vercel's dashboard/env vars, never in this file]
- `DIRECT_URL` = (same as DATABASE_URL)
- `NEXT_PUBLIC_SUPABASE_URL` = [REDACTED 2026-07-04 -- was a real project ref; see note above]
- `DB_SCHEMA` = compliance_tracker (NOTE: not used by code — code hardcodes `compliance` schema)

### Database State
- Tables exist in `compliance` schema: organisations (1), users (5), departments (4), compliance_items (18)
- Also tables exist in `compliance_tracker` schema (separate dataset, not used by app)
- RLS policies may exist — the ct_app user has been granted ALL PRIVILEGES on compliance schema

---

## Known Bottlenecks / Issues

1. **BUG-001 (CRITICAL):** DATABASE_URL was incorrect. Fix deployed but NOT YET VERIFIED. The last Vercel deployment was triggered but shell session timed out before verification.
2. **Auth Testing:** No known test user credentials available. The Supabase database has `admin@acme.com` user in the compliance.users table but this may not match the Supabase Auth user. Need to either:
   - Find/create Supabase Auth credentials for testing
   - Or use the Supabase Management API to create a test user
3. **Debug Logging:** The stats API route currently includes `debug` field in error responses. This should be removed before production.

---

## Commits Made During This Session

| Commit | Description |
|--------|-------------|
| 169737d | fix: add SSL requirement for Supabase database connection |
| 73bc414 | fix: use rejectUnauthorized:false for Supabase SSL |
| cbee4fb | fix: auto-reconstruct DATABASE_URL for Supabase |
| 6ea5755 | debug: add detailed error message to stats API |
| 0d2bc3d | fix: clean up db connection with correct SSL config |

## Files Modified
- `src/lib/db/index.ts` — Added SSL config, URL reconstruction (later cleaned up)
- `src/app/api/compliance/stats/route.ts` — Added debug error info (temporary)

---

## Instructions for Next Agent

1. **FIRST:** Verify BUG-001 fix by calling `curl https://compliance-tracker-ai.vercel.app/api/compliance/stats` — expect 200 with JSON data.
2. If still failing, check Vercel deployment status and investigate.
3. If working, **remove the debug field** from stats route (commit: 6ea5755 changes).
4. Resume testing from **TC-AU-03** (login with valid credentials). You may need to create a Supabase Auth user first using the Management API.
5. Continue through all pending tests sequentially.
6. After each test, update BOTH `Testing/test_execution_log.md` and `Testing/test_tasks.md`.
7. If a test FAILS, perform RCA, fix, commit, push, verify before moving on.
8. After all 46 tests pass, update this file with "ALL TESTS COMPLETE" and update `Testing/README.md` with "Test Done, Task Completed."

---

## File Manifest

| File | Purpose |
|------|---------|
| `Testing/README.md` | Root testing instructions (AI-readable) |
| `Testing/test_tasks.md` | Full test inventory (46 tests) |
| `Testing/test_execution_log.md` | Execution results and bug tracking |
| `Testing/last_known_state.md` | This file — handover state for next agent |
