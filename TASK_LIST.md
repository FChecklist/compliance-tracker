# Veridian AI — Agent Task List

> **Repo:** https://github.com/FChecklist/compliance-tracker  
> **Purpose:** Every pending task is listed here with full instructions so any AI agent (Claude Code via z.ai or otherwise) can pick up and execute autonomously.  
> **Rule:** After completing each task, the agent MUST update this file — fill in ✅ Status, Date/Time, Completed By, and Comments.

---

## How Agents Use This File

1. Read the full file before starting any work
2. Find the first task with **Status: 🔲 Pending**
3. Execute it following the instructions exactly
4. Update this file with completion details
5. Commit the update along with the task's code changes
6. Move to the next pending task

---

## Task Status Legend

| Symbol | Meaning |
|--------|---------|
| 🔲 | Pending — not started |
| 🔄 | In Progress — agent currently working |
| ✅ | Completed |
| ⛔ | Blocked — needs human input |

---

## Prerequisite: Merge PR #34

> **Before any task below:** Merge https://github.com/FChecklist/compliance-tracker/pull/34  
> This PR contains the Prisma→Drizzle migration. All DB tasks depend on it being on `main`.
> **Note:** UI tasks (BLOCK C, D, E) can proceed in parallel without waiting for PR #34 — they do not touch the DB layer.

---

---

# BLOCK A — Database & Infrastructure

---

## TASK-001 — Merge PR #34 (Prisma → Drizzle migration)

| Field | Value |
|---|---|
| **Task ID** | TASK-001 |
| **Priority** | 🔴 Critical — DB tasks depend on this |
| **Status** | 🔲 Pending |
| **Path** | https://github.com/FChecklist/compliance-tracker/pull/34 |

### What to Do
Merge PR #34 (`feat/prisma-to-drizzle` → `main`). This PR contains:
- `src/lib/db/schema.ts` — full Drizzle schema (9 models, 6 pgEnums in `compliance` pgSchema)
- `src/lib/db/index.ts` — Drizzle client via postgres.js
- `drizzle.config.ts` — Drizzle Kit config
- All 9 API routes converted from Prisma to Drizzle
- `src/db/seed.ts` — seed script
- `package.json` — drizzle deps added, prisma removed

### Why
`main` still uses Prisma pointing to SQLite. PR #34 switches everything to Drizzle + Supabase PostgreSQL. Without this, the API returns errors.

### Current State
Verified 2026-06-28: `src/lib/db.ts` on `main` still imports PrismaClient. PR #34 is open and unmerged.

### Instructions
```bash
gh pr merge 34 --repo FChecklist/compliance-tracker --merge --admin
git checkout main && git pull origin main
```

### Completion Fields
- **Completed:** —
- **Date/Time:** —
- **Completed By:** —
- **Comments:** —

---

## TASK-002 — Push Drizzle Schema to Supabase

| Field | Value |
|---|---|
| **Task ID** | TASK-002 |
| **Priority** | 🔴 Critical |
| **Status** | 🔲 Pending |
| **Path** | repo root — runs against Supabase `jusqumifsmtcaujqyjuy` |
| **Depends On** | TASK-001 must be merged first |

### What to Do
Run Drizzle schema push to create the `compliance` pgSchema and all 9 tables in Supabase.

### Why
The `compliance` schema and tables do not exist in Supabase yet. No API route returns data until tables are created.

### Instructions
```bash
# DATABASE_URL is already set in Vercel env — for local run set it:
export DATABASE_URL="postgresql://postgres.jusqumifsmtcaujqyjuy:[DB_PASSWORD]@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require"
bun db:push
```

Tables that must appear in Supabase under the `compliance` schema:
- `organisations`, `departments`, `users`, `compliance_items`
- `audit_points`, `documents`, `comments`, `notifications`, `audit_logs`

Also creates 6 pgEnums: `user_role`, `compliance_status`, `priority`, `compliance_type`, `notification_type`, `audit_action`

### Completion Fields
- **Completed:** —
- **Date/Time:** —
- **Completed By:** —
- **Comments:** —

---

## TASK-003 — Run Seed Script Against Supabase

| Field | Value |
|---|---|
| **Task ID** | TASK-003 |
| **Priority** | 🔴 Critical |
| **Status** | 🔲 Pending |
| **Path** | `src/db/seed.ts` |
| **Depends On** | TASK-002 |

### What to Do
Execute the seed script to populate Supabase with demo data.

### Why
Without seed data all pages show empty states, charts show zeros, and lists are blank.

### Instructions
```bash
export DATABASE_URL="postgresql://postgres.jusqumifsmtcaujqyjuy:[DB_PASSWORD]@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require"
bun db:seed
```

Expected output:
- 1 Org: Acme Corp (plan: pro)
- 4 Depts: Finance, Legal, Operations, HR
- 7 Users: admin@acme.com / manager.finance / manager.legal / member.ops / member.hr / member.finance / viewer@acme.com (all pwd: `Test@1234`)
- 18 Compliance Items (GST/TDS/MCA/PF/ESIC/ROC/LABOUR/ENVIRONMENTAL mix)
- 36 Audit Points, 36 Comments, 18 Documents, 10 Notifications, 20 Audit Logs

### Completion Fields
- **Completed:** —
- **Date/Time:** —
- **Completed By:** —
- **Comments:** —

---

---

# BLOCK B — Layout & Design System

---

## TASK-004 — Add DM Serif Display font to Root Layout

| Field | Value |
|---|---|
| **Task ID** | TASK-004 |
| **Priority** | 🟠 High |
| **Status** | 🔲 Pending |
| **Path** | `src/app/layout.tsx` |

### Current State (verified 2026-06-28)
`src/app/layout.tsx` already has:
- ✅ `Inter` font loaded via `next/font/google`
- ✅ `ThemeProvider` from `next-themes` wrapping children
- ✅ `defaultTheme="light"` with `enableSystem`

**Missing:** `DM_Serif_Display` font. The `globals.css` already has `@font-face` for DM Serif Display but it is not loaded via `next/font/google` in layout.tsx, so headings may fall back to system serif.

### What to Do
Add `DM_Serif_Display` import alongside existing `Inter` in `src/app/layout.tsx`.

### Instructions
```tsx
// Add to existing imports at top of src/app/layout.tsx:
import { Inter, DM_Serif_Display } from 'next/font/google'

const dmSerifDisplay = DM_Serif_Display({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-heading',
  display: 'swap',
})

// In the body className, add the new variable alongside existing inter.variable:
<body className={`${inter.variable} ${dmSerifDisplay.variable} font-sans antialiased`}>
```

### Completion Fields
- **Completed:** —
- **Date/Time:** —
- **Completed By:** —
- **Comments:** —

---

## TASK-005 — Add Missing Nav Links to AppSidebar

| Field | Value |
|---|---|
| **Task ID** | TASK-005 |
| **Priority** | 🟠 High |
| **Status** | 🔲 Pending |
| **Path** | `src/components/AppSidebar.tsx` |

### Current State (verified 2026-06-28)
`AppSidebar.tsx` already exists with navy background, saffron active states, and mobile Sheet support. It has: Dashboard, Pendency View, Compliance Register, Audit Trail, Users, Departments, Settings.

**Missing nav links** (pages that will be built in Block E):
- `/checklists` — Checklists
- `/tasks` — Tasks
- `/reports` — Reports
- `/penalties` — Penalty Tracker
- `/team` — Team

### What to Do
Add the 5 missing nav links to the existing `getNavSections()` function in `AppSidebar.tsx`.

### Instructions
In the `getNavSections()` function, add to the COMPLIANCE section or create a new TOOLS section:
```tsx
// Add these items:
{ label: 'Checklists',      href: '/checklists', icon: CheckSquare },
{ label: 'Tasks',           href: '/tasks',       icon: ListTodo },
{ label: 'Reports',         href: '/reports',     icon: BarChart3 },
{ label: 'Penalty Tracker', href: '/penalties',   icon: AlertCircle },
{ label: 'Team',            href: '/team',        icon: Users },
```
Import new icons from `lucide-react`: `CheckSquare`, `ListTodo`, `BarChart3`
(AlertCircle and Users are already imported)

### Completion Fields
- **Completed:** —
- **Date/Time:** —
- **Completed By:** —
- **Comments:** —

---

---

# BLOCK C — Shell Components

> **Note:** The main shell already exists (`AppShell.tsx`, `AppSidebar.tsx`, `AppTopbar.tsx`).  
> Tasks 006A–006E below are about the **missing pieces** only.

---

## TASK-006A — AppSidebar: already built ✅

| Field | Value |
|---|---|
| **Task ID** | TASK-006A |
| **Status** | ✅ Completed |
| **Path** | `src/components/AppSidebar.tsx` |

### Completion Fields
- **Completed:** Yes — navy sidebar with saffron active states, mobile Sheet, all main routes
- **Date/Time:** Before 2026-06-28 (Z.ai prior session)
- **Completed By:** Z.ai / Claude Code
- **Comments:** Missing 5 nav links for new pages — handled in TASK-005

---

## TASK-006B — AppTopbar: already built ✅

| Field | Value |
|---|---|
| **Task ID** | TASK-006B |
| **Status** | ✅ Completed |
| **Path** | `src/components/AppTopbar.tsx` |

### Completion Fields
- **Completed:** Yes — has search input, notification bell with unread count badge, user avatar dropdown (Profile / Settings / Logout)
- **Date/Time:** Before 2026-06-28 (Z.ai prior session)
- **Completed By:** Z.ai / Claude Code
- **Comments:** ThemeToggle (dark/light switch) not present in topbar — minor gap, low priority

---

## TASK-006C — Build SearchCommand Component (Cmd+K palette)

| Field | Value |
|---|---|
| **Task ID** | TASK-006C |
| **Priority** | 🟡 Medium |
| **Status** | 🔲 Pending |
| **Path** | `src/components/search-command.tsx` |

### Current State
AppTopbar has a plain `<Input>` search field. There is no Cmd+K command palette.

### What to Do
Build a full command palette using the `cmdk` package (already installed).

### Instructions
```tsx
'use client'
// Dialog wrapping Command from cmdk
// Keyboard shortcut: useEffect for Ctrl+K / Cmd+K → opens dialog
// On input change (debounced 300ms): fetch('/api/compliance?search=' + query + '&limit=8')
// Show results: title, status badge, department name
// Click result → router.push('/compliance/' + id), close dialog
// Wire up in AppTopbar: replace <Input> with <SearchCommand /> trigger button
```

### Completion Fields
- **Completed:** —
- **Date/Time:** —
- **Completed By:** —
- **Comments:** —

---

## TASK-006D — Build ThemeToggle Component

| Field | Value |
|---|---|
| **Task ID** | TASK-006D |
| **Priority** | 🟡 Medium |
| **Status** | 🔲 Pending |
| **Path** | `src/components/theme-toggle.tsx` |

### What to Do
Build a sun/moon toggle button and add it to AppTopbar.

### Instructions
```tsx
'use client'
import { useTheme } from 'next-themes'
import { Sun, Moon } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <Button variant="ghost" size="icon"
      className="text-white/80 hover:text-white hover:bg-white/10"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  )
}
```
Then import and add `<ThemeToggle />` in `AppTopbar.tsx` between the search input and the bell icon.

### Completion Fields
- **Completed:** —
- **Date/Time:** —
- **Completed By:** —
- **Comments:** —

---

## TASK-006E — UserMenu: already built ✅

| Field | Value |
|---|---|
| **Task ID** | TASK-006E |
| **Status** | ✅ Completed |
| **Path** | `src/components/AppTopbar.tsx` (inline) |

### Completion Fields
- **Completed:** Yes — user avatar dropdown with Profile / Settings / Logout is in AppTopbar
- **Date/Time:** Before 2026-06-28 (Z.ai prior session)
- **Completed By:** Z.ai / Claude Code
- **Comments:** Hardcoded to "Rajesh Sharma / RS" — acceptable until auth is built

---

---

# BLOCK D — UI Components

---

## TASK-007A — Build DashboardCard Component

| Field | Value |
|---|---|
| **Task ID** | TASK-007A |
| **Priority** | 🟠 High |
| **Status** | 🔲 Pending |
| **Path** | `src/components/ui/dashboard-card.tsx` |

### Current State
Dashboard page uses inline `<Card>` elements. No reusable `DashboardCard` component exists.

### What to Do
Extract the KPI card pattern into a reusable component.

### Instructions
```tsx
import { LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface DashboardCardProps {
  title: string
  value: number | string
  subtitle?: string
  icon: LucideIcon
  variant: 'total' | 'overdue' | 'pending' | 'completed'
}

const variantStyles = {
  total:     { border: 'border-l-[#1C2B3A]', iconBg: 'bg-[#1C2B3A]/10', iconColor: 'text-[#1C2B3A]' },
  overdue:   { border: 'border-l-red-500',   iconBg: 'bg-red-50',        iconColor: 'text-red-600' },
  pending:   { border: 'border-l-yellow-500',iconBg: 'bg-yellow-50',     iconColor: 'text-yellow-600' },
  completed: { border: 'border-l-[#0E7C6E]', iconBg: 'bg-[#0E7C6E]/10', iconColor: 'text-[#0E7C6E]' },
}
```

### Completion Fields
- **Completed:** —
- **Date/Time:** —
- **Completed By:** —
- **Comments:** —

---

## TASK-007B — Build StatusBadge Component

| Field | Value |
|---|---|
| **Task ID** | TASK-007B |
| **Priority** | 🟠 High |
| **Status** | 🔲 Pending |
| **Path** | `src/components/ui/status-badge.tsx` |

### Current State
Status is displayed as plain text or generic `<Badge>` throughout the app. No dedicated StatusBadge with color coding exists.

### What to Do
Create `StatusBadge` and `PriorityBadge` components used across all pages.

### Instructions
```tsx
// StatusBadge
const statusConfig = {
  pending:        { label: 'Pending',      className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  in_progress:    { label: 'In Progress',  className: 'bg-blue-100 text-blue-800 border-blue-200' },
  completed:      { label: 'Completed',    className: 'bg-green-100 text-green-800 border-green-200' },
  overdue:        { label: 'Overdue',      className: 'bg-red-100 text-red-800 border-red-200' },
  not_applicable: { label: 'N/A',          className: 'bg-gray-100 text-gray-600 border-gray-200' },
  draft:          { label: 'Draft',        className: 'bg-slate-100 text-slate-600 border-slate-200' },
}

// PriorityBadge
const priorityConfig = {
  low:      { label: 'Low',      className: 'bg-gray-100 text-gray-600' },
  medium:   { label: 'Medium',   className: 'bg-blue-100 text-blue-700' },
  high:     { label: 'High',     className: 'bg-orange-100 text-orange-700' },
  critical: { label: 'Critical', className: 'bg-red-100 text-red-700 font-semibold' },
}
```

### Completion Fields
- **Completed:** —
- **Date/Time:** —
- **Completed By:** —
- **Comments:** —

---

## TASK-007C — Build ComplianceChart Component

| Field | Value |
|---|---|
| **Task ID** | TASK-007C |
| **Priority** | 🟠 High |
| **Status** | 🔲 Pending |
| **Path** | `src/components/ui/compliance-chart.tsx` |

### Current State
Dashboard page has an inline `recharts` BarChart. It needs to be extracted as a reusable component for both Dashboard and Reports pages.

### What to Do
Extract the bar chart into a standalone `ComplianceChart` component.

### Instructions
```tsx
'use client'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'

interface DeptData {
  name: string
  overdue: number
  pending: number
  safe: number
}

export function ComplianceChart({ data }: { data: DeptData[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip />
        <Legend />
        <Bar dataKey="overdue" fill="#EF4444" name="Overdue" radius={[4,4,0,0]} />
        <Bar dataKey="pending" fill="#F5820A" name="Pending" radius={[4,4,0,0]} />
        <Bar dataKey="safe"    fill="#0E7C6E" name="Completed" radius={[4,4,0,0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
```

### Completion Fields
- **Completed:** —
- **Date/Time:** —
- **Completed By:** —
- **Comments:** —

---

## TASK-007D — Build DataTable Component

| Field | Value |
|---|---|
| **Task ID** | TASK-007D |
| **Priority** | 🟡 Medium |
| **Status** | 🔲 Pending |
| **Path** | `src/components/ui/data-table.tsx` |

### What to Do
Reusable table using `@tanstack/react-table` (already installed).

### Instructions
```tsx
'use client'
import {
  useReactTable, getCoreRowModel, getFilteredRowModel,
  getPaginationRowModel, getSortedRowModel, flexRender,
  ColumnDef,
} from '@tanstack/react-table'

// Generic DataTable<TData, TValue>
// Props: columns: ColumnDef<TData, TValue>[], data: TData[], searchKey?: string
// Features: search input (client-side filter), sort on header click,
//           pagination (10 rows/page), row count "Showing X of Y"
// Uses: Table, TableHead, TableBody, TableCell, Input, Button from @/components/ui
```

### Completion Fields
- **Completed:** —
- **Date/Time:** —
- **Completed By:** —
- **Comments:** —

---

---

# BLOCK E — Pages

---

## TASK-008 — Dashboard Page: already built ✅ (needs data after seed)

| Field | Value |
|---|---|
| **Task ID** | TASK-008 |
| **Status** | ✅ Completed (page built — data pending seed) |
| **Path** | `src/app/(app)/dashboard/page.tsx` |

### Completion Fields
- **Completed:** Yes — dashboard page exists with KPI cards, recharts bar chart, upcoming deadlines table, recent activity feed. All data fetched from `GET /api/compliance/stats`.
- **Date/Time:** Before 2026-06-28 (Z.ai prior session)
- **Completed By:** Z.ai / Claude Code
- **Comments:** Will show zeros until TASK-003 (seed) is run. Once seed is done, all charts and cards populate automatically. No code changes needed.

---

## TASK-009 — Build Checklists List Page

| Field | Value |
|---|---|
| **Task ID** | TASK-009 |
| **Priority** | 🟠 High |
| **Status** | 🔲 Pending |
| **Path** | `src/app/(app)/checklists/page.tsx` |
| **Depends On** | TASK-003 (seed data), TASK-007B, TASK-007D |

### What to Do
Create a new page at `/checklists` listing compliance items grouped as checklists. Does not exist yet (returns 404).

### API to Call
`GET /api/compliance` — returns paginated compliance items with department + assignee

### Page Layout
```
Page heading: "Checklists"
Subheading: "Track all compliance obligations by category"

Filter row:
  - Search input (calls API with ?search=)
  - Status dropdown: All / Pending / In Progress / Completed / Overdue
  - Type dropdown: All / GST / TDS / MCA / PF / ESIC / ROC / LABOUR / ENVIRONMENTAL

DataTable columns:
  1. Title (clickable → /checklists/[id])
  2. Type (GST / TDS / etc. badge)
  3. Status (StatusBadge)
  4. Priority (PriorityBadge)
  5. Department
  6. Due Date (red text if overdue)
  7. Assigned To

Pagination: 20 items/page
```

### Completion Fields
- **Completed:** —
- **Date/Time:** —
- **Completed By:** —
- **Comments:** —

---

## TASK-010 — Build Checklist Detail Page

| Field | Value |
|---|---|
| **Task ID** | TASK-010 |
| **Priority** | 🟡 Medium |
| **Status** | 🔲 Pending |
| **Path** | `src/app/(app)/checklists/[id]/page.tsx` |
| **Depends On** | TASK-009 |

### What to Do
Detail view for a single compliance item showing audit points as a checklist. The `/compliance/[id]` page already exists — this is a checklist-focused view of the same data.

### API to Call
`GET /api/compliance/[id]` — returns `{ item, auditPoints, documents, comments, auditLogs }`

### Page Layout
```
Back button → /checklists

Header card:
  Title (large, DM Serif Display)
  StatusBadge + PriorityBadge + ComplianceType tag
  Due date + Department + Assigned To

Audit Points section:
  Title: "Checklist Items ([n] items)"
  Each audit point as a row:
    [ ] Checkbox — on check: PATCH /api/compliance/[id] to update auditPoint status
    Title text
    Due date chip
    Assigned To name

Documents section:
  List of docs: name, fileType, fileSize, uploaded by, date
  Download link per doc

Comments section:
  List: avatar initials + name + timestamp + content
  (No add-comment UI needed for now)

Activity Log section:
  Timeline of auditLogs entries: action badge + details + user + time
```

### Completion Fields
- **Completed:** —
- **Date/Time:** —
- **Completed By:** —
- **Comments:** —

---

## TASK-011 — Build Tasks Page

| Field | Value |
|---|---|
| **Task ID** | TASK-011 |
| **Priority** | 🟠 High |
| **Status** | 🔲 Pending |
| **Path** | `src/app/(app)/tasks/page.tsx` |
| **Depends On** | TASK-003, TASK-007B |

### What to Do
Create a Kanban-style task board at `/tasks`. Does not exist yet.

### API to Call
`GET /api/compliance` called 3 times with `?status=pending`, `?status=in_progress`, `?status=completed`

### Page Layout
```
Page heading: "Tasks"
3 column Kanban board:

Column 1 — TO DO (pending items)
Column 2 — IN PROGRESS (in_progress items)
Column 3 — DONE (completed items, last 10 only)

Each task card:
  ComplianceType badge (GST / TDS / etc.)
  Title (font-medium)
  PriorityBadge
  Due date (format: "Jun 30" — red if past today)
  Department chip
  Assigned To: avatar initials circle + name

Status bar at top of each column: item count badge
```
Note: Use `framer-motion` for card hover animation (already installed). Full drag-and-drop is optional — static layout is acceptable.

### Completion Fields
- **Completed:** —
- **Date/Time:** —
- **Completed By:** —
- **Comments:** —

---

## TASK-012 — Build Reports Page

| Field | Value |
|---|---|
| **Task ID** | TASK-012 |
| **Priority** | 🟡 Medium |
| **Status** | 🔲 Pending |
| **Path** | `src/app/(app)/reports/page.tsx` |
| **Depends On** | TASK-003, TASK-007C |

### What to Do
Create a reports/analytics page at `/reports`. Does not exist yet.

### API to Call
- `GET /api/compliance/stats` — KPI + chart data
- `GET /api/compliance?limit=100` — full table for export

### Page Layout
```
Page heading: "Reports & Analytics"

Row 1 — 3 KPI summary cards:
  Total Items | Overdue (n, % of total) | Completion Rate (%)

Row 2 — 2 column chart section:
  Left (50%): Status Donut Chart (recharts PieChart)
    6 slices: pending/in_progress/completed/overdue/not_applicable/draft
    Colors: #F59E0B / #3B82F6 / #10B981 / #EF4444 / #9CA3AF / #64748B
    Center label: total count

  Right (50%): Department Bar Chart (ComplianceChart component from TASK-007C)

Row 3 — Full compliance table (DataTable from TASK-007D, all columns)

Row 4 — Export button:
  "Export CSV" button → client-side: build CSV string from table data → Blob → download
```

### Completion Fields
- **Completed:** —
- **Date/Time:** —
- **Completed By:** —
- **Comments:** —

---

## TASK-013 — Build Penalty Tracker Page

| Field | Value |
|---|---|
| **Task ID** | TASK-013 |
| **Priority** | 🟡 Medium |
| **Status** | 🔲 Pending |
| **Path** | `src/app/(app)/penalties/page.tsx` |
| **Depends On** | TASK-003 |

### What to Do
Create a penalty calculator page at `/penalties`. Does not exist yet. All calculation is client-side — no new API needed.

### API to Call
`GET /api/compliance?status=overdue` — to show list of overdue items

### Page Layout
```
Page heading: "Penalty Tracker"
Subheading: "Calculate interest and penalties for overdue compliance filings"

Section 1 — Overdue Items (table):
  Source: GET /api/compliance?status=overdue
  Columns: Title | Type | Due Date | Days Overdue (calculated) | Est. Penalty (₹, calculated)

Section 2 — Manual Calculator:
  Input panel (Card):
    - Compliance Type (Select: GST / TDS / PF / ESIC / MCA / INCOME_TAX / OTHER)
    - Due Date (date input)
    - Payment Date (date input, default today)
    - Tax / Liability Amount (₹) (number input)
  Output panel (Card, updates on input change):
    - Days Overdue
    - Applicable Interest Rate (% p.a.)
    - Interest Amount (₹)
    - Penalty Amount (₹)
    - Total Liability (₹)
```

Penalty rates to hardcode:
```ts
const penaltyRates = {
  GST:         { interestPa: 18, penaltyPerDay: 200, penaltyMax: 5000 },
  TDS:         { interestPerMonth: 1.5, penaltyPerMonth: 1.5 },
  PF:          { damagesPa: 12 },
  ESIC:        { interestPa: 12 },
  MCA:         { penaltyPerDay: 100, penaltyMax: 100000 },
  INCOME_TAX:  { interestPerMonth: 1 },
  default:     { interestPa: 18 },
}
```

### Completion Fields
- **Completed:** —
- **Date/Time:** —
- **Completed By:** —
- **Comments:** —

---

## TASK-014 — Build Team Page

| Field | Value |
|---|---|
| **Task ID** | TASK-014 |
| **Priority** | 🟡 Medium |
| **Status** | 🔲 Pending |
| **Path** | `src/app/(app)/team/page.tsx` |
| **Depends On** | TASK-003 |

### What to Do
Create a team members page at `/team`. The `/users` page already exists as a table — this is a card grid view.

### API to Call
`GET /api/users`

### Page Layout
```
Page heading: "Team"
Subtitle: "[n] members across [n] departments"

3-column grid (desktop), 2-col (tablet), 1-col (mobile):

Each member card:
  Top: Avatar circle (initials from name, navy background)
  Name (font-medium, DM Serif Display)
  Email (text-sm text-muted)
  Role badge:
    admin    → bg-[#1C2B3A] text-white
    manager  → bg-[#F5820A] text-white
    member   → bg-[#0E7C6E] text-white
    viewer   → bg-gray-200 text-gray-700
  Department chip
  Status dot: green (isActive=true) / gray (isActive=false)
  Last active: formatted relative time (e.g. "2 days ago")
```

### Completion Fields
- **Completed:** —
- **Date/Time:** —
- **Completed By:** —
- **Comments:** —

---

---

# BLOCK F — Quality & Deployment

---

## TASK-015 — Full Build Verification

| Field | Value |
|---|---|
| **Task ID** | TASK-015 |
| **Priority** | 🔴 Critical |
| **Status** | 🔲 Pending |
| **Path** | repo root |
| **Depends On** | All BLOCK C, D, E tasks complete |

### What to Do
Run full Next.js build. Fix all TypeScript and ESLint errors.

### Instructions
```bash
bun run lint          # must show 0 errors
bunx tsc --noEmit     # must show 0 errors
bun run build         # must complete successfully
```

Common errors to watch:
- `'use client'` missing on components with `useState`, `useEffect`, `useRouter`, `usePathname`
- `recharts` components need `'use client'`
- Unused imports fail ESLint
- `date-fns`: use named imports `import { format, formatDistanceToNow } from 'date-fns'`
- `@/` path alias: verify `tsconfig.json` has `"paths": { "@/*": ["./src/*"] }`

### Completion Fields
- **Completed:** —
- **Date/Time:** —
- **Completed By:** —
- **Comments:** —

---

## TASK-016 — Commit, Push PR & Verify Vercel Deployment

| Field | Value |
|---|---|
| **Task ID** | TASK-016 |
| **Priority** | 🔴 Critical |
| **Status** | 🔲 Pending |
| **Path** | repo root |
| **Depends On** | TASK-015 |

### What to Do
Push all new files, open a PR, and verify all 10 routes load in Vercel production.

### Instructions
```bash
git checkout -b feat/ui-pages-integration
git add src/components/ src/app/
git commit -m "feat: add 6 pages, shell components, UI components — tasks/reports/penalties/team/checklists"
git push origin feat/ui-pages-integration
gh pr create --title "feat: UI pages integration — checklists, tasks, reports, penalties, team" --base main
```

After Vercel deploys, test these URLs in production:
- `/dashboard` ← already built, check charts show data
- `/compliance` ← already built, check table loads
- `/compliance/[id]` ← already built, check detail renders
- `/checklists` ← NEW — must show list
- `/checklists/[id]` ← NEW — must show audit points
- `/tasks` ← NEW — must show kanban board
- `/reports` ← NEW — must show charts
- `/penalties` ← NEW — calculator must work
- `/team` ← NEW — must show 7 member cards
- `/departments` ← already built
- `/settings` ← already built

Vercel project: https://vercel.com/meet-track-s-projects/compliance-tracker

### Completion Fields
- **Completed:** —
- **Date/Time:** —
- **Completed By:** —
- **Comments:** —

---

---

# Progress Summary

| Block | Tasks | ✅ Completed | 🔲 Pending |
|---|---|---|---|
| A — Database | TASK-001 to TASK-003 | 0 | 3 |
| B — Layout & Nav | TASK-004 to TASK-005 | 0 | 2 |
| C — Shell Components | TASK-006A to TASK-006E | **3** (006A, 006B, 006E) | 2 (006C, 006D) |
| D — UI Components | TASK-007A to TASK-007D | 0 | 4 |
| E — Pages | TASK-008 to TASK-014 | **1** (008 — Dashboard) | 6 |
| F — Quality | TASK-015 to TASK-016 | 0 | 2 |
| **TOTAL** | **23 tasks** | **4 ✅** | **19 🔲** |

---

## What Z.ai Already Built (before this session)

The following was found on `main` from a prior Z.ai / Claude Code session:

| Item | File | Status |
|---|---|---|
| App shell with sidebar + topbar | `AppShell.tsx`, `AppSidebar.tsx`, `AppTopbar.tsx` | ✅ Done |
| Brand design tokens (navy/saffron/teal/cream) | `src/app/globals.css` | ✅ Done |
| ThemeProvider (dark mode) | `src/app/layout.tsx` | ✅ Done |
| Inter font via next/font | `src/app/layout.tsx` | ✅ Done |
| Dashboard page with charts | `src/app/(app)/dashboard/page.tsx` | ✅ Done |
| Compliance list + detail pages | `src/app/(app)/compliance/` | ✅ Done |
| Departments list + detail pages | `src/app/(app)/departments/` | ✅ Done |
| Users list page | `src/app/(app)/users/page.tsx` | ✅ Done |
| Audit trail page | `src/app/(app)/audit/page.tsx` | ✅ Done |
| Settings page | `src/app/(app)/settings/page.tsx` | ✅ Done |
| All shadcn/ui base components | `src/components/ui/` | ✅ Done |

---

*Last updated: 2026-06-28 18:30 UTC by Claude Sonnet 4.6 — audit of actual repo state vs task list*
