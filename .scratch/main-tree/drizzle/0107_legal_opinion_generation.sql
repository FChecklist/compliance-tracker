-- Legal opinion document drafting -- reuses clm_contract_templates/
-- clm_template_clauses/clm_clauses (same tables CLM contract generation
-- already uses), so only the target document (legal_opinions) needs new
-- columns.
ALTER TABLE compliance.legal_opinions ADD COLUMN IF NOT EXISTS template_id text;
ALTER TABLE compliance.legal_opinions ADD COLUMN IF NOT EXISTS body_text text;
ALTER TABLE compliance.legal_opinions ADD COLUMN IF NOT EXISTS generated_at timestamp;
