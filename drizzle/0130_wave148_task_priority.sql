-- Wave 148 (Phase4_Implementation_Plan.md, "task queue + priority"):
-- additive priority column. Default 0 for every existing row, so this is
-- a no-op reorder for pre-existing data (falls back to pure createdAt
-- ordering, identical to today's behavior).

ALTER TABLE compliance.tasks ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0;
