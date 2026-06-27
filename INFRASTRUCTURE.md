# ComplianceTrack — Infrastructure

## Supabase (Database)
- **Host project**: MeetTrack (`jusqumifsmtcaujqyjuy`)
- **URL**: https://jusqumifsmtcaujqyjuy.supabase.co
- **Schema**: `compliance_tracker` (isolated from MeetTrack's `public` schema)
- **Region**: ap-south-1 (Mumbai)
- **Tables**: 13 tables — all with RLS enabled, service_role bypass
- **Migrations applied**: 001–005 (core tables, feature tables, RLS, indexes/triggers, onboarding fields)

### Schema Isolation
ComplianceTrack lives in its own PostgreSQL schema `compliance_tracker` inside the MeetTrack Supabase project.
MeetTrack uses the `public` schema — zero overlap, zero interference.

| Schema | Project | Tables |
|---|---|---|
| `public` | MeetTrack | users, meetings, action_items, ... |
| `compliance_tracker` | **ComplianceTrack** | organisations, users, compliance, ... |

## Vercel (Hosting)
- **Project**: `compliance-tracker`
- **Project ID**: `prj_80z9Rz3BYvvExvGXyt5LNoPPMgiZ`
- **Team**: MeetTrack's projects (`team_Iqx3zyb7sDdsdzcNskCFFsHD`)
- **URL**: https://compliance-tracker.vercel.app
- **Root directory**: `apps/web`
- **Build command**: `cd ../.. && pnpm turbo build --filter=web`
- **GitHub**: Auto-deploy on push to `main`
- **First deployment**: `dpl_EW3hPrshjktccvDpw61p9Y4BesB3` (INITIALIZING)

## Environment Variables (set on Vercel)
| Variable | Scope |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public |
| `SUPABASE_SERVICE_ROLE_KEY` | encrypted |
| `DATABASE_URL` | encrypted (pooler port 6543) |
| `DIRECT_URL` | encrypted (direct port 5432) |
| `JWT_SECRET` | encrypted |
| `DB_SCHEMA` | `compliance_tracker` |
| `NEXT_PUBLIC_APP_URL` | https://compliance-tracker.vercel.app |

## Local Development
```bash
# Clone and install
git clone https://github.com/FChecklist/compliance-tracker
cd compliance-tracker
pnpm install

# Copy env
cp .env.example .env.local
# Fill in DATABASE_URL, JWT_SECRET from Vercel dashboard

# Run dev server
pnpm dev
# Opens: http://localhost:3000

# Run tests
pnpm test              # unit tests (vitest)
pnpm playwright test   # e2e tests
```