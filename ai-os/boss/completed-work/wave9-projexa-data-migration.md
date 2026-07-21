# Wave 9: PROJEXA org/user/credential data migration

Part of the VERIDIAN/PROJEXA brand-layer merge (10-wave plan; see the 2026-07-21
"CRM completion + VERIDIAN/PROJEXA brand-layer merge" entry in
`ai-os/boss/ACTIVE-CLAIMS.yaml` for the full plan). Owner gave explicit sign-off
to proceed with Waves 9+10 this session, and separately confirmed (when asked
to weigh in on a finding) that all of PROJEXA's current data is synthetic
test/demo/QA fixture data, not real paying customers.

Migrated PROJEXA's own org/user data (Supabase project `evpckeuxgvahguwsaeul`)
into compliance-tracker's schema (Supabase project `pcrjmlpuqsbocqfwoxod`),
data-only -- no schema/DDL changes. Script: `scripts/wave9-projexa-data-migration.sql`.

## Two corrections to this wave's original brief

1. **Schema location.** The brief assumed `organizations`/`users` lived in the
   `public` schema on `pcrjmlpuqsbocqfwoxod`. Live inspection
   (`list_tables`/`information_schema.schemata`) showed `public` only holds 4
   marketing-site tables (`brand_assets`, `stage0_submissions`, `inquiries`,
   `email_subscribers`); the real ~250-migration Drizzle-managed app schema
   lives in the `compliance` and `platform` schemas (confirmed via
   `drizzle.config.ts`'s `schemaFilter: ['compliance']`). All work below
   targets `compliance.organisations` / `compliance.users` /
   `compliance.departments` / `compliance.org_product_branch_enablements` and
   `platform.product_branches`.

2. **Product branch.** The brief said the `pms` branch
   (`a4e6147d-8e4b-434a-954b-821d3686c1c5`) is "the PROJEXA product branch."
   Live evidence contradicts this: `POST /api/v1/platform/provision-org`
   (`src/app/api/v1/platform/provision-org/route.ts`) provisions new PROJEXA
   customer orgs by looking up `platform_applications.applicationKey =
   'projexa'` and tagging the new org's `primaryProductBranchId` with the
   **`projexa`** branch (`5fceebcd-0a7a-4448-ae2b-a72637124f13`), not `pms`.
   This was confirmed against real data: the 3 PROJEXA orgs already linked via
   `veridian_credentials` (see below) are all tagged `primary_product_branch_id
   = 5fceebcd-...` in `compliance.organisations`, never `pms`. All 6 newly
   created orgs in this migration use the `projexa` branch to stay consistent
   with every org PROJEXA has ever actually provisioned. (The `pms` branch is
   a separate, generic "Project Management System" product branch, also
   display-named "PROJEXA" in its catalog row, which appears to be the source
   of the original brief's confusion -- two different `platform.product_branches`
   rows share the same `display_name`.)

## What was found (read-only against PROJEXA, `evpckeuxgvahguwsaeul`)

| | count |
|---|---|
| `public.organizations` | 9 |
| `public.memberships` | 88 |
| `public.profiles` | 88 |
| `public.veridian_credentials` (bridge to compliance-tracker) | 3 |

3 of the 9 orgs were **already linked** to an existing `compliance.organisations`
row via `veridian_credentials.veridian_org_id` (created by real prior calls to
the provision-org endpoint):

| PROJEXA org | PROJEXA org id | compliance-tracker org id | memberships |
|---|---|---|---|
| Platform Test Org Alpha | `6804b5a2-7098-4ece-8c6b-15dfe6358024` | `xepoooh8p1iqm6eqjetbhuuc` | 1 |
| Demo Organization | `bc689d97-2dd8-47ab-b5f7-5eb3d696ad34` | `ve45lczmkodbiq1m20fy48r5` | 3 |
| Meridian Construction Group | `42d7bac5-ffe1-4e10-a783-deaa90f8ce03` | `4ecc472f-4152-4310-ae8d-cf8b7c52ab6d` | 11 |

Of those, **Meridian Construction Group's 11 memberships were already present**
in `compliance.users` (org-scoped correctly) from an unrelated prior E2E
seeding effort (`PHASE1_SEED_REPORT.md`, ~1,007 seeded rows for that org) --
confirmed via a direct email lookup before writing anything. That org needed
zero further action and was excluded entirely from this migration.

The other 6 PROJEXA orgs had **no** existing link and needed a brand-new
`compliance.organisations` row:

| PROJEXA org | PROJEXA org id | country | memberships |
|---|---|---|---|
| Acme Test Construction | `26489072-0b74-4acf-9d69-ae4e044416fd` | IN | 1 |
| Wave4 QA Test Co | `03c8858a-5989-45cc-a64f-54b16cdb0ea0` | IN | 0 |
| Skyline Builders | `15bf14d9-6098-4777-bbbe-5487157bfe42` | IN | 1 |
| Meridian Skyline Group | `f6b0df80-968f-4874-8884-2674cf5354d7` | IN | 21 |
| Platform Test Org Alpha (2nd) | `48310173-0b3b-44d5-98df-18b3bbcb5005` | IN | 0 |
| Al Maha Skyline Contracting & Interiors LLC | `03483997-4a9d-4e07-b833-e5935101ed9a` | AE | 50 |

**Note on the 2nd "Platform Test Org Alpha":** PROJEXA org `48310173` (slug
`platform-test-org-alpha-fm6zh`) was created within 2 seconds of an orphaned,
unlinked compliance-tracker org (`is94gppgpbuwq8jl3m5baame`, also named
"Platform Test Org Alpha") -- almost certainly the result of a failed/retried
provisioning call on Wave 8's side that left a duplicate compliance-tracker
org with no `veridian_credentials` row pointing to it. This migration did
**not** attempt to recover/link that orphan (out of scope -- a pre-existing
Wave 8 provisioning bug, not this wave's job to fix); it created a fresh org
for PROJEXA org `48310173` instead, per this wave's literal instruction to
only reuse an existing link when `veridian_credentials` already provides one.
Flagged here for whoever owns Wave 8/10 cleanup.

## What was migrated

- **6 new `compliance.organisations` rows** -- `name`/`slug`/`country` from
  PROJEXA, `plan='free'`, `primary_product_branch_id` = the `projexa` branch,
  `monthly_cost_cap_usd='20'`/`cost_cap_enforcement_enabled=true` (same
  defaults `provisionOrganisation()` applies to every org), each with its own
  new "General" `compliance.departments` row, and the same
  `compliance.org_product_branch_enablements` rows the real provisioning
  route grants a new PROJEXA org (`veri_reward`, `veri_chat_v2` free-by-default,
  plus `construction`/`erp`/`sales`/`hr` per
  `REQUIRED_BRANCHES_BY_APPLICATION.projexa`).
- **77 new `compliance.users` rows** (88 total PROJEXA memberships - 11
  already seeded for Meridian Construction Group), role-mapped
  `owner`→`admin`, `admin`→`admin`, `member`→`member` (compliance.user_role
  has no `owner` value), `password_hash` set to a placeholder value that can
  never match a real credential (`'MIGRATED_NO_LOGIN_' || md5(...)`) --
  these accounts exist with correct org/role but cannot be logged into by
  password until an explicit reset.
- PROJEXA's own database (`evpckeuxgvahguwsaeul`) was **read-only** throughout
  -- confirmed unchanged after the migration (still 9 orgs / 88 memberships /
  88 profiles / 3 credentials).

## Verification method (and why it differs from the original instruction)

The original instruction was to use Supabase MCP's `create_branch` to verify
on a branch first. `create_branch` returned `PaymentRequiredException:
Branching is supported only on the Pro plan or above` -- this Supabase org is
not on a plan that supports branching. Substituted an equivalent, still-safe
verification: the exact migration script wrapped in `BEGIN; ... SELECT <row
counts>; ROLLBACK;`, with the ROLLBACK's real effect first confirmed
empirically (inserted a disposable probe row into `compliance.organisations`
inside a transaction, rolled back, then confirmed in a **separate** tool call
that the probe row did not persist) before trusting the pattern for the real
dry run.

Dry-run counts matched expectations exactly for every org (Acme=1, Al Maha=50,
Demo Organization=3, Meridian Skyline Group=21, Platform Test Org Alpha
existing=1, Platform Test Org Alpha new=0, Skyline Builders=1, Wave4 QA=0;
total 77). The identical script was then re-run with `COMMIT` instead of
`ROLLBACK`.

## Real counts after applying (verified post-commit)

| | before | after |
|---|---|---|
| `compliance.organisations` | 20 | 26 |
| `compliance.users` | 641 | 718 |
| Rows tagged `password_hash LIKE 'MIGRATED_NO_LOGIN_%'` | 0 | 77 |
| PROJEXA's own DB (`evpckeuxgvahguwsaeul`) orgs/memberships/profiles/credentials | 9/88/88/3 | 9/88/88/3 (unchanged) |

## Explicitly out of scope for this wave (per the brief)

- DNS/Vercel domain cutover (Wave 10).
- Deleting/retiring PROJEXA's local VeriComposer port (Wave 8).
- Minting real `vk_...` API keys or writing back to PROJEXA's own
  `veridian_credentials` table for the 6 newly created orgs -- PROJEXA's DB
  was explicitly required to stay untouched/read-only for this wave, so these
  6 new compliance-tracker orgs currently have no reverse-link from PROJEXA's
  side. Whoever owns Wave 10 (live cutover) will need to either mint new API
  keys via the existing provision-org-style flow or otherwise wire PROJEXA's
  runtime to these org ids.
- The orphaned `is94gppgpbuwq8jl3m5baame` compliance-tracker org noted above.
