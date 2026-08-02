# PROGRESS -- task-20260802-210700-pm-decision--fix-the-real-high-severity

Cites: `UMR-20260802-165606-4413` (OCID-020) throughout. `UMR-20260802-173631-ca85`
stays locked until this fix AND the rest of the real certification sweep are
independently verified complete.

## Completed
- [x] Read `ai-os/boss/ACTIVE-CLAIMS.yaml` + found the real prior finding this PM
      decision is about: OCID-020 redo session (PR #737) — Finding A, real
      `500` on `GET /api/departments` crashing the Compliance Register
      (`/compliance`) and Pendency View (`/compliance?status=overdue`) with a
      client-side `TypeError: z.map is not a function`.
- [x] Root-caused directly (not narrated): reproduced locally by building the
      exact same Drizzle relational query (`db.query.departments.findMany({with:
      {head, complianceItems, users}})`, verbatim from
      `src/app/api/departments/route.ts`) against the real `src/lib/db/schema.ts`
      via `drizzle-orm`. Real error reproduced: `There are multiple relations
      between "users" and "departments". Please specify relation name.` Drizzle
      0.45 requires ALL relation pairs between two tables to carry an explicit
      `relationName` once more than one pair exists between them —
      `departmentsRelations.head`/`usersRelations.headOfDept` already had one
      (`'deptHead'`), but `departmentsRelations.users`
      (`many(users)`)/`usersRelations.department` (`one(departments,...)`) did
      not, which is what actually threw. The route's own try/catch swallowed
      this into a `{error: "Failed to fetch departments"}` 500 JSON body; the
      client destructures `departments` from that response and calls `.map()`
      on `undefined` — exactly the observed `z.map is not a function` (minified
      `departments` var).
- [x] Real fix shipped: `src/lib/db/schema.ts` — added
      `relationName: 'departmentMembers'` to both
      `departmentsRelations.users` and `usersRelations.department`, the one
      remaining unnamed pair. 2-line change, no schema/migration change (this
      is Drizzle relational-query config only, not a DB column/table change).
- [x] Verified the fix directly, not narrated: re-ran the same query-build
      repro script against the patched schema — the same `db.query.departments
      .findMany({with:{head, complianceItems, users}})` call now builds a real
      SQL query with no error (`select "departments"."id", ...` confirmed in
      output, including the joined `head`/`complianceItems`/`users` subqueries).
      Also ran `bunx tsc --noEmit` — clean, no new errors touching
      `schema.ts` or `departments/route.ts`.
- [x] Scoped blast radius: this is a schema-wide relation, not local to
      `/api/departments` — `grep` shows `db.query.departments`/`db.query.users`
      relational queries also used in `app/api/departments/[id]/route.ts`,
      `app/api/v1/projexa/hr/departments/route.ts`,
      `app/api/v1/connectors/office-addin/departments/route.ts`,
      `app/api/compliance/import/route.ts`, `lib/task-execution-engine.ts`,
      `lib/services/erp-fixed-assets-service.ts`, and others — all of these
      were silently exposed to the same ambiguous-relation crash risk and are
      now fixed by the same 2-line schema change (not separately touched).

## Remaining
- [ ] Commit + push this fix, open PR, let CI run.
- [ ] Merge once CI is green (per AGENTS.md Rule 6 — no direct push to `main`).
- [ ] Independently retest the EXACT SAME real flow that crashed, against the
      real deployed app once this fix ships: sign in to `https://projexa-ai.com`,
      click "Register" / "Pendency View" (or `GET /compliance`,
      `GET /compliance?status=overdue` directly) — confirm no more
      "Application error: a client-side exception has occurred", confirm
      `GET /api/departments` returns real `200` with a real `{departments: [...]}`
      body, screenshot as evidence. This is a live-deployment-dependent step —
      cannot be done from this isolated task workspace (no `.env`/DB creds
      here) until the fix is merged and Vercel's own build/deploy for `main`
      completes.
- [ ] Log Finding B (real `403 Forbidden` on CRM/ERP APIs for a fresh
      self-signup org, medium severity, real UX gap — no
      "module not enabled" messaging) as its own real, named, tracked gap in
      `ai-os/MASTER-TRACKER.yaml`, with the real reproduction path from the
      OCID-020 redo findings doc.
- [ ] Register this session's claim in `ai-os/boss/ACTIVE-CLAIMS.yaml` per its
      own protocol.
- [ ] After the fix is independently verified live: resume the broader real
      certification sweep per the PM spec — multi-tenant, multi-brand,
      first-time-onboarding, cache and search, remaining nav surface — reporting
      real incremental findings every cycle, not one final claim.
