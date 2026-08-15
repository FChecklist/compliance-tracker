# VERIDIAN UMR / UTR / EUID — Real Discovery vs. the Live System (2026-08-03)

**Status: discovery and analysis only.** No schema change, no code change, no database change, no
new architecture. Per PM decisions `UMR-20260803-174634-5a2f` and `UMR-20260803-175139-dedf`
(both under `UMR-20260802-165606-4413`, OCID-020), this document compares the Owner's proposed
Universal Knowledge and Execution Architecture -- one Universal Metadata Registry holding reusable
knowledge as **UMR** records, one **Universal Task Registry** (**UTR** — corrected terminology, see
§0) describing every executable task across identity/governance/execution/business/knowledge-
reference/evidence contexts, and an End User Identity (**EUID**) combining brand id + organization
id + end user, synchronized across server/browser/PWA — against what the live system actually has
today. It recommends nothing be built yet; it names what is real, what is missing, and one real
naming collision that was found and is now resolved before either concept is implemented.

## 0. Terminology correction (real, applied in this document)

The Owner's directive originally named the new task-level concept "Universal Task Metadata," abbreviated
**UTM**. Real, live investigation (this document, §2) found that `utm_source`, `utm_medium`,
`utm_campaign`, `utm_content`, and `utm_term` are already real, live columns across four core
`superboss-register.sqlite` tables — a marketing-attribution-shaped internal tagging convention, not
the same concept, using the identical three-letter abbreviation. Per PM decision
`UMR-20260803-175139-dedf`, the Owner resolved this directly: the new concept is renamed **UTR**
("Universal Task Registry"), the existing `utm_*` columns are explicitly left untouched, and **UMR**
itself stays exactly as it already exists today, unchanged. Independently re-verified before writing
this document, not trusted from the PM message alone: `grep -rli '\bUTR\b'`
across `/opt/veridian/scripts/resource_governor.py`, `/opt/veridian/scripts/superboss-register.py`,
and this repo's `ai-os/` tree returned zero matches — "UTR" is a genuinely clean, currently-unused
name. Everywhere below that would otherwise say "UTM" for the new concept says **UTR** instead.

## 0a. Amendment (2026-08-03): the "UTR is unused" check above did not cover `src/`

Independent audit finding (a separate session's own re-check, not trusted from §0's claim above):
§0's "zero matches" check ran `grep -rli '\bUTR\b'` across `resource_governor.py`,
`superboss-register.py`, and this repo's `ai-os/` tree only — it never checked this repo's own
`src/` tree, which is exactly the scope §3 (below) *did* separately check for the `utm_*` collision
(finding zero hits there). Running that same `src/`-scoped check for "UTR": `git grep -ni '\butr\b'`
across `src/` finds **two real, pre-existing hits**, both the Indian-banking "Unique Transaction
Reference" convention, confirmed by direct read — `src/lib/db/schema.ts:541`
(`cost_payments.referenceNumber` column comment: `// transaction ref / cheque number / UTR`) and
`src/lib/services/erp-bank-reconciliation-service.ts:56` (bank-statement column-header matcher
`["reference", "chq", "cheque", "ref no", "utr"]`).

This does not reverse the Owner's decision (§0) to name the new concept UTR, or require it be
renamed again: the collision is with a free-text financial reference-number value used in bank
reconciliation data, not with a naming/ID-prefix convention the way `utm_*` collided (identical
column-name components in the same governance-tagging shape). The two are unlikely to be confused
in practice. But §0's "zero matches" / "genuinely clean, currently-unused" phrasing is not accurate
for the product repo as a whole as literally written, and should be read as scoped to the governance
layer (`ai-os/`, `resource_governor.py`, `superboss-register.py`) only, not as a repo-wide
zero-collision guarantee.

## 1. What the Owner proposed (as relayed in the PM dispatch)

1. **One Universal Metadata Registry** holding reusable knowledge as **UMR** records.
2. **One Universal Task Registry (UTR)** model describing every executable task with six contexts:
   identity, governance, execution, business, knowledge-reference, and evidence.
3. **An End User Identity (EUID)** combining brand id + organization id + end user, synchronized
   across server, browser, and PWA.

## 2. Real current state — the governance database (`superboss-register.sqlite`)

**Real DB, confirmed live**: `resource_governor.py` has no database of its own — it dynamically
loads `superboss-register.py` in-process (`resource_governor.py:132-141`) and calls into it. The one
real database is `/opt/veridian/ai-os/memory/superboss-register.sqlite`
(`superboss-register.py:63`), confirmed live: 776,798,208 bytes, an active WAL file (8.3MB, modified
today) — a real, actively-written production database, not a stub or a decoy (a 0-byte
`superboss-register.sqlite3` file also exists in `scripts/` and is unused — do not confuse the two).

**Real schemas, verbatim, `superboss-register.py`'s `init_db()`**:

- `instructions` (`:119-131`): `instruction_id TEXT PK, ts, session_id, utm_source NOT NULL,
  utm_medium NOT NULL, utm_campaign, utm_content, utm_term, raw_text NOT NULL, metadata_json NOT
  NULL DEFAULT '{}', response_summary`
- `work_items` (`:141-157`): `work_item_id TEXT PK, ts, instruction_id, software_task_id,
  ai_task_id, cache_id, ai_cache_id, utm_source NOT NULL, utm_medium NOT NULL, utm_campaign,
  utm_content, utm_term, status NOT NULL DEFAULT 'open', metadata_json NOT NULL DEFAULT '{}'` (FK
  to `instructions`)
- `actions` (`:167-181`): `action_id TEXT PK, ts, work_item_id, instruction_id, utm_source NOT
  NULL, utm_medium NOT NULL, utm_campaign, utm_content NOT NULL, utm_term, result, metadata_json
  NOT NULL DEFAULT '{}'` (FKs to `work_items`/`instructions`)
- `system_index` (`:204-218`): `index_id TEXT PK, ts, path NOT NULL, category NOT NULL, layer NOT
  NULL, status NOT NULL, purpose NOT NULL, utm_term, calls, called_by, verified_ts, tags,
  metadata_json NOT NULL DEFAULT '{}'`

All four already carry FTS5 shadow tables + sync triggers. All four already carry the `utm_*`
columns discussed in §0/§3.

**`umr_tasks`** — the real, live table already named "UMR" today — `_ensure_umr_table()`,
`superboss-register.py:2668-2686`: `umr_id TEXT PK, task_identity NOT NULL, ts_submitted NOT NULL,
tier INTEGER NOT NULL CHECK(0-4), status NOT NULL DEFAULT 'queued' CHECK(...), source_trigger NOT
NULL, task_kind NOT NULL DEFAULT 'systemctl_action', unit_name, inputs_json NOT NULL DEFAULT '{}',
outputs_json NOT NULL DEFAULT '{}', logs_ref, metric_snapshot_json, ts_dispatched, ts_sigterm,
ts_completed, reason, metadata_json NOT NULL DEFAULT '{}'`, plus three later idempotent
`ALTER TABLE ADD COLUMN` migrations: `last_heartbeat` (`:2714-2740`, 2026-07-29), `tenant_id`
(`:2743-2784`, 2026-07-29, nullable/all-NULL today per its own docstring), and the same five
`utm_*` columns via `_migrate_umr_utm()`/`_derive_umr_utm_fields()` (`:2787-2865,2868`).
`resource_governor.py --query-umr` (`:1584,1597-1605`) queries this exact live table.

**Honest open question, not resolved by this document**: this session's own `[UMR-YYYYMMDD-
HHMMSS-xxxx]`-tagged PM dispatch messages are a human-readable convention layered on top of this
system. Whether every such message corresponds 1:1 to a real row in `umr_tasks`, or is a looser
convention not literally backed by that table for every message, was not independently confirmed
this pass — flagged honestly as unverified rather than assumed either way. Per the Owner's own
resolution (§0), this does not block anything below: UMR stays as it is, unchanged, regardless of
this open question.

## Amendment (2026-08-03): a third, real, pre-existing "UMR" usage found

Per an independent, concurrent discovery pass (real credit: a duplicate-dispatch worker's own PR
`#836`, closed in favor of this document per the naming correction in §0, but whose own real
finding is preserved here rather than silently dropped — independently re-verified directly against
the real files below before being added, not trusted from that PR's text alone).

`ai-os/registry/asset-registry-coverage.yaml` and `scripts/check-asset-registry-coverage.mjs`
already exist as a real, live, CI-enforced system requiring every table declared in
`src/lib/db/schema.ts` to appear in exactly one of that file's `registered`/`exempted` lists.
`check-asset-registry-coverage.mjs`'s own header comment (`:2-6`) names it directly: *"the
mechanical half of the Owner's 'software ensures... non-negotiable' requirement for the **Universal
Metadata Registry**"* — the identical three words the Owner's newly-proposed architecture (§1) uses
for UMR, tracing back to `09-priority4-umr-universal-tracker.yaml` (Priority 4). This is a real,
**third** distinct usage of "UMR" in this codebase, alongside the `umr_tasks` table (§2) and the
`[UMR-...]`-tagged PM dispatch-message convention (§2's own open question) — for a narrower,
specific purpose (DB-table asset-registration coverage tracking), not the broader
"reusable-knowledge registry" the Owner's new proposal describes.

This does not change §0's resolution — the Owner's own explicit decision (`UMR-20260803-175139-dedf`)
that "UMR stays UMR exactly as it already exists today, unchanged" already covers this: it just means
"as it already exists today" is now known to include this asset-registry-coverage system too, not
only `umr_tasks`. If a future PM decision ever authorizes real UMR/UTR implementation work, this
third usage should be accounted for in that design, not rediscovered from scratch.

## 3. The real naming collision (found, not assumed) — resolved

`utm_source`/`utm_medium`/`utm_campaign`/`utm_content`/`utm_term` are documented in
`superboss-register.py:43-48`'s own header comment as a deliberate, Owner-specified internal
tagging convention: *"UTM-STYLE TAGS (literal UTM parameter names, since that's the vocabulary the
Owner specified): utm_source (who: owner|end_user|org|ai_agent|software), utm_medium (channel:
ssh_session|claude_code_cli|chat_ui|api|cron), utm_campaign (initiative/project grouping, freeform
slug), utm_content (short structured label of what), utm_term (comma-separated search
keywords)."* This is a real, live, in-use provenance/correlation tag on every row of
`instructions`/`work_items`/`actions`/`system_index`, and (via later migration) `umr_tasks` too,
plus `capability_registry` (`:365-367`) and `knowledge_engine` (`:1520-1544`). It borrows UTM's
five-field *shape* (vocabulary only, per the Owner's own original directive naming it this way) —
it is not marketing-campaign-attribution data, but it genuinely is not the same concept as the newly
proposed task-registry model either, and both used the identical three-letter abbreviation before
this document's own discovery pass surfaced the collision.

Zero hits for any of these five column names anywhere in `compliance-tracker`'s own
`src/lib/db/schema.ts` (11,482 lines, checked in full) or anywhere else in that repo's `src/` tree —
this collision is confined entirely to `/opt/veridian/scripts/superboss-register.py`'s own internal
governance database, not the product's own live schema.

**Per PM decision `UMR-20260803-175139-dedf`: resolved by renaming the new concept to UTR. The
existing `utm_source`/`utm_medium`/`utm_campaign`/`utm_content`/`utm_term` columns are not renamed,
not restructured, and not touched by this document in any way.**

## 4. Real current state — is there already something UTR-shaped?

The closest existing real analogues are `work_items`/`actions` (§2) — each row already carries a
real identity (`*_id`), a real status/result, and a freeform `metadata_json` blob. What is
genuinely **not** present today, checked directly rather than assumed: no structured, named
columns for the six contexts the Owner's UTR proposal names (identity/governance/execution/
business/knowledge-reference/evidence) — today those would all have to live inside the freeform
`metadata_json` blob, with no schema-enforced shape, no queryable structure across those six
dimensions, and no cross-reference convention connecting a task row back to a specific UMR
knowledge record. This is a real, honest gap between what exists and what the Owner's UTR concept
describes — not something already secretly built under a different name.

## 5. Real current state — is there already something EUID-shaped?

`compliance.organisations` already has five real brand-configuration columns
(`brand_primary_color`, `brand_accent_color`, `favicon_url`, `custom_domain`, `email_sender_name`,
`src/lib/db/schema.ts:129` and neighboring lines — the same columns OCID-048's real execution this
session confirmed are live but currently zero-adoption). Supabase Auth already provides a real,
distinct end-user identity per `auth.users` row, linked to `compliance.users.auth_user_id`. But a
single, unified **EUID** object combining brand id + org id + end user as one synchronized identity
— checked directly, not assumed — does not exist as a real, named concept anywhere in this codebase
today. It would have to be assembled from at least two separate real tables (`organisations` for
brand, `users`/`auth.users` for the end user), and the "synchronized across server, browser, and
PWA" requirement specifically cannot be satisfied today: OCID-051's own real, live-verified finding
(this session, `ai-os/VERIDIAN_OCID_051_CROSS_SURFACE_CERTIFICATION_PLANNING_2026-08-03.md`) is that
**zero service worker exists anywhere in `src`** — there is no PWA-side sync layer for any identity
concept to synchronize through yet. EUID is a real, honest gap, not a rename of something that
already exists.

## 6. Recommendation (not authorized by this document — discovery only)

1. **UMR**: no change. Continue as-is.
2. **UTR**: a real, structured task-registry model does not exist today under any name; building
   one would be new schema/architecture, explicitly out of scope for this document and for OCID-020
   Business Certification work under the standing "no new architecture" instruction. A future,
   separate PM decision would need to authorize real implementation, and should specify how UTR rows
   relate to `work_items`/`actions` (extend them vs. a genuinely new, separate table) rather than
   assuming either without a real design decision.
3. **EUID**: same -- a real gap, not yet authorized for implementation. Any future EUID work should
   account for the real, already-confirmed absence of a PWA sync layer (OCID-051) as a
   genuine prerequisite, not an afterthought.

## 7. Registration

- Canonical artifact: this file.
- To be indexed in `ai-os/OS.yaml` (required by `scripts/check-metadata-index-coverage.mjs`),
  following the existing registration pattern.
- Cites `UMR-20260802-165606-4413` (OCID-020), `UMR-20260803-174634-5a2f` (this discovery's own
  dispatch), `UMR-20260803-175139-dedf` (the UTR terminology correction).
- No schema, code, or database change made by this document. Discovery and analysis only.
