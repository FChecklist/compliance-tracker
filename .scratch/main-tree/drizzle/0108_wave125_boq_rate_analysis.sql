-- Construction Intelligence, Wave 125 (2026-07-08): BOQ rate analysis /
-- cost buildup (OpenConstructionERP-style concept studied, AGPL-3.0, no
-- code copied). Sixth wave building PROJEXA construction modules inside
-- VERIDIAN AI OS. Purely additive: 5 nullable numeric columns on an
-- existing table. BIM support needs zero schema change (documents.category
-- already accepts any free-text value, e.g. 'bim_model').

ALTER TABLE compliance.construction_boq_line_items ADD COLUMN IF NOT EXISTS material_cost numeric;
ALTER TABLE compliance.construction_boq_line_items ADD COLUMN IF NOT EXISTS labour_cost numeric;
ALTER TABLE compliance.construction_boq_line_items ADD COLUMN IF NOT EXISTS equipment_cost numeric;
ALTER TABLE compliance.construction_boq_line_items ADD COLUMN IF NOT EXISTS overhead_percent numeric;
ALTER TABLE compliance.construction_boq_line_items ADD COLUMN IF NOT EXISTS profit_percent numeric;
