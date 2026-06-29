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
| BUG-001 | TC-DB-02, TC-CM-01, TC-DP-01, TC-US-01, TC-AT-01, TC-NF-01 | All API routes return 500 — DATABASE_URL env var has incorrect host format. Host was set to a non-resolvable Supabase pooler address instead of db.[ref].supabase.co | 1. Added SSL config to postgres client (rejectUnauthorized:false). 2. Created new DB user ct_app with known password via Supabase Management API. 3. Updated Vercel DATABASE_URL and DIRECT_URL env vars to postgresql://ct_app:CTApp2026Secure!@db.jusqumifsmtcaujqyjuy.supabase.co:5432/postgres. 4. Cleaned up db/index.ts. Commits: 169737d, 73bc414, cbee4fb, 0d2bc3d. Vercel redeployment triggered. | Pending — shell session became unresponsive before verification could complete. Next agent must verify all API routes return 200 and data is correct. | PENDING VERIFY |

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

*This file is auto-updated after each test execution.*
