# CRR P2-SCHEMA — compliance.* Data Dictionary

Built by CRR points CRR-040 through CRR-226 (P2-SCHEMA phase). Every table below
is additive — nothing existing in `compliance.*` was dropped, renamed, or had a
column narrowed (AR-11: expand, never contract). Applied directly via Supabase
migrations `crr041_048_054_p2_schema_foundation`, `crr_p2_schema_tier2` through
`tier5`, and `crr068_fix_missed_rls_gaps` on 2026-08-27.

## compliance.source_object

The single capture table for every artefact from every source (upload, connector
sync, email, in-app, API) — replacing the prior split across `documents` (uploads
only), `connector_documents` (connector files only), and nowhere at all for email.

| Column | Type | Purpose |
|---|---|---|
| `id` | text pk | Row identifier |
| `org_id` | text not null | Tenant scope |
| `client_id` | text | Optional sub-tenant/client reference |
| `origin` | text, check in (upload, connector, email, inapp, api) | How the artefact arrived |
| `origin_ref` | text | ID in the source system |
| `mime_type`, `byte_size`, `storage_path`, `sha256` | — | File identity/location |
| `title` | text | Display title |
| `linked_entity_type`, `linked_entity_id` | text | What business object this belongs to |
| `business_object_type` | text | Drives which `extraction_profile` applies |
| `extract_status` | text, default PENDING | State machine: PENDING → EXTRACTING → EXTRACTED → CHUNKED → EMBEDDED, or FAILED / SKIPPED_UNSUPPORTED / SKIPPED_NO_TEXT_LAYER (CRR-063) |
| `extract_error`, `page_count`, `char_count` | — | Extraction outcome |
| `created_by_id`, `created_at`, `updated_at` | — | Standard audit |
| `deleted_at` | timestamptz | Soft delete |
| `doc_uid` | text not null unique | **Permanent, birth-assigned identity — never changes, enforced by trigger** (CRR-221/222) |
| `content_sha256` | text | Identity of the bytes; changes per version |
| `display_name` | text | Mutable — the only thing allowed to change on rename |
| `content_erased_at`, `erased_by_id`, `erasure_authority` | — | Tombstone fields for right-to-erasure (CRR-226) — the row and its `doc_uid` survive erasure; only content is nulled |

Indexes: `(org_id, sha256) WHERE deleted_at IS NULL` unique (dedup, CRR-065),
`(extract_status, created_at) WHERE deleted_at IS NULL` (CRR-064).

RLS (CRR-046): `app_runtime_tenant_isolation` — `org_id = compliance.current_org_id()`.
`service_role_bypass_source_object` — unrestricted for the service role.

Immutability (CRR-221): trigger `source_object_doc_uid_immutable_trg` raises on any
`UPDATE` that changes `doc_uid`. Verified live (CRR-222): a direct attempt to change
it is blocked with a clear error; the row's `doc_uid` is confirmed unchanged after.

## compliance.document_chunk

One row per chunk of a `source_object`'s extracted content, carrying its own vector
embedding for retrieval.

`id`, `source_object_id` (FK → source_object, **ON DELETE RESTRICT** — a chunk
cannot be orphaned by deleting its parent), `org_id`, `seq`, `page`, `char_start`,
`char_end`, `content`, `content_hash`, `token_estimate`, `embedding vector(1536)`,
`is_real` (false until a real embedding model has run, not a placeholder), `content_erased_at`, `created_at`.
Unique on `(source_object_id, seq)`.

Indexes: HNSW on `embedding` (`vector_cosine_ops`, m=16, ef_construction=64,
CRR-043); btree on `org_id`, `(source_object_id, seq)`, `content_hash` (CRR-044).

RLS (CRR-047): same two-policy pattern as `source_object`.

## compliance.extraction_profile

Field specs per business-object type — replaces the India-tax-specific extractor
that was hard-coded into `documents/extract/route.ts`.

`id`, `org_id` (nullable — null means platform-wide), `business_object_type` not
null, `name`, `field_spec jsonb not null`, `prompt_preamble`, `is_active`,
`is_platform_default`, `created_at`, `updated_at`.

Seeded rows (CRR-049/050/051): `generic` (platform default, domain-neutral fields
only — no `gstin`/`complianceType`), `india_compliance` (the original hard-coded
tax fields, migrated verbatim, `is_platform_default=false`), `construction`
(PROJEXA-specific: `boq_ref`, `drawing_number`, `retention_percent`, etc.).

RLS (CRR-052): `org_id = current_org_id() OR is_platform_default = true` — a
tenant sees its own custom profiles plus every platform default.

## compliance.precedent

The "similar" tier of reuse — `reuse_cache` already handles exact-hash repeats;
this handles semantically similar past requests, and always records the real
outcome so a past *failure* is never resurfaced as a suggestion.

`id`, `org_id` not null, `user_id`, `normalised_intent` not null,
`intent_embedding vector(1536)`, `function_id`, `params jsonb`,
`outcome` (check in SUCCESS/FAILURE/ABANDONED, not null), `source_task_id`,
`occurred_at`, `reuse_count`, `created_at`.

Indexes: HNSW on `intent_embedding` (CRR-055). RLS: same tenant-isolation pattern.

## compliance.retrieval_citation

Records that a chunk was cited in an answer. `chunk_id` is **ON DELETE RESTRICT**
by design — per the point's stated purpose, a citation must outlive a redaction
and resolve to a tombstone, never silently vanish.

`id`, `org_id` not null, `chunk_id` (FK → document_chunk, RESTRICT), `query_text`,
`response_id`, `cited_at`, `created_at`.

RLS: same tenant-isolation pattern (added retroactively — see Known Issues below).

## compliance.chunk_policy

Global, non-tenant-scoped configuration for how each business-object type gets
chunked — replaces a hard-coded 1000-character constant in TypeScript.

`id`, `business_object_type` not null unique, `max_chars`, `overlap_chars`,
`split_on` (check in paragraph/sentence/page/fixed), `created_at`.

Seeded (CRR-062): `generic` (1200/150/paragraph), `construction` (800/100/paragraph),
`india_compliance` (1500/200/paragraph). No `org_id` — this is shared platform
config, not tenant data, so it does not carry tenant-isolation RLS.

## compliance.crr_erasure_log

Audit trail for right-to-erasure requests: `id`, `org_id` not null, `subject_ref`,
`requested_at`, counts of what was deleted (`source_objects_deleted`,
`chunks_deleted`, `citations_deleted`, `embeddings_deleted`), `completed_at`,
`performed_by_id`. RLS: tenant-isolation pattern (added retroactively — see below).

## compliance.crr_ingest_error

Per-stage ingest failure log: `id`, `org_id` (**nullable by design** — a failure
can occur before the org is even resolved), `source_object_id`, `stage`,
`error_code`, `error_message`, `retry_count`, `created_at`. RLS: tenant-isolation
when `org_id` is set; rows with a null `org_id` are visible only to the service
role (fail closed, added retroactively — see below).

## Known issue found and fixed during this build (CRR-068)

The tenant-isolation test for these six tables (CRR-068) found that
`retrieval_citation`, `crr_erasure_log`, and `crr_ingest_error` were created with
`org_id` columns but RLS was never actually enabled on them — a real gap, caught
before any real data existed in the tables. Fixed the same day via migration
`crr068_fix_missed_rls_gaps`; re-tested and confirmed all six tables correctly
isolate by organization (own-org data visible, cross-org data returns zero rows).

## Not yet done

- `CRR-060`/`CRR-070`: syncing this schema into compliance-tracker's actual
  Drizzle `schema.ts` and a proper idempotent migration file (so the live DDL
  applied directly via Supabase and the codebase's own migration history agree)
  is a deliberate follow-up, not rushed here — a mismatched Drizzle migration
  journal risks breaking real deploys.
- A permanent CI test file for the CRR-068 isolation guarantee (it is currently
  verified by a manual, transactional, rolled-back proof — real, but not a
  regression test that runs automatically).
