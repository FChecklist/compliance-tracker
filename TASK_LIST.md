# ComplianceTrack — Agent Task List

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
> This PR contains the Prisma→Drizzle migration. All tasks below depend on it being on `main`.

---

---

# BLOCK A — Database & Infrastructure

---

## TASK-001 — Merge PR #34 (Prisma → Drizzle migration)

| Field | Value |
|---|---|
| **Task ID** | TASK-001 |
| **Priority** | 🔴 Critical — all other tasks depend on this |
| **Status** | 🔲 Pending |
| **Path** | https://github.com/FChecklist/compliance-tracker/pull/34 |

### What to Do
Merge the open PR #34 (`feat/prisma-to-drizzle` → `main`). This PR contains:
- Drizzle ORM schema (`src/lib/db/schema.ts`)
- Drizzle client (`src/lib/db/index.ts`)
- Drizzle config (`drizzle.config.ts`)
- All 9 API routes converted from Prisma to Drizzle
- Seed script (`src/db/seed.ts`)
- Updated `package.json` (drizzle deps, prisma removed)

### Why
Nothing else works until this is merged. All existing API routes use Prisma which points to SQLite. After merge they use Drizzle pointing to Supabase PostgreSQL.

### Instructions
```
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
| **Depends On** | TASK-001 |

### What to Do
Run the Drizzle schema push to create the `compliance` pgSchema and all 9 tables in Supabase.

### Why
The database tables don't exist yet. No API route will work until the tables are created.

### Instructions
```bash
# Set env var first (use the pooler URL)
export DATABASE_URL="postgresql://postgres.jusqumifsmtcaujqyjuy:[DB_PASSWORD]@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require"

# Run from repo root
bun db:push
```

Expected output: Drizzle logs showing each table created inside the `compliance` schema.

Tables that must be created:
- `compliance.organisations`
- `compliance.departments`
- `compliance.users`
- `compliance.compliance_items`
- `compliance.audit_points`
- `compliance.documents`
- `compliance.comments`
- `compliance.notifications`
- `compliance.audit_logs`

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
Execute the seed script to populate Supabase with demo data so all pages render with real content.

### Why
Without seed data, all pages show empty states and charts show zeros. Demo data makes the app usable for review.

### Instructions
```bash
export DATABASE_URL="postgresql://postgres.jusqumifsmtcaujqyjuy:[DB_PASSWORD]@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require"
bun db:seed
```

Expected seed output:
- 1 Organisation: Acme Corp (plan: pro)
- 4 Departments: Finance, Legal, Operations, HR
- 7 Users: admin@acme.com, manager.finance@acme.com, manager.legal@acme.com, member.ops@acme.com, member.hr@acme.com, member.finance@acme.com, viewer@acme.com
- 18 Compliance Items (mix of GST/TDS/MCA/PF/ESIC/ROC/LABOUR/ENVIRONMENTAL)
- 36 Audit Points (2 per item)
- 36 Comments (2 per item)
- 18 Documents (1 per item)
- 10 Notifications (for admin user)
- 20 Audit Logs

All user passwords: `Test@1234` (bcrypt hashed in DB)

### Completion Fields
- **Completed:** —
- **Date/Time:** —
- **Completed By:** —
- **Comments:** —

---

---

# BLOCK B — Layout & Design System

---

## TASK-004 — Update Root Layout with Fonts + ThemeProvider

| Field | Value |
|---|---|
| **Task ID** | TASK-004 |
| **Priority** | 🟠 High |
| **Status** | 🔲 Pending |
| **Path** | `src/app/layout.tsx` |
| **Depends On** | TASK-001 |

### What to Do
Update the root Next.js layout to add Google Fonts and dark mode support.

### Why
The app currently uses default fonts. The design system requires DM Serif Display for headings and Inter for body. Dark mode requires NextThemesProvider.

### Instructions
```tsx
// src/app/layout.tsx
import { DM_Serif_Display, Inter } from 'next/font/google'
import { ThemeProvider } from 'next-themes'

const dmSerifDisplay = DM_Serif_Display({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-heading',
})

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
})

// Wrap children in ThemeProvider:
<ThemeProvider attribute="class" defaultTheme="light" enableSystem>
  <body className={`${inter.variable} ${dmSerifDisplay.variable} font-sans`}>
    {children}
  </body>
</ThemeProvider>
```

Add to `src/app/globals.css`:
```css
:root {
  --font-heading: 'DM Serif Display', serif;
  --font-body: 'Inter', sans-serif;
}
h1, h2, h3 { font-family: var(--font-heading); }
body { font-family: var(--font-body); }
```

### Completion Fields
- **Completed:** —
- **Date/Time:** —
- **Completed By:** —
- **Comments:** —

---

## TASK-005 — Update App Shell Layout with Sidebar + Header

| Field | Value |
|---|---|
| **Task ID** | TASK-005 |
| **Priority** | 🟠 High |
| **Status** | 🔲 Pending |
| **Path** | `src/app/(app)/layout.tsx` |
| **Depends On** | TASK-006 (shell components must exist first) |

### What to Do
Update the `(app)` route group layout to wrap all pages in the NavSidebar + Header shell.

### Why
All app pages (dashboard, compliance, etc.) need a consistent sidebar and header. Currently the layout may not have these wired up with the design system colors.

### Instructions
```tsx
// src/app/(app)/layout.tsx
import { NavSidebar } from '@/components/nav-sidebar'
import { Header } from '@/components/header'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-[#FFFDF9] dark:bg-gray-950">
      <NavSidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
```

### Completion Fields
- **Completed:** —
- **Date/Time:** —
- **Completed By:** —
- **Comments:** —

---

---

# BLOCK C — Shell Components

---

## TASK-006A — Build NavSidebar Component

| Field | Value |
|---|---|
| **Task ID** | TASK-006A |
| **Priority** | 🟠 High |
| **Status** | 🔲 Pending |
| **Path** | `src/components/nav-sidebar.tsx` |
| **Depends On** | TASK-001 |

### What to Do
Create a vertical navigation sidebar with all app routes.

### Why
Users need a persistent way to navigate between all 10 sections of the app. Currently the sidebar (AppSidebar.tsx) may not have the correct routes or design system colors.

### Instructions
Navigation links required (in order):
1. Dashboard → `/dashboard` — icon: `LayoutDashboard`
2. Compliance → `/compliance` — icon: `Shield`
3. Checklists → `/checklists` — icon: `CheckSquare`
4. Tasks → `/tasks` — icon: `ListTodo`
5. Reports → `/reports` — icon: `BarChart3`
6. Penalty Tracker → `/penalties` — icon: `AlertCircle`
7. Team → `/team` — icon: `Users`
8. Departments → `/departments` — icon: `Building2`
9. Settings → `/settings` — icon: `Settings`

Design:
- Sidebar background: `bg-[#1C2B3A]` (navy)
- Logo at top: "ComplianceTrack" text in white + saffron icon
- Active link: `bg-[#F5820A]/20 text-[#F5820A]` (saffron tint)
- Inactive link: `text-gray-300 hover:text-white hover:bg-white/10`
- Sidebar width: `w-64` on desktop, collapsible on mobile via Sheet
- All icons from `lucide-react`

### Completion Fields
- **Completed:** —
- **Date/Time:** —
- **Completed By:** —
- **Comments:** —

---

## TASK-006B — Build Header Component

| Field | Value |
|---|---|
| **Task ID** | TASK-006B |
| **Priority** | 🟠 High |
| **Status** | 🔲 Pending |
| **Path** | `src/components/header.tsx` |
| **Depends On** | TASK-006C, TASK-006D, TASK-006E |

### What to Do
Create a top bar that displays on every page inside the app shell.

### Why
Users need quick access to search, notifications, and their profile from any page.

### Instructions
Header must contain (left to right):
1. Page title (dynamic, based on current route — use `usePathname()`)
2. Spacer
3. Search button → opens `SearchCommand` component on click or Ctrl+K
4. Notification bell icon (`Bell` from lucide) → shows unread count badge from `GET /api/notifications`
5. ThemeToggle component
6. UserMenu component

Design:
- Height: `h-16`
- Background: `bg-white dark:bg-gray-900 border-b border-gray-200`
- Title: font-heading (DM Serif Display), text-[#1C2B3A]

### Completion Fields
- **Completed:** —
- **Date/Time:** —
- **Completed By:** —
- **Comments:** —

---

## TASK-006C — Build SearchCommand Component

| Field | Value |
|---|---|
| **Task ID** | TASK-006C |
| **Priority** | 🟡 Medium |
| **Status** | 🔲 Pending |
| **Path** | `src/components/search-command.tsx` |
| **Depends On** | TASK-001 |

### What to Do
Build a command palette (Cmd+K / Ctrl+K) that searches compliance items.

### Why
Power users need fast keyboard navigation. cmdk is already installed.

### Instructions
```tsx
// Use Dialog + Command from cmdk
// On input change: fetch('/api/compliance?search=' + query)
// Show results grouped by status
// Click result → navigate to /compliance/[id]
// Keyboard shortcut: useEffect listening for Ctrl+K / Cmd+K
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
| **Depends On** | TASK-004 |

### What to Do
Build a button that toggles between light and dark mode.

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
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  )
}
```

### Completion Fields
- **Completed:** —
- **Date/Time:** —
- **Completed By:** —
- **Comments:** —

---

## TASK-006E — Build UserMenu Component

| Field | Value |
|---|---|
| **Task ID** | TASK-006E |
| **Priority** | 🟡 Medium |
| **Status** | 🔲 Pending |
| **Path** | `src/components/user-menu.tsx` |
| **Depends On** | TASK-001 |

### What to Do
Build a user avatar dropdown showing name, role, and logout option.

### Instructions
- Avatar: show initials if no avatarUrl
- Dropdown items: Profile, Settings (links to /settings), Logout (placeholder alert)
- Hardcode admin@acme.com for now (auth system not built yet)
- Use `DropdownMenu` from `@/components/ui/dropdown-menu`

### Completion Fields
- **Completed:** —
- **Date/Time:** —
- **Completed By:** —
- **Comments:** —

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

### What to Do
KPI stat card used on the dashboard.

### Instructions
Props interface:
```tsx
interface DashboardCardProps {
  title: string
  value: number | string
  change?: string        // e.g. "+12% from last month"
  icon: LucideIcon
  variant: 'total' | 'overdue' | 'pending' | 'completed'
}
```
Variant colors:
- `total` → border-[#1C2B3A], icon bg-[#1C2B3A]/10
- `overdue` → border-red-500, icon bg-red-100
- `pending` → border-yellow-500, icon bg-yellow-100
- `completed` → border-[#0E7C6E], icon bg-[#0E7C6E]/10

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

### What to Do
Colored badge for compliance item status.

### Instructions
```tsx
const statusConfig = {
  pending:        { label: 'Pending',        className: 'bg-yellow-100 text-yellow-800' },
  in_progress:    { label: 'In Progress',    className: 'bg-blue-100 text-blue-800' },
  completed:      { label: 'Completed',      className: 'bg-green-100 text-green-800' },
  overdue:        { label: 'Overdue',        className: 'bg-red-100 text-red-800' },
  not_applicable: { label: 'N/A',            className: 'bg-gray-100 text-gray-600' },
  draft:          { label: 'Draft',          className: 'bg-slate-100 text-slate-600' },
}
```
Also build PriorityBadge with: low (gray), medium (blue), high (orange), critical (red).

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

### What to Do
Grouped bar chart showing compliance health by department.

### Why
Dashboard and Reports page both need this chart. recharts is already installed.

### Instructions
```tsx
// Uses recharts BarChart
// Data shape: { name: string, overdue: number, pending: number, safe: number }[]
// Colors: overdue=#EF4444, pending=#F5820A, safe=#0E7C6E
// Source data from GET /api/compliance/stats → byDepartment array
// Must be 'use client' (recharts needs browser)
// Responsive via ResponsiveContainer width="100%" height={300}
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
Reusable table component using @tanstack/react-table.

### Instructions
- Generic `DataTable<TData, TValue>` component
- Props: `columns`, `data`, `searchKey?` (column to filter by)
- Built-in: search input above table, pagination (Previous/Next), row count display
- Sortable columns via column header click
- Uses existing `Table`, `Input`, `Button` from shadcn/ui

### Completion Fields
- **Completed:** —
- **Date/Time:** —
- **Completed By:** —
- **Comments:** —

---

---

# BLOCK E — Pages

---

## TASK-008 — Enhance Dashboard Page

| Field | Value |
|---|---|
| **Task ID** | TASK-008 |
| **Priority** | 🔴 Critical |
| **Status** | 🔲 Pending |
| **Path** | `src/app/(app)/dashboard/page.tsx` |
| **Depends On** | TASK-003, TASK-007A, TASK-007C |

### What to Do
Replace or enhance the current dashboard page to show live data from the API.

### Why
This is the first page users see. It must show real KPI numbers and charts.

### API to Call
`GET /api/compliance/stats`

Response shape:
```json
{
  "total": 18,
  "overdue": 3,
  "dueThisWeek": 4,
  "completed": 5,
  "dueIn30Days": 6,
  "safe": 5,
  "byDepartment": [{ "name": "Finance", "total": 6, "overdue": 1, "pending": 3, "safe": 2 }],
  "upcomingDeadlines": [{ "id": "...", "title": "...", "department": "...", "dueDate": "...", "assignedTo": "...", "status": "..." }],
  "recentActivity": [{ "id": "...", "action": "...", "details": "...", "userName": "...", "createdAt": "..." }]
}
```

### Page Layout
```
Row 1: 4 KPI Cards (DashboardCard)
  - Total Compliance Items (total, variant=total, icon=Shield)
  - Overdue Items (overdue, variant=overdue, icon=AlertCircle)
  - Due This Week (dueThisWeek, variant=pending, icon=Clock)
  - Completed (completed, variant=completed, icon=CheckCircle)

Row 2 (2 columns):
  Col 1 (60%): ComplianceChart (byDepartment data)
  Col 2 (40%): Upcoming Deadlines list (upcomingDeadlines, top 5)

Row 3: Recent Activity feed (recentActivity, last 8 entries)
  Each entry: action badge, details text, userName, time ago
```

### Completion Fields
- **Completed:** —
- **Date/Time:** —
- **Completed By:** —
- **Comments:** —

---

## TASK-009 — Build Checklists List Page

| Field | Value |
|---|---|
| **Task ID** | TASK-009 |
| **Priority** | 🟠 High |
| **Status** | 🔲 Pending |
| **Path** | `src/app/(app)/checklists/page.tsx` |
| **Depends On** | TASK-003, TASK-007B, TASK-007D |

### What to Do
Create a new page listing all audit points (checklists) from the database.

### Why
Checklists page does not exist yet. Audit points from the DB serve as checklist items.

### API to Call
`GET /api/compliance` — fetch all compliance items, then show their audit points as checklist items.
Alternatively create `GET /api/audit-points` if needed (create a new route at `src/app/api/audit-points/route.ts`).

### Page Layout
- Page title: "Checklists"
- Filter bar: status dropdown, department dropdown, search input
- DataTable with columns:
  - Checklist Title
  - Parent Compliance Item
  - Status (StatusBadge)
  - Due Date
  - Assigned To
  - Actions (View button → links to /checklists/[id])

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
Detail view for a single compliance item showing all its audit points as a checklist.

### API to Call
`GET /api/compliance/[id]` — returns item with `auditPoints`, `documents`, `comments`

### Page Layout
- Header: compliance item title + StatusBadge + PriorityBadge + due date
- Checklist section: each audit point as a checkbox row
  - Checkbox (clicking calls PATCH /api/compliance/[id] to update status)
  - Title
  - Assigned to
  - Due date
- Documents section: list of attached documents with download links
- Comments section: list of comments with author + timestamp
- Activity log section: audit trail

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
Create a task board showing compliance items as tasks grouped by status.

### Why
Tasks page does not exist. It gives a Kanban-style view of what needs to be done.

### API to Call
`GET /api/compliance` — filter by status for each column

### Page Layout
Option A (Kanban board — preferred):
```
3 columns: TO DO | IN PROGRESS | DONE
Each card shows:
  - Title
  - ComplianceType tag (GST, TDS, etc.)
  - PriorityBadge
  - Due date (red if overdue)
  - Assigned user avatar + name
  - Department name
```
Use `framer-motion` for drag animation (already installed).

Option B (Table view): Use DataTable with status filter tabs.

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
Create a reports/analytics page with multiple charts.

### API to Call
`GET /api/compliance/stats` — all chart data

### Page Layout
```
Row 1: 3 summary cards (total, overdue %, completed %)

Row 2 (2 columns):
  Col 1: Status Donut Chart (recharts PieChart)
    Slices: pending, in_progress, completed, overdue, not_applicable, draft
    Colors: yellow, blue, green, red, gray, slate

  Col 2: Department Bar Chart (ComplianceChart component)

Row 3: Compliance Items table (full list with all columns)

Footer: Export button
  - "Export as CSV" → client-side CSV generation from the table data
  - Use window.URL.createObjectURL + Blob
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
Create a penalty/interest calculator for overdue compliance items.

### Why
Compliance officers need to know the financial impact of overdue filings. No new API needed — calculation is client-side.

### Page Layout
```
Section 1: Overdue Items List
  Source: GET /api/compliance?status=overdue
  Columns: Title, Type, Due Date, Days Overdue, Estimated Penalty

Section 2: Manual Calculator Panel
  Inputs:
    - Compliance Type (dropdown: GST/TDS/MCA/PF/ESIC/etc.)
    - Due Date (date picker)
    - Payment Date (date picker — defaults to today)
    - Tax Amount (number input, in ₹)
  Output (calculated client-side):
    - Days Overdue
    - Applicable Rate (% per month — hardcoded by type)
    - Estimated Interest (₹)
    - Estimated Penalty (₹)
    - Total Liability (₹)
```

Penalty rates (hardcode):
- GST: 18% p.a. interest, ₹200/day penalty (max ₹5000)
- TDS: 1.5% per month interest, 1.5% per month penalty  
- PF: 12% p.a. damages
- ESIC: 12% p.a.
- MCA: ₹100/day (₹1 lakh max)
- Default: 18% p.a.

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
Create a team members page. Note: `/users` already exists — this is a new `/team` route with a card-based layout.

### API to Call
`GET /api/users`

### Page Layout
```
Page title: "Team"
Subtitle: "X members across Y departments"

Grid of member cards (3 cols desktop, 2 tablet, 1 mobile):
Each card:
  - Avatar (initials circle if no avatarUrl)
  - Name (DM Serif Display font)
  - Email
  - Role badge (admin=navy, manager=saffron, member=teal, viewer=gray)
  - Department name
  - Status dot (green=active, gray=inactive)
  - "Last active" timestamp
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
| **Depends On** | All BLOCK C, D, E tasks |

### What to Do
Run the full Next.js build and fix all TypeScript/lint errors before pushing.

### Instructions
```bash
bun run lint          # fix all ESLint errors
bunx tsc --noEmit     # fix all TypeScript errors
bun run build         # must complete with zero errors
```

Common issues to watch:
- Missing `'use client'` on components using hooks or browser APIs
- Import paths using `@/` alias — verify tsconfig paths are correct
- recharts components need `'use client'`
- date-fns import: use `import { format } from 'date-fns'`
- No unused imports (ESLint will fail)

### Completion Fields
- **Completed:** —
- **Date/Time:** —
- **Completed By:** —
- **Comments:** —

---

## TASK-016 — Commit, Push & Verify Vercel Deployment

| Field | Value |
|---|---|
| **Task ID** | TASK-016 |
| **Priority** | 🔴 Critical |
| **Status** | 🔲 Pending |
| **Path** | repo root |
| **Depends On** | TASK-015 |

### What to Do
Commit all changes and push to trigger Vercel deployment. Verify all pages load in production.

### Instructions
```bash
git add src/ drizzle.config.ts package.json
git commit -m "feat: add UI pages, shell components, design system integration"
# Branch protection is ON — create PR:
git checkout -b feat/ui-integration
git push origin feat/ui-integration
gh pr create --title "feat: UI integration — 6 new pages, shell, components" --base main
```

After Vercel deploys, test each URL in production:
- `/dashboard` — KPI cards + charts load
- `/compliance` — table loads with 18 items
- `/compliance/[id]` — detail page renders
- `/checklists` — checklist items show
- `/tasks` — task board renders
- `/reports` — charts render with data
- `/penalties` — calculator works
- `/team` — 7 member cards show
- `/departments` — department list shows
- `/settings` — settings page loads

Vercel project to watch: https://vercel.com/meet-track-s-projects/compliance-tracker

### Completion Fields
- **Completed:** —
- **Date/Time:** —
- **Completed By:** —
- **Comments:** —

---

---

# Progress Summary

| Block | Tasks | Completed | Pending |
|---|---|---|---|
| A — Database | TASK-001 to TASK-003 | 0 | 3 |
| B — Layout | TASK-004 to TASK-005 | 0 | 2 |
| C — Shell Components | TASK-006A to TASK-006E | 0 | 5 |
| D — UI Components | TASK-007A to TASK-007D | 0 | 4 |
| E — Pages | TASK-008 to TASK-014 | 0 | 7 |
| F — Quality | TASK-015 to TASK-016 | 0 | 2 |
| **TOTAL** | **23 tasks** | **0** | **23** |

---

*Last updated: 2026-06-28 by Claude Sonnet 4.6 (session setup)*
