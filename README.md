# ComplianceTrack

> **One Portal. One Truth.**

A multi-tenant SaaS compliance management platform designed for the AI era. Built for accountants, auditors, compliance officers, and organisations of all sizes across all industries and geographies.

---

## Repository Structure

```
compliance-tracker/
├── specs/                          # Complete Project Specifications
│   ├── Compliance_Tracker_Project_Understanding_file_1.json   # Full 20-step spec (180KB) - 18 modules, 69 APIs, 23+ tables
│   ├── Compliance_Tracker_Project_Understanding_file_2.json   # Gap analysis (7.5KB)
│   ├── compliancetrack_landing.html                           # Marketing landing page reference
│   └── compliance_tracker_v3.html                             # App UI v3 prototype reference
├── docs/                           # Technical Documents
│   ├── ComplianceTrack_TechSpec_Complete.docx                 # Complete tech spec (81KB, 103 headings)
│   └── ComplianceTrack_TechSpec_v1.docx                       # Original 24-module tech spec
├── ai-instructions/                 # AI Code Generation Instructions
│   ├── Compliance_Tracker_AI_Instruction_Manual.json          # 48-step build manual (138KB) - HOW TO BUILD THE PROJECT
│   └── compliance_tracker_progress.json                       # Progress tracker (update after each step)
└── README.md
```

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