# Compliance Tracker — QA Test Plan

> **Project:** FChecklist/compliance-tracker  
> **Environment:** https://compliance-tracker-ai.vercel.app  
> **Date Created:** 2026-06-29T03:39:10Z  
> **Agent:** Lead Senior QA Engineer  
> **Status:** In Progress  

---

## Test Inventory

### Category 1: Landing Page & Authentication (Unit / Functional)

| # | Test ID | Test Scenario | Type | Priority | Status |
|---|---------|---------------|------|----------|--------|
| 1.1 | TC-LP-01 | Landing page loads and renders hero section, features grid, CTA buttons | Functional | High | Pending |
| 1.2 | TC-LP-02 | "Get Started" and "Sign In" links navigate to /login | Functional | High | Pending |
| 1.3 | TC-AU-01 | Login page renders email/password form and social login option | Functional | High | Pending |
| 1.4 | TC-AU-02 | Login form validates empty fields and shows error | Unit | Medium | Pending |
| 1.5 | TC-AU-03 | Login with valid Supabase credentials redirects to /dashboard | Functional | Critical | Pending |
| 1.6 | TC-AU-04 | Signup page renders and creates new user via Supabase | Functional | High | Pending |
| 1.7 | TC-AU-05 | Auth callback route processes Supabase OAuth correctly | Functional | High | Pending |

### Category 2: Dashboard (Module / Functional)

| # | Test ID | Test Scenario | Type | Priority | Status |
|---|---------|---------------|------|----------|--------|
| 2.1 | TC-DB-01 | Dashboard loads and displays stat cards (total, overdue, completed, etc.) | Functional | Critical | Pending |
| 2.2 | TC-DB-02 | Dashboard API /api/compliance/stats returns correct JSON structure | Functional | Critical | Pending |
| 2.3 | TC-DB-03 | Department compliance breakdown chart/section renders | Functional | High | Pending |
| 2.4 | TC-DB-04 | Upcoming deadlines section shows up to 5 items | Functional | Medium | Pending |
| 2.5 | TC-DB-05 | Recent activity feed shows up to 8 audit log entries | Functional | Medium | Pending |

### Category 3: Compliance Module (Module / Functional / Logic Flow)

| # | Test ID | Test Scenario | Type | Priority | Status |
|---|---------|---------------|------|----------|--------|
| 3.1 | TC-CM-01 | Compliance list page loads with items from /api/compliance | Functional | Critical | Pending |
| 3.2 | TC-CM-02 | Search filter works (filters by title/description) | Functional | High | Pending |
| 3.3 | TC-CM-03 | Status filter dropdown filters compliance items | Functional | High | Pending |
| 3.4 | TC-CM-04 | Department filter works | Functional | High | Pending |
| 3.5 | TC-CM-05 | Pagination works (page, limit params) | Functional | Medium | Pending |
| 3.6 | TC-CM-06 | Sort by dueDate, createdAt, title works | Functional | Medium | Pending |
| 3.7 | TC-CM-07 | "Add New Compliance" form renders with all fields | Functional | High | Pending |
| 3.8 | TC-CM-08 | POST /api/compliance creates item with valid data (201 response) | Functional | Critical | Pending |
| 3.9 | TC-CM-09 | POST /api/compliance rejects missing title (400) | Unit | High | Pending |
| 3.10 | TC-CM-10 | POST /api/compliance rejects missing complianceType (400) | Unit | High | Pending |
| 3.11 | TC-CM-11 | POST /api/compliance rejects missing departmentId (400) | Unit | High | Pending |
| 3.12 | TC-CM-12 | POST /api/compliance rejects invalid departmentId (404) | Unit | High | Pending |
| 3.13 | TC-CM-13 | Compliance detail page /compliance/[id] loads | Functional | High | Pending |
| 3.14 | TC-CM-14 | Status change on detail page triggers audit log | Logic Flow | High | Pending |

### Category 4: Departments Module (Module / Functional)

| # | Test ID | Test Scenario | Type | Priority | Status |
|---|---------|---------------|------|----------|--------|
| 4.1 | TC-DP-01 | Departments list page loads with data from /api/departments | Functional | Critical | Pending |
| 4.2 | TC-DP-02 | Each department card shows name, member count, compliance count | Functional | High | Pending |
| 4.3 | TC-DP-03 | Department detail page /departments/[id] loads | Functional | High | Pending |

### Category 5: Users & Team (Module / Functional)

| # | Test ID | Test Scenario | Type | Priority | Status |
|---|---------|---------------|------|----------|--------|
| 5.1 | TC-US-01 | Users page loads with data from /api/users | Functional | High | Pending |
| 5.2 | TC-US-02 | Team page renders member cards with roles | Functional | High | Pending |

### Category 6: Audit Trail (Module / Functional)

| # | Test ID | Test Scenario | Type | Priority | Status |
|---|---------|---------------|------|----------|--------|
| 6.1 | TC-AT-01 | Audit page loads with data from /api/audit | Functional | High | Pending |
| 6.2 | TC-AT-02 | Audit log entries show action, entity, user, timestamp | Functional | Medium | Pending |
| 6.3 | TC-AT-03 | Audit filter by action type works | Functional | Medium | Pending |

### Category 7: Notifications (Module / Functional)

| # | Test ID | Test Scenario | Type | Priority | Status |
|---|---------|---------------|------|----------|--------|
| 7.1 | TC-NF-01 | Notifications API /api/notifications returns list with unreadCount | Functional | High | Pending |
| 7.2 | TC-NF-02 | Mark notification as read via /api/notifications/[id]/read | Functional | Medium | Pending |

### Category 8: Reports, Tasks, Penalties, Checklists (Module / Functional)

| # | Test ID | Test Scenario | Type | Priority | Status |
|---|---------|---------------|------|----------|--------|
| 8.1 | TC-RP-01 | Reports page loads without errors | Functional | Medium | Pending |
| 8.2 | TC-TK-01 | Tasks page loads without errors | Functional | Medium | Pending |
| 8.3 | TC-PN-01 | Penalties page loads without errors | Functional | Medium | Pending |
| 8.4 | TC-CL-01 | Checklists page loads without errors | Functional | Medium | Pending |

### Category 9: App Shell & Navigation (Module / Functional)

| # | Test ID | Test Scenario | Type | Priority | Status |
|---|---------|---------------|------|----------|--------|
| 9.1 | TC-SH-01 | App layout renders sidebar + topbar + main content area | Functional | Critical | Pending |
| 9.2 | TC-SH-02 | Sidebar navigation links are all present and clickable | Functional | High | Pending |
| 9.3 | TC-SH-03 | Search command (Cmd+K) dialog opens | Functional | Medium | Pending |
| 9.4 | TC-SH-04 | Theme toggle (light/dark) works | Functional | Medium | Pending |
| 9.5 | TC-SH-05 | Mobile responsive: sidebar collapses, layout adapts | Functional | High | Pending |

### Category 10: API Input Validation & Security (Unit / Logic Flow)

| # | Test ID | Test Scenario | Type | Priority | Status |
|---|---------|---------------|------|----------|--------|
| 10.1 | TC-SEC-01 | API returns proper error structure on invalid input | Unit | High | Pending |
| 10.2 | TC-SEC-02 | SQL injection prevention on search parameter | Security | Critical | Pending |
| 10.3 | TC-SEC-03 | API pagination limits enforced (max 100) | Unit | High | Pending |
| 10.4 | TC-SEC-04 | API returns 500 with safe error message on DB failure | Unit | Medium | Pending |

### Category 11: Performance (Performance)

| # | Test ID | Test Scenario | Type | Priority | Status |
|---|---------|---------------|------|----------|--------|
| 11.1 | TC-PF-01 | Landing page TTI < 3s on 4G simulated | Performance | High | Pending |
| 11.2 | TC-PF-02 | Dashboard API response time < 500ms | Performance | High | Pending |
| 11.3 | TC-PF-03 | Compliance list API response time < 500ms | Performance | Medium | Pending |

### Category 12: Responsiveness & Accessibility (Functional)

| # | Test ID | Test Scenario | Type | Priority | Status |
|---|---------|---------------|------|----------|--------|
| 12.1 | TC-RS-01 | Landing page renders correctly on mobile (375px) | Functional | High | Pending |
| 12.2 | TC-RS-02 | Dashboard renders correctly on mobile (375px) | Functional | High | Pending |
| 12.3 | TC-RS-03 | All pages have proper semantic HTML (main, header, nav) | Functional | Medium | Pending |
| 12.4 | TC-RS-04 | Interactive elements have minimum 44px touch targets | Functional | Medium | Pending |

---

## Execution Order

Tests are executed sequentially in the order above. Each test must reach PASS before moving to the next. Failed tests trigger RCA and remediation (Phase 3).

## Total Tests: 46
