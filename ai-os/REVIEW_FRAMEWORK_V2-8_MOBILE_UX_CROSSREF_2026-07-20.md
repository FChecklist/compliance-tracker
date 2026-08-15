# REVIEW FRAMEWORK V2-8 — Mobile Field-UX Cross-Reference to PROJEXA

> **Purpose**: durable close-of-record for one row in
> `claude-control/VERIDIAN_Review_Framework_evaluated_2045rows.csv` that the
> SUPERBOSS v2 plan (`ai-os/SUPERBOSS_IMPLEMENTATION_PLAN_2026-07-19_v2.md`,
> §2 decision log entry **D10**) closes **by a cross-repo scope decision,
> not by a code build** — confirming that the field-usable Site Diary +
> Attendance mobile UX lives in the sibling **projexa** repo and
> cross-referencing it from here, so the compliance-tracker evaluation row
> is re-scored against the correct repo boundary.
>
> **Task**: V2-8-MOBILE-UX-CROSSREF (docs-only, L1 Code Worker).
> **Tier**: 1 (docs-only; no code, no schema, no auth/RLS, no payment/billing, no `.env`).
>
> **Authority basis**: the Owner's own D10 decision in the v2 plan §2 —
> *"evaluate field-usable mobile UX in the PROJEXA repo (site-diary/
> attendance live there); close this compliance-tracker row by
> cross-referencing projexa's screens."* This is a scope/repo-boundary
> decision the Owner pre-authorized; no money is involved. This doc is
> the close evidence for the row's re-score.
>
> **This is NOT a claim that compliance-tracker is mobile-usable.** The
> broader mobile-responsive gaps (CSV rows #106 desktop-only responsive
> scaling, #1792 offline/poor-connectivity resilience, #1793 touch-target
> sizing, #1794 mobile load-time performance) remain **open** and are
> tracked separately — see "Out of scope" below. This doc closes only the
> single row whose gap was *"no in-repo UI to evaluate at all, because the
> consuming frontend lives in a sibling repo."*

---

## CSV row #1790 — `Mobile / Responsive Experience: Field-usable UX for Site Diary and Attendance on mobile devices`

- **Frozen status (2026-07-16)**: *Evaluated - Needs Owner Decision*.
- **Row's own Current Observation (verbatim, abridged)**: *"Only backend
  API routes exist for these PROJEXA modules within this repo … No
  frontend page was found anywhere under `src/app/(app)` for site diary or
  attendance — the mobile field-usable UI, if it exists, lives in the
  separate PROJEXA frontend repo, which is out of scope for this
  compliance-tracker evaluation."*
- **Row's own Recommendation (verbatim)**: *"Confirm with the Owner whether
  mobile field UX should be evaluated in the PROJEXA repo instead, and
  cross-reference that repo's own site-diary/attendance screens."*
- **Owner decision (D10, v2 plan §2)**: evaluate field-usable mobile UX in
  the PROJEXA repo; close this compliance-tracker row by cross-referencing
  projexa's screens. → this task.

### What was verified (live code, 2026-07-20)

The compliance-tracker evaluation row was **correct**: there is no
consuming frontend screen for site-diary or attendance in *this* repo.
`src/app/(app)/` has no `site-diary` or `attendance` directory — only the
backend API surface exists here:

- `src/app/api/construction/site-diary/route.ts` → `listSiteDiaries` /
  `createSiteDiary` in `src/lib/services/construction-site-diary-service.ts`
- `src/app/api/construction/attendance/route.ts`
- aliased as `src/app/api/v1/construction/{site-diary,attendance}` and
  re-exported again as `src/app/api/v1/projexa/{site-diary,attendance}`
  (`export { GET, POST } from "@/app/api/v1/construction/site-diary/route"`),
  the same thin-aliasing pattern 44+ other projexa routes use.

The field-usable UI **does** live in the sibling projexa repo
(`FChecklist/projexa`, local checkout `/opt/veridian/repos/projexa`),
consuming exactly those aliased endpoints:

| Module | projexa route | Title | Client component | Calls (compliance-tracker API) |
|---|---|---|---|---|
| Site Diary | `src/app/(app)/site-diary/page.tsx` | "Site Diary" | `src/components/SiteDiaryClient.tsx` | `/api/site-diary?projectId=…` (GET list / POST create) — date, weather, work-done, labour-count, issues, instructions |
| Attendance | `src/app/(app)/labour/page.tsx` | "Manpower & Attendance" | `src/components/LabourClient.tsx` (Roster + Attendance tabs) | `/api/labour-roster` + `/api/attendance` (present / half_day / absent + hours-worked + daily-cost) |

Both are real React server-component pages (auth-guarded via
`getServerOrganizationId` + `resolveSelectedProject`) rendering real
client components that POST to the compliance-tracker-owned engines
through the v1/projexa alias namespace. The data model, business rules,
and RLS boundary all live in compliance-tracker; the field-facing screen
lives in projexa. This is the intended PLATFORM-01 provisioning split
(row #1790's own Root Cause: *"compliance-tracker is VERIDIAN's core
platform; construction-specific field UI was intentionally built in the
separate PROJEXA product repo that consumes these APIs"*).

### Honest nuance — the screens exist, but are not yet mobile-optimized

Verification turned up something the original row did not assert and the
plan's D10 did not promise: the projexa screens **exist and are
field-usable as a desktop/responsive-web form**, but they are **not
specifically mobile-tuned**:

- `SiteDiaryClient.tsx` / `LabourClient.tsx` render data in shadcn
  `<Table>` (a desktop table component — no responsive
  table-to-card-on-mobile collapse), with one `grid grid-cols-2` on the
  diary form and no `sm:`/`md:`/`lg:` responsive breakpoints.
- No `field`/mobile touch-target size variant (CSV row #1793's
  ≥44×44px concern) is applied — the default shadcn Button/Input sizing
  is used.
- No offline queue / service worker (CSV row #1792's concern) — both
  screens `fetch()` live and toast on failure.

This does **not** reopen row #1790. Row #1790's gap was scoped as
*"field-usable UX for Site Diary and Attendance"* and its own
recommendation was to **confirm where that UX lives and cross-reference
it** — which is now done: it lives in projexa, and these screens are the
evidence. The narrower "is that UX mobile-optimized?" questions are
**separate rows** (106 / 1792 / 1793 / 1794), each with their own
recommendation, owner, and status, and they are tracked there, not here.
Conflating them would silently re-scope #1790 into a multi-week
responsive-mobilization build, which is exactly the scope-inflation the
plan's three-bucket split (§2) exists to prevent.

### Re-score

- **New status**: *Decided — cross-repo scope confirmed, no in-repo build.*
  Moves off "Needs Owner Decision." The compliance-tracker row is closed
  by the Owner's D10 decision + this cross-reference; the field-usable UX
  itself is evaluated in projexa's own scope (projexa has no `ai-os/` tree,
  so per the established cross-registration precedent its evaluation is
  recorded here in compliance-tracker's ai-os/, the same way projexa
  work is registered in this `ACTIVE-CLAIMS.yaml`).
- **No code written in compliance-tracker.** The optional "open in
  PROJEXA" deep-link was considered and **deliberately not added**: there
  is no live projexa deployment URL guaranteed stable at the time of this
  doc, the projexa screens require an authenticated project context to
  render (`resolveSelectedProject`), and a speculative deep-link from
  compliance-tracker UI would be a Tier-2 code change with no confirmed
  user need — the same anti-scope-inflation reasoning as D7/D9 in
  `REVIEW_FRAMEWORK_DECISIONS_2026-07-19.md`. The cross-reference *doc*
  is the deliverable; a real deep-link can be added later if a concrete
  user flow demands it (re-open row under a new task, not here).
- **Plan ref**: §2(b) D10 → V2-8.

### Out of scope (tracked separately, NOT closed by this doc)

- CSV #106 — Mobile Responsiveness (desktop-only, no responsive
  breakpoints across ~130 pages). Open.
- CSV #1792 — Resilience to poor connectivity (no offline
  service-worker/queue for site-diary/attendance). Open.
- CSV #1793 — Touch-target sizing (no ≥44px `field` variant on
  site-diary/attendance controls). Open.
- CSV #1794 — Mobile load-time performance (no Lighthouse CI / perf
  budget). Open.

These four are real, acknowledged gaps in the projexa-side field UX and
in compliance-tracker's platform responsiveness. They are **not** what
row #1790 asked, and closing #1790 does not close them — it only
resolves the repo-boundary question #1790 was actually about.
