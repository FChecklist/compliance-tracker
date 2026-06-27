# ComplianceTrack

> **One Portal. One Truth.**

A multi-tenant SaaS compliance management platform designed for the AI era. Built for accountants, auditors, compliance officers, and organisations of all sizes across all industries and geographies.

---

## Project Structure

```
compliance-tracker/
├── apps/
│   ├── web/                     # Next.js 15 web application (App Router)
│   │   ├── app/                 # Route handlers + pages
│   │   │   ├── (auth)/          # Login, register pages
│   │   │   ├── (app)/           # Dashboard, compliance, users, admin, AI, settings
│   │   │   ├── (marketing)/     # Landing page
│   │   │   ├── api/             # 35+ API route handlers
│   │   │   └── onboarding/      # Onboarding wizard
│   │   ├── components/          # AppSidebar, AppTopbar, ErrorBoundary, LoadingSkeleton
│   │   ├── lib/                 # Auth (JWT, RBAC, session, audit), export, realtime
│   │   └── stores/              # Zustand stores (compliance, notifications, UI)
│   └── mobile/                  # Expo Router app (React Native)
│       └── app/                 # 10 mobile screens
├── packages/
│   ├── db/                      # Drizzle ORM schemas + client + migrations
│   ├── types/                   # Shared TypeScript types and enums
│   ├── api-client/              # Shared HTTP client with typed endpoint functions
│   ├── ui/                      # Shared shadcn/ui components (Button, Input, Badge, Card, Spinner)
│   └── config/                  # Shared env validation + constants
├── supabase/
│   └── migrations/              # 5 SQL migrations (core, features, RLS, indexes, onboarding)
├── tests/
│   ├── unit/                    # Vitest unit tests (auth, enums, schemas)
│   └── e2e/                     # Playwright E2E tests (auth, compliance, navigation)
├── specs/                       # Project specifications
├── docs/                        # Technical specification documents
└── ai-instructions/             # AI build manual + progress tracker
```

---

## Local Development Setup

### Prerequisites

- **Node.js** >= 20.0.0
- **pnpm** 9.4.0 (`corepack enable && corepack prepare pnpm@9.4.0 --activate`)
- **Supabase CLI** (`brew install supabase/tap/supabase` or `npm i -g supabase`)
- A **Supabase project** (free tier works)

### 1. Clone and Install

```bash
git clone https://github.com/FChecklist/compliance-tracker.git
cd compliance-tracker
pnpm install
```

### 2. Environment Variables

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

Required variables:

| Variable | Description | Where to Get It |
|----------|-------------|-----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL | Supabase Dashboard → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous (public) key | Supabase Dashboard → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side) | Supabase Dashboard → Settings → API |
| `DATABASE_URL` | PostgreSQL connection string (pooler, port 6543) | Supabase Dashboard → Settings → Database |
| `DIRECT_URL` | PostgreSQL direct connection (port 5432) | Supabase Dashboard → Settings → Database |
| `DB_SCHEMA` | Database schema name | Default: `compliance_tracker` |
| `JWT_SECRET` | 64-character random string for JWT signing | Generate: `openssl rand -hex 32` |
| `NEXT_PUBLIC_APP_URL` | App URL for callbacks | Local: `http://localhost:3000` |
| `ANTHROPIC_API_KEY` | Anthropic Claude API key (AI features) | console.anthropic.com |

### 3. Database Setup

Push the 5 migrations to your Supabase database:

```bash
# Login to Supabase first (one-time)
supabase login

# Link to your project (replace <project-ref>)
supabase link --project-ref <your-project-ref>

# Push all migrations
pnpm db:push
```

This creates all 23+ tables, RLS policies, indexes, and triggers.

### 4. Run Development Server

```bash
pnpm dev
```

This starts the Next.js dev server at `http://localhost:3000` (via Turborepo).

### 5. Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all dev servers (Turborepo) |
| `pnpm build` | Production build (all packages) |
| `pnpm lint` | ESLint across all packages |
| `pnpm typecheck` | TypeScript type checking across all packages |
| `pnpm test` | Run Vitest unit tests |
| `pnpm test:e2e` | Run Playwright E2E tests (requires running server) |
| `pnpm db:push` | Push Drizzle schema changes to Supabase |
| `pnpm db:generate` | Generate Drizzle migrations from schema changes |

---

## How to Build This Project Using AI

### Quick Start (For Claude / GPT / Any AI)

1. **Give the AI these 2 files:**
   - `ai-instructions/Compliance_Tracker_AI_Instruction_Manual.json` (the master instruction manual)
   - `ai-instructions/compliance_tracker_progress.json` (the progress tracker)

2. **Tell the AI:**
   > "Read the AI Instruction Manual and the progress tracker. Check which step is next. Start building from that step. Follow the manual exactly — one step at a time, save after each step."

3. **The AI will:**
   - Check `compliance_tracker_progress.json` to find the next incomplete step
   - Read the relevant sections from the spec files
   - Generate the code for that exact step
   - Save all files to the specified paths
   - Run the verification command
   - Update the progress tracker
   - STOP and wait for you to say "continue"

### After Each Step

The AI updates `compliance_tracker_progress.json` with:
- `status`: pending → in_progress → completed (or blocked)
- `files_created`: list of every file written
- `error_log`: any errors encountered
- `verification_result`: pass / fail / skipped

### If the AI Gets Stuck or Loses Context

Just start a new conversation and say:
> "I'm building ComplianceTrack. Read these files: `ai-instructions/Compliance_Tracker_AI_Instruction_Manual.json` and `ai-instructions/compliance_tracker_progress.json`. Continue from where we left off."

The manual has **context recovery** built in — the AI reads the progress tracker and knows exactly what to do next.

---

## 48-Step Build Overview

| Phase | Steps | What Gets Built |
|-------|-------|----------------|
| **0. Bootstrap** | 1-4 | Monorepo (Turborepo), dependencies, shared TypeScript types, Drizzle ORM schemas (23 tables) |
| **1. Foundation** | 5-10 | 4 SQL migrations, RLS policies, API client, JWT auth, middleware, RBAC |
| **2. Platform** | 11-15 | Next.js 15 layout, 7 auth routes, organisation APIs, permission scoping, departments, user management |
| **3. Core Features** | 16-18 | Compliance CRUD (12 APIs), status/reassign/bulk, audit points, document upload |
| **4. Enhancements** | 19-24 | Audit log, pendency view, notifications/cron, AI engine (7 APIs), MCP endpoint, sales/agents, email |
| **5. Shared UI** | 25-26 | 11 shared components (Button, Input, Badge, Modal...), login/auth pages |
| **6. Web Frontend** | 27-32 | App shell, dashboard, compliance table, detail panel (4 tabs), admin, AI chat |
| **7. Mobile App** | 33-35 | Expo Router app, 7 mobile screens, push notifications, camera capture |
| **8. Integrations** | 36-38 | Export (CSV/Excel/PDF), WhatsApp stub, Google Drive stub, onboarding wizard |
| **9. Testing** | 39-40 | Vitest unit tests, Playwright E2E tests |
| **10. Deploy** | 41-48 | Landing page, Vercel config, GitHub Actions CI/CD, error handling, realtime, final build |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Monorepo** | Turborepo + npm workspaces |
| **Web** | Next.js 15 (App Router) → Vercel |
| **Mobile** | Expo Router (React Native) → Expo EAS |
| **Database** | Supabase (PostgreSQL 15) |
| **ORM** | Drizzle ORM |
| **Auth** | Supabase Auth + custom passcode/magic-link |
| **UI** | shadcn/ui + Tailwind CSS 4 |
| **State** | Zustand + TanStack Query |
| **AI** | Anthropic Claude via Vercel AI SDK |
| **Email** | Resend |
| **CI/CD** | GitHub Actions → Vercel |

---

## Key Specs (from the JSON files)

- **18 Modules** (M01-M18): Database, Auth, Multi-Tenancy, RBAC, Compliance Engine, Audit Points, Departments, Users, Audit Trail, Documents, Notifications, AI Engine, API/MCP, Sales/Agents, Web UI, Mobile UI, Email, Infrastructure
- **69 API Endpoints** across all modules
- **23+ Database Tables** with Row Level Security
- **4-Tier RBAC**: Account Admin → Dept Admin → Editor → Viewer
- **8 Pendency Buckets**: Delayed, 24h, 7d, 30d, 60d, 90d, 180d, 365d
- **10 Touchpoints**: Human laptop/mobile, AI-assisted, AI direct, email, Google Drive, MCP/API
- **8 Sales Channels**: Freelance agents, AI agents, company resellers, ads, telesales, firms, individuals, enterprise
- **Pricing**: Single Entity ₹30,000 (one-time) | Multi-Client ₹30,000 + ₹3,000/client

---

## Anti-Loop System

The AI Instruction Manual includes built-in safeguards:
- **Progress tracker** checked before every step — AI never repeats completed work
- **Max 3 retries** per step — auto-blocks and moves on after 3 failures
- **Checkpoint every 5 steps** — saves full progress snapshot
- **One step at a time** — AI must complete, verify, save, then STOP

---

## Design System

| Token | Value | Usage |
|-------|-------|-------|
| Cream | `#FFFDF9` | Background |
| Navy | `#1C2B3A` | Primary text, sidebar |
| Saffron | `#F5820A` | Accent, CTAs |
| Teal | `#0E7C6E` | Success, active states |
| Red | `#C0392B` | Danger, overdue |
| Green | `#16A34A` | Completed |
| Heading Font | DM Serif Display | |
| Body Font | Inter | |

---

## Deployment Targets

- **Web**: [Vercel](https://vercel.com) (auto-deploy on merge to `main`)
- **Database**: [Supabase](https://supabase.com) (PostgreSQL + Auth + Storage + Realtime)
- **Mobile**: [Expo EAS](https://expo.dev) (iOS + Android)
- **CI/CD**: GitHub Actions (lint → test → build → deploy)