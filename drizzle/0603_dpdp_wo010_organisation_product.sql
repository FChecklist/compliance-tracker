-- WO-DPDP-010: organisation.product ('firm'|'institution') -- gap found
-- while wiring instantiateObligationsForOrg to the new product-keyed
-- library (0602): without this, every org would receive all 59 jobs
-- (both firm's 31 and institution's 28) instead of just its own 31/28.
-- Missed in 0601's first pass despite being explicitly listed in the WO's
-- own §2 Organisation row ("must support: product, owner, ..."); recorded
-- honestly as a follow-up rather than silently folded into 0601.
ALTER TABLE "dpdp"."organisation" ADD COLUMN "product" text;
-- Backfill existing test orgs so instantiateObligationsForOrg's new filter
-- (below) doesn't silently zero out jobs for orgs created before this
-- column existed. Best-effort inference only for pre-existing rows: an org
-- with a 'fiduciary' capability and no institution-shaped obligations is
-- assumed 'firm' (the only product that existed before this WO). This does
-- NOT retroactively fix which library version those orgs' existing
-- obligations point to -- only which product future re-instantiation uses.
UPDATE dpdp.organisation SET product = 'firm' WHERE product IS NULL;
