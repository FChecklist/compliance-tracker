# PROJEXA server merge — plan

**Owner directive (2026-09-29, this session):** projexa-ai.com should need only
one server to start, in local dev and on Vercel, to save time and money.
veridian-aios.com/DPDP stays Cloudflare-only and needs no Vercel. The owner
named these as the only two forward products and told this session to "take
decision" on the architecture.

Status: **decision made, execution not started.** Part 1 of this session's
work (the AI work link UI) is separate and already in flight — see
`ai-os/boss/ACTIVE-CLAIMS.yaml`'s entry for this session. This document is
Part 2: the plan, not yet executed.

## Why two servers exist today

PROJEXA (`C:\ct\projexa`, a separate repo, Vercel project `projexa`) has
almost no business logic of its own. Nearly every screen calls
compliance-tracker's API over HTTP (`src/lib/veridian-client.ts` →
`VERIDIAN_API_BASE_URL`, e.g. `http://localhost:3000/api/v1/projexa` locally
or `https://veridian-compliance-ai.vercel.app/api/v1/projexa` in prod).
Confirmed by direct measurement this session (Explore agent, `Get-ChildItem
-Recurse`, not a shell glob — this repo's own glob-undercounting gotcha):

- **287** `route.ts` files under `src/app/api/v1/projexa/` (plus 48 test
  files), grouped by module: payroll (14), procurement (14), schedule (13),
  scope (12), recruitment (10), plus ~30 more single-purpose areas (RFIs,
  BOQ scenarios, capability-tree, currencies, dashboard, reports, vendors,
  change-orders, punch-list, site-diary, submittals, …).
- Representative routes pull real weight: `construction-dashboard-service.ts`
  (1534 lines), `boq-scenario-service.ts` (1033), `construction-progress-
  service.ts` (1024) — all also share `compliance-service.ts` (590) and
  `db/tenant-scoped.ts` (641).
- The auth/tenant layer PROJEXA depends on, `src/lib/supabase/auth-guard.ts`
  (722 lines), is explicitly PROJEXA-aware already (`USER_NOT_LINKED_MESSAGE
  = "Your PROJEXA account is not linked to a VERIDIAN user"`) and bridges two
  separate identities: a per-org API key (`src/lib/supabase/api-key-auth.ts`)
  plus an `X-Acting-User` header mapped to a `compliance.users` row by
  `auth_user_id`. It is wired into compliance-tracker's own org/license/
  session/billing services, not a standalone module.
- PROJEXA's own real users/orgs live in a **separate Supabase project**,
  `evpckeuxgvahguwsaeul`, used only for browser sign-in — the actual
  authorization identity for writes is resolved via the bridge above, against
  `compliance.users` rows in compliance-tracker's project, `pcrjmlpuqsbocqfwoxod`.
- Of `pcrjmlpuqsbocqfwoxod`'s 604 tables, ~68 are construction/PMS-specific
  (`construction_*`, `pms_*`, `interior_*`, `boq_*`) and PROJEXA's finance/HR
  routes additionally depend on the generic `erp_*` module (108 tables) —
  PROJEXA's real footprint is ~176 tables, not a small slice.

**Confirmed this session by a peer session actively working in
compliance-tracker** (`Veridian-aios.com archived work review`, cross-session
message, 2026-09-29): DPDP's Cloudflare Pages app (`dpdp-app`) talks directly
to Supabase via `@supabase/supabase-js` — it never goes through
compliance-tracker's Next.js app, at all, for anything. Two Supabase Edge
Functions (`dpdp-monday-email`, `dpdp-ai-link`) also run independently of
Vercel/Next.js. **This means compliance-tracker's Next.js/Vercel app has
exactly one live reason left to exist: being PROJEXA's backend.** The same
peer session, reading `src/app/api/v1/projexa/**` and
`src/app/api/v1/construction/**` directly, independently reached the same
conclusion: "the fold-together plan and 'can we eventually retire the
Next.js app' are the same question, not two."

## Decision

**Fold PROJEXA's frontend into compliance-tracker's Next.js app, rather than
porting compliance-tracker's backend logic into PROJEXA.**

Why this direction and not the reverse: compliance-tracker's app already has
100% of the business logic, already correctly wired to real tenant scoping
and auth, and was the subject of real, expensive, already-completed
correctness work (R74/R75: all 831 mutating routes individually reviewed and
gated, `KNOWN_OPEN_GAPS.length === 0` as of 2026-09-05, re-confirmed R83).
Re-deriving that in a second codebase (the alternative — port the 287 routes
+ the 722-line auth bridge into PROJEXA, talking directly to the DB) means
re-doing security-critical work that's already done, for no benefit. Folding
the UI in is comparatively mechanical: move `page.tsx`/component files,
reuse existing service functions directly (no HTTP hop at all once merged),
remove the now-pointless API-key/acting-user bridge once PROJEXA's UI is
native to the same app and a real signed-in session can resolve identity
directly.

**Database: recommend NOT migrating PROJEXA's ~176 tables out of
`pcrjmlpuqsbocqfwoxod`.** The original ask was a single database dedicated to
PROJEXA; now that it's confirmed DPDP will keep using this same Supabase
project regardless (its `dpdp` schema, reached only via `public.dpdp_*` RPCs,
not exposed to PostgREST — already schema-isolated), moving ~176 tables to
get a "dedicated" database buys mostly a cosmetic property at real migration
risk, not genuine isolation the app doesn't already have. Flagging this as a
course-correction from the earlier framing rather than deciding it silently —
say so if dedicated ownership still matters for a reason beyond isolation
(e.g. a future move to a different Supabase org/billing account).

**PROJEXA's own Supabase Auth project (`evpckeuxgvahguwsaeul`) does need
reconciling** — real login accounts, not just data, so this is worth doing
carefully even though there are zero real customers today (owner-confirmed
this session). Two real options, not yet decided: (a) migrate PROJEXA's real
users into `pcrjmlpuqsbocqfwoxod`'s `auth.users`/`compliance.users` so a
native signed-in session resolves identity with no bridge at all, or (b) keep
the bridge (API key + acting-user header) indefinitely even after the UI
merges, which is simpler but leaves an unnecessary indirection. Recommend (a)
once Phase 2 below is reached, given zero real customers makes this cheap now
and expensive later.

**Not yet independently verified:** whether compliance-tracker's original,
non-DPDP product (audit, penalties, departments, checklists, CRM, facilities,
GST, HR, training, etc. — the schemas outside `construction_*`/`pms_*`/
`interior_*`/`erp_*`/`dpdp_*`) is genuinely retired. The owner named exactly
two forward products this session (DPDP + PROJEXA), which this plan treats as
the answer — but no code-level check confirmed zero remaining traffic/use.
If that turns out wrong, Phase 3 (archiving those pages) should be revisited,
not the fold-in decision itself, which holds either way.

## Phased execution

**Phase 0 — proof, not yet started.** Port ONE representative PROJEXA page
(recommend the Projects list — already simple, already being touched by the
AI-work-link UI work in Part 1) into compliance-tracker's `src/app/(app)/`
tree as a real, working page calling the existing service functions directly
(no HTTP), confirmed to render correctly locally. De-risks the "zero backend
rewrite" thesis on one page before committing to all ~186. Small, reversible,
a few hours of real work.

**Phase 1 — bulk UI port.** Move the remaining PROJEXA pages/components in
batches by module (mirroring the 287-route grouping above — payroll,
procurement, schedule, BOQ, etc.), each batch its own PR, each verified
against a real local run before merge. This is the largest phase by file
count but the lowest-risk by nature (UI only, logic already correct).
Domain-based branding: compliance-tracker's app needs to render PROJEXA's
shell/theme when `Host: projexa-ai.com`, its own (if anything survives) on
any other host — straightforward Next.js middleware host-branching, no new
architecture needed.

**Phase 2 — auth reconciliation.** Migrate PROJEXA's real Supabase Auth users
from `evpckeuxgvahguwsaeul` into `pcrjmlpuqsbocqfwoxod`'s `auth.users`,
matched to existing `compliance.users` rows by email (the same match key
`resolveActingUser()` already uses), then retire the API-key/acting-user
bridge for PROJEXA callers. Real data migration, real users (even if all
test/demo today) — do this deliberately, with a dry run and a rollback path,
not casually.

**Phase 3 — retire what's no longer needed.** Old PROJEXA repo (`C:\ct\
projexa`) archived once its pages are fully ported and DNS points at the
merged app. Non-PROJEXA, non-DPDP pages in compliance-tracker's app archived
or deleted, once Phase 0's flagged assumption is confirmed rather than
assumed. `vercel.json`/deploy config simplified to the one surviving project.

**Explicitly out of scope for all phases above, per the owner's own words this
session:** any Vercel deploy, unpause, or config change; any DNS change. This
entire plan is local + git + Supabase work until the owner separately decides
to go live on the merged app.

## Verification approach

Each phase's PRs go through this repo's normal CI (lint/typecheck/build/
test/migration-integrity) plus a real local click-through in the Claude
Browser pane before merge — not just "tests pass." Given the size, later
phases are good candidates for a `pipeline()`-based Workflow (one agent per
module batch, an independent verify agent per batch, same pattern as this
session's AI-work-link-UI workflow) rather than one session hand-porting 186
files serially.

## Open questions for the owner (not blocking Phase 0)

1. Is compliance-tracker's original non-DPDP product surface really fully
   retired, or does anything there still matter? (See "not yet independently
   verified" above.)
2. Phase 2's direction — migrate PROJEXA's real users into
   `pcrjmlpuqsbocqfwoxod`, or keep the existing bridge? Recommend migrate,
   given zero real customers today.
