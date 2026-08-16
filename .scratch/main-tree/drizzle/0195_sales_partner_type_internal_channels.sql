-- Sales Engine channel-coverage audit (2026-07-14): the Owner's original 7
-- named channels (direct/digital, freelance commission agents, third-party
-- online sellers, BSNL enterprise, third-party offline sellers, own
-- employees, call-centre agents) were checked against sales_partner_type's
-- existing 5 values. 5 of 7 already map cleanly (direct/digital needs no
-- partner row at all -- it's the absence of a referral link; freelance
-- commission agents = commission_agent; third-party online/offline sellers
-- = third_party; BSNL enterprise = reseller, an enterprise channel partner
-- reselling to its own customer base). Two genuinely have no representable
-- value: "own employees" and "call-centre agents" are first-party/internal
-- channels, not external partners -- none of reseller/consultant/
-- referral_agent/commission_agent/third_party fit an in-house team member
-- or telecaller. ALTER TYPE ... ADD VALUE cannot run in the same
-- transaction it's used in (Postgres restriction, same as Wave 1's/Wave
-- 45's precedent in 0011/0035) -- kept as its own migration, no other
-- schema change.
ALTER TYPE compliance.sales_partner_type ADD VALUE IF NOT EXISTS 'internal_employee';
ALTER TYPE compliance.sales_partner_type ADD VALUE IF NOT EXISTS 'call_centre_agent';
