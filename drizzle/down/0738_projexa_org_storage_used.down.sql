-- PRE-APPROVED-LIVE-DDL: roll-back of drizzle/0738_projexa_org_storage_used.sql (Owner-delegated PM authority, PROJEXA upload cap, 2026-10-08)
-- down: drop the per-organisation storage read (deploy the projexa-api version without the cap check first, or sign requests answer 503)
DROP FUNCTION IF EXISTS public.projexa_org_storage_used(text);
