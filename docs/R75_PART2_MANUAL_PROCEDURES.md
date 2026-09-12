# R75 Part 2 Phase 4 — manual acceptance procedures for genuinely NOT_TESTABLE requirements

Six requirements were triaged `not_automatable` in Phase 1 (W1-01). Two turned out
to be automatable after a closer look and were moved into Phase 3's test queue
instead (see each one's note below) — recording that correction here rather
than silently fixing it, per V4-01's instruction not to accept "requires
human judgement" without checking what judgement it actually requires.

## Moved to Phase 3 (were wrongly triaged not_automatable)

- **R-10** ("Sub-task columns exist in production DB"). The original reasoning
  ("schema verification happens at migration time, not functional tests") is a
  style preference, not a real impossibility. Checked live against the real
  production database (`pcrjmlpuqsbocqfwoxod`, `compliance.construction_boq_line_items`):
  both `parent_line_item_id` and `breakdown_percentage` genuinely exist, right
  now. Automatable the same way R-61's closed test already does it in this
  codebase — introspect the drizzle `schema.ts` table definition (no live DB
  connection needed in CI), which is real evidence the columns are declared,
  paired with the migration-ledger check every migration already goes through
  (GV-08). Queued into Phase 3.
- **R-C04** ("Live-create Minutes of Meeting, save as PDF, share to WhatsApp").
  The original triage assumed the routes named in the requirement's own text
  (`/api/moms`) don't exist in this repo. They don't — but the real,
  functionally-equivalent routes do, under a different name:
  `POST /api/veri-meetings` (create), `PATCH /api/veri-meetings/[id]/minutes`
  (live minutes), `GET /api/veri-meetings/[id]/pdf` and `/export` (PDF),
  `POST /api/veri-meetings/[id]/share-links` (real `whatsappHref` — a
  `wa.me/?text=...` link, confirmed in `veri-meeting-service.ts`). This is the
  same failure mode already caught once this session on R-90/R-91 (Phase 1):
  assuming a route is missing because the requirement's own informal wording
  named the wrong path, rather than checking. Queued into Phase 3.

## Genuinely NOT_TESTABLE (4 remain)

### R-A1 — "Demo admin password rotated before any prospect sees product"

**Why no automated test can prove it:** this is a one-time administrative
action (rotate a specific account's password before an external party is
shown the product) with no repeatable, codified trigger condition an
automated suite could observe — "before any prospect sees product" is a
business-process gate, not a system state a test can query. Even checking
"has this password been rotated since date X" would require storing and
trusting a rotation timestamp nothing in this codebase currently records for
this specific purpose, and the real risk (an external person seeing a stale
password) is about process discipline, not code behavior.

**What would make it automatable, and the cost:** add a
`last_rotated_at` column on the demo admin account plus a `pre-demo` CI/cron
check comparing that timestamp against a policy (e.g. "rotated within 24h of
any scheduled demo"). Real cost: a new column + migration, a place to record
"a demo is about to happen" (which doesn't exist as a concept anywhere in
this codebase today), and ongoing discipline to actually update it — likely
more process overhead than the risk justifies for a zero-customer product in
development. Not worth building right now; revisit if/when real prospect
demos become a recurring, scheduled thing.

**Manual acceptance procedure:**
1. Before any demo, screen-share, or handoff where an external, non-team
   person will see the product logged in as the demo admin account, the
   person running the demo rotates that account's password first.
2. Log into the demo admin account with the new password to confirm the
   rotation took effect before proceeding.
3. Record who ran the rotation and when in `platform.claude_log` (or the
   owner's own notes) — a one-line note is sufficient, this is a discipline
   record, not a data feature.
4. **Expected result:** the demo admin account's password is different from
   its last-known value, and step 2's login succeeds with the new one.
5. **Performed by / date:** ___________________ (fill in at time of use).

---

### R-A3 — "compliance-tracker repo visibility decision"

**Why no automated test can prove it:** whether a GitHub repository is
public or private is a real, checkable fact (`gh repo view --json visibility`)
— but WHETHER that setting is *correct* depends on a business decision
(does the owner want this repo public) that no test can derive on its own.
The checkable half and the decidable half are different things; conflating
them is exactly how a stale or accidental setting change could look "tested"
when it was never actually decided.

**What would make it automatable, and the cost:** once a decision exists and
is recorded somewhere durable (not just tribal knowledge), a CI job could
assert `gh repo view --json visibility` matches the recorded decision on
every run, catching drift. Low cost to add once the decision itself is made
— the automatable part is trivial; the actual blocker is that the decision
needs to be made and recorded first.

**Manual acceptance procedure:**
1. Confirm the current live visibility: `gh repo view FChecklist/compliance-tracker --json visibility`.
2. Confirm it matches the owner's actual intent for this repo (ask, if not
   already on record — per memory, `veridian_all_repos_made_public_2026-08-29.md`
   records all 16 FChecklist repos were deliberately made public with a
   specific rationale; if that rationale still holds, this repo's current
   `PUBLIC` visibility is correct and this item can move to CLOSED once that
   is confirmed with the owner rather than assumed).
3. **Expected result:** live visibility matches the recorded/confirmed decision.
4. **Performed by / date:** ___________________.

---

### R-A5 — "Review of GPLv3 ERPNext / scraped / reverse-engineered code"

**Why no automated test can prove it:** this asks whether code in this
repository was copied from a GPLv3-licensed project (ERPNext) or scraped/
reverse-engineered from another product in a way that creates licensing or
liability exposure. That is a legal and provenance judgment about how code
was AUTHORED, not a property the code's own runtime behavior exposes — no
test can observe intent or origin from the artifact alone. Static-similarity
tooling (e.g. license-checking scanners) can flag suspicious overlap, but a
genuine legal clearance requires a qualified reviewer's judgment on what
they find, which is exactly the "cost" below.

**What would make it automatable, and the cost:** a license-similarity scan
(e.g. `scancode-toolkit` or similar) run over the repo, diffed against known
GPLv3 ERPNext source, would surface CANDIDATE overlaps automatically — cost
is standing up that tooling (a few hours) plus, critically, someone with
legal competence actually reading and judging any flagged overlap (the part
no tool can do). Worth doing before any real customer or investor due
diligence; not yet done here because there are zero customers and the
practical risk today is low, not because it is unimportant.

**Manual acceptance procedure:**
1. Run a license-similarity scan over the repo's source tree (excluding
   `node_modules`, generated files, and third-party vendored code already
   under its own declared license) against ERPNext's public GPLv3 source and
   any other codebase reasonably suspected of being a scrape source.
2. A qualified reviewer (legal counsel, or the owner with legal advice)
   examines every flagged match and judges: coincidental (common pattern),
   properly licensed/attributed, or a real problem needing remediation.
3. Record the outcome and reviewer in `platform.claude_log`.
4. **Expected result:** zero unresolved "real problem" findings.
5. **Performed by / date:** ___________________.

---

### R-A7 — "veridian-ui-kit repo visibility decision"

**Why no automated test can prove it:** identical reasoning to R-A3, applied
to a different repository (`veridian-ui-kit`).

**What would make it automatable, and the cost:** identical to R-A3 — trivial
once a decision is recorded.

**Manual acceptance procedure:**
1. Confirm current live visibility: `gh repo view <org>/veridian-ui-kit --json visibility`.
2. Confirm it matches the owner's actual intent (same 16-repos-public
   rationale as R-A3, per `veridian_all_repos_made_public_2026-08-29.md`,
   applies here unless the owner says otherwise).
3. **Expected result:** live visibility matches the recorded/confirmed decision.
4. **Performed by / date:** ___________________.
