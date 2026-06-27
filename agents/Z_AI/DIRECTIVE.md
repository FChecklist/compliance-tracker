# VEDABOSS — Agent Directive 2026-06-26

## Active Agents

| Agent | Provider | Tasks |
|-------|----------|-------|
| VEDABOSS | Claude Code | Auth, DB, infra, QC, architecture |
| Z.ai | GLM-5-Turbo | T-D2-001, T-D3-001, T-D5-001 |

---

## Z.ai — Your Assigned Tasks

### T-D2-001 — Compliance API Routes
Create the following Next.js route handlers in `apps/web/app/api/compliance/`:

| File | Method | Action |
|------|--------|--------|
| `route.ts` | GET | List with filters (status, priority, type, assignee, search, pagination) |
| `route.ts` | POST | Create compliance item (auto-slug, log audit) |
| `[id]/route.ts` | GET | Fetch single item |
| `[id]/route.ts` | PUT | Update item (log audit) |
| `[id]/route.ts` | DELETE | Soft delete / hard delete (account_admin only) |
| `[id]/status/route.ts` | PUT | Change status → insert compliance_history row |
| `[id]/reassign/route.ts` | PUT | Reassign → update assignee_id, log audit |
| `bulk/route.ts` | POST | Bulk status change (up to 100 items) |

**Rules:**
- Use `createServerClient` from `@supabase/ssr` with `compliance` schema
- Validate all inputs with schemas from `@compliancetrack/types`
- Every mutating action must insert a row into `compliance.audit_logs`
- Return `{ data, error, meta }` shape from `@compliancetrack/types` ApiResponse

---

### T-D3-001 — Notification Service
- `apps/web/app/api/cron/deadline-check/route.ts` — Vercel cron, runs daily at 08:00 UTC
  - Query `compliance_items` where `due_date < now() + interval '7 days'` and status != 'completed'
  - Insert `notifications` rows for assignees
  - Update overdue items (status = 'overdue' where due_date < now())
- `apps/web/app/api/notifications/route.ts` — GET (user inbox, unread count), PATCH (mark read/all-read)
- Add to `apps/web/vercel.json`:
```json
{ "crons": [{ "path": "/api/cron/deadline-check", "schedule": "0 8 * * *" }] }
```

---

### T-D5-001 — Bulk Actions + CSV Export
- `apps/web/app/api/compliance/export/route.ts` — GET with same filters as list
  - Returns `Content-Type: text/csv` with headers: id, title, type, status, priority, assignee, due_date, department

---

## Stack Reference
- **Framework:** Next.js 15 App Router
- **DB:** Supabase (project: `jusqumifsmtcaujqyjuy`, schema: `compliance`)
- **Types:** `@compliancetrack/types` (workspace package)
- **Validation:** Zod schemas already defined in types package
- **Auth:** Supabase Auth — use `auth.getUser()` to get current user

## Env Vars Available
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (use for cron/server-only routes)