-- Wave 172 (area 16, Account/Organization lifecycle -- U-D27.B1.S1, AND
-- area 11, Cost management -- embedded in U-D14.B1.S1): both areas needed
-- one additive org-scoped opt-in-control pair, bundled in a single
-- migration since both land on the same organisations table. All 4 columns
-- default to their "no enforcement" state -- no pre-existing org is
-- affected until an admin deliberately turns a control on. See
-- org-license-service.ts and cost-guard.ts for the enforcement logic.

ALTER TABLE compliance.organisations ADD COLUMN IF NOT EXISTS licensed_seats integer;
ALTER TABLE compliance.organisations ADD COLUMN IF NOT EXISTS seat_enforcement_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE compliance.organisations ADD COLUMN IF NOT EXISTS monthly_cost_cap_usd numeric(10, 2);
ALTER TABLE compliance.organisations ADD COLUMN IF NOT EXISTS cost_cap_enforcement_enabled boolean NOT NULL DEFAULT false;
