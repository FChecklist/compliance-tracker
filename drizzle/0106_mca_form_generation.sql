-- CS MCA e-form data generation (AOC-4/MGT-7/DIR-12/CHG-1). Adds structured
-- form_data + generated_at to the existing mca_filings tracker table --
-- still stops at compiling real, filing-ready data (no portal submission,
-- same honest boundary the table's own comment already documents).
ALTER TABLE compliance.mca_filings ADD COLUMN IF NOT EXISTS form_data jsonb;
ALTER TABLE compliance.mca_filings ADD COLUMN IF NOT EXISTS generated_at timestamp;
