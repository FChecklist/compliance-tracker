-- R71 Phase 9: the three axes R70 Part 3 specified but never built, plus the
-- per-tenant profile table. All additive; no existing row exists to backfill
-- (memory_records/versions/sources are all still at 0 rows).

-- U9-01: the engagement axis. R-IMG-22 (S4-01, binding): the engagement/
-- matter barrier between two clients is a HARD REQUIREMENT for professional
-- firms (CA/law), not a configurable preference, and applies to both RLS and
-- the AI retrieval-candidate-assembly step. Nullable because the axis is
-- disabled entirely for verticals with no engagement concept (school, small
-- company).
CREATE TABLE compliance.engagements (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  -- The client/matter this engagement is walled off from every other one.
  -- Free text, not a FK: which table names "the client" varies by vertical
  -- (a CRM account, an ERP customer, a case file) and this table must not
  -- take a hard dependency on any one of them.
  client_ref text NOT NULL,
  matter_name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX engagements_org_id_idx ON compliance.engagements (org_id);

ALTER TABLE compliance.memory_records
  ADD COLUMN engagement_id text REFERENCES compliance.engagements(id);

-- U9-02: subject_class. R-IMG-23 (S5-03, binding): UNRESOLVED is a real,
-- distinct state that must never default to EMPLOYEE or COUNTERPARTY --
-- doing so would silently apply that class's legal rules (retention,
-- consent, rights) to a record that may not actually belong to that class.
ALTER TABLE compliance.memory_records
  ADD COLUMN subject_class text NOT NULL DEFAULT 'UNRESOLVED'
    CHECK (subject_class IN ('EMPLOYEE', 'CHILD', 'PARENT_GUARDIAN', 'COUNTERPARTY', 'TRUSTEE_DIRECTOR', 'UNRESOLVED'));

-- U9-03: record_class. A distinct taxonomy from memory_type (which describes
-- the record's EPISTEMIC kind -- FACT/PREFERENCE/RULE/etc) -- record_class
-- describes its DOCUMENT kind for retention/classification purposes.
-- memory_type is untouched, not overloaded, not dropped.
ALTER TABLE compliance.memory_records
  ADD COLUMN record_class text
    CHECK (record_class IS NULL OR record_class IN ('circular', 'minute', 'contract', 'decision', 'correspondence', 'policy', 'notice'));

-- U9-05: the tenant profile table. Overridable: display copy, optional-axis
-- enablement (e.g. whether the engagement axis applies to this org at all).
-- NEVER overridable: tenant isolation, subject-class rules, provenance -- no
-- column below can express any of those, by construction (there is no
-- column here that touches RLS, the subject_class CHECK, or provenance_type).
CREATE TABLE compliance.tenant_memory_profile (
  org_id text PRIMARY KEY,
  display_name text,
  engagement_axis_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
