// PROJEXA-BUILD-001 U-36 / U-37 (BR-507, BR-508): the database double of the from-document tests. It is the U-27 PGlite harness
// (real Postgres compiled to WASM, in process, no server) plus the two tables the from-document path also reads and writes:
// compliance.products (createProject() checks the product belongs to the organisation) and compliance.source_object (the
// idempotency ledger in document-extraction-service.ts). Both tables are written here as they are in the live catalog
// (pcrjmlpuqsbocqfwoxod, read 2026-09-25 from information_schema, pg_constraint and pg_indexes), including the partial unique
// index source_object_org_sha256_unique that the ledger's double-submit safety rests on. Left out: the row-level security policies
// (PGlite's own superuser bypasses them, as the U-27 harness already notes) and the doc_uid immutability trigger (the ledger never
// changes doc_uid).
//
// BUILD-002 WP-02: source_object here also has job_state, job_result and the job_state CHECK, the columns that drizzle/0646 adds
// (document-extraction-job-migration.pglite.test.ts applies that file to the live definition and holds the two equal).
//
// As in U-27, only withTenantContext is replaced (by a double that opens one real PGlite transaction per call and refuses nesting),
// so the real createProject(), createBoq() and ledger statements run against real SQL.
import { createBoqPglite } from "./boq-keyset-pglite"

const PRODUCTS_SQL = `
CREATE TABLE compliance.products (
  id text PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  org_id text NOT NULL,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
`

export const SOURCE_OBJECT_BASE_SQL = `
CREATE TABLE compliance.source_object (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  client_id text,
  origin text NOT NULL,
  origin_ref text,
  mime_type text,
  byte_size bigint,
  storage_path text,
  sha256 text,
  title text,
  linked_entity_type text,
  linked_entity_id text,
  business_object_type text,
  extract_status text NOT NULL DEFAULT 'PENDING',
  extract_error text,
  page_count integer,
  char_count integer,
  created_by_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  deleted_at timestamp with time zone,
  doc_uid text NOT NULL,
  content_sha256 text,
  display_name text,
  erased_by_id text,
  erasure_authority text,
  content_erased_at timestamp with time zone,
  supersedes_doc_uid text,
  superseded_by_doc_uid text,
  is_current boolean NOT NULL DEFAULT true,
  CONSTRAINT source_object_doc_uid_unique UNIQUE (doc_uid),
  CONSTRAINT source_object_extract_status_check CHECK (extract_status = ANY (ARRAY['PENDING','EXTRACTING','EXTRACTED','CHUNKED','EMBEDDED','FAILED','SKIPPED_UNSUPPORTED','SKIPPED_NO_TEXT_LAYER'])),
  CONSTRAINT source_object_origin_check CHECK (origin = ANY (ARRAY['upload','connector','email','inapp','api']))
);
CREATE UNIQUE INDEX source_object_org_sha256_unique ON compliance.source_object USING btree (org_id, sha256) WHERE (deleted_at IS NULL);
`

/** What drizzle/0646 adds to source_object, as a plain ALTER (the migration file is the same change, written idempotent). */
export const SOURCE_OBJECT_JOB_SQL = `
ALTER TABLE compliance.source_object ADD COLUMN job_state text;
ALTER TABLE compliance.source_object ADD COLUMN job_result jsonb;
ALTER TABLE compliance.source_object ADD CONSTRAINT source_object_job_state_check
  CHECK (job_state IS NULL OR job_state = ANY (ARRAY['received','reading','needs_answers','ready','created','rejected']));
`

/** The U-27 harness plus products and source_object (with the 0646 columns). Same return shape as createBoqPglite(). */
export async function createExtractionPglite() {
  const h = await createBoqPglite()
  await h.pg.exec(PRODUCTS_SQL)
  await h.pg.exec(SOURCE_OBJECT_BASE_SQL)
  await h.pg.exec(SOURCE_OBJECT_JOB_SQL)
  return h
}

export async function insertProduct(h: Awaited<ReturnType<typeof createExtractionPglite>>, row: { id: string; org_id: string; name?: string }) {
  await h.pg.query("insert into compliance.products (id, org_id, name, slug) values ($1, $2, $3, $4)", [row.id, row.org_id, row.name ?? "Construction", `slug-${row.id}`])
}

/** projects.lead_user_id has a real foreign key to users.id (createProject's own comment says so), so a person must exist. */
export async function insertUser(h: Awaited<ReturnType<typeof createExtractionPglite>>, row: { id: string; org_id: string }) {
  await h.pg.query("insert into compliance.users (id, name, email, password_hash, org_id) values ($1, $2, $3, 'x', $4)", [row.id, `Person ${row.id}`, `${row.id}@example.test`, row.org_id])
}
