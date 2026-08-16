-- Wave 91 (Comparison CSV 2 gap analysis: DMS008 "Retention & Disposal" +
-- DMS006 "Full-text search"). documents had no retention-period/disposal-
-- date policy anywhere, and the existing "search" was metadata/category
-- filtering only, never real content search. disposalDate is computed once
-- at set-retention time (createdAt + retentionPeriodDays); legalHold blocks
-- disposal even past disposalDate (litigation/audit hold, standard
-- records-management concept). Full-text search indexes name + the vision-
-- extraction summary (Wave 35/76's documents.extracted_data->>'summary')
-- via a functional GIN index -- no new stored tsvector column, computed at
-- query time, matching this codebase's existing "read-time computation over
-- a live table" precedent (Wave 87 reorder suggestions, Wave 64 scorecards).

ALTER TABLE compliance.documents ADD COLUMN IF NOT EXISTS retention_period_days integer;
ALTER TABLE compliance.documents ADD COLUMN IF NOT EXISTS disposal_date date;
ALTER TABLE compliance.documents ADD COLUMN IF NOT EXISTS legal_hold boolean NOT NULL DEFAULT false;
ALTER TABLE compliance.documents ADD COLUMN IF NOT EXISTS is_disposed boolean NOT NULL DEFAULT false;
ALTER TABLE compliance.documents ADD COLUMN IF NOT EXISTS disposed_at timestamp;
ALTER TABLE compliance.documents ADD COLUMN IF NOT EXISTS disposed_by_id text;

CREATE INDEX IF NOT EXISTS idx_documents_disposal_date ON compliance.documents(disposal_date) WHERE is_disposed = false;

CREATE INDEX IF NOT EXISTS idx_documents_fulltext_search ON compliance.documents
  USING gin (to_tsvector('english', coalesce(name, '') || ' ' || coalesce(extracted_data->>'summary', '')));
