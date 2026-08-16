-- PageAgent removal (Owner directive: "remove PageAgent it doesn fit VERIDIAN").
-- Safe per live check: compliance.personal_model_config had 0 rows; only 1 of
-- 16 orgs had page_agent_enabled=true, and it was never functionally
-- consulted (PAGE_AGENT_ENABLED=false has kill-switched every call site
-- since before this removal).
DROP TABLE IF EXISTS compliance.personal_model_config;
ALTER TABLE compliance.organisations DROP COLUMN IF EXISTS page_agent_enabled;
