-- PRE-APPROVED-LIVE-DDL: Owner delegated full PM authority and ordered the 100-point audit gaps fixed first, in chat on 2026-10-05; this file only rolls back three additive indexes (DROP INDEX IF EXISTS), it is never applied by the migrator.
DROP INDEX IF EXISTS compliance.idx_construction_wpe_activity_entry_date;
DROP INDEX IF EXISTS compliance.idx_construction_activities_org_project;
DROP INDEX IF EXISTS compliance.idx_construction_wpe_org_project_entry_date;
