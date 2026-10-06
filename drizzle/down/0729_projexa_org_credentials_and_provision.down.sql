-- PRE-APPROVED-LIVE-DDL: rollback of G-09 (drizzle/0729_projexa_org_credentials_and_provision.sql), same owner order as the forward file.
-- Down-migration for drizzle/0729. Run deliberately by the PM, not by any script.
-- DATA LOSS: DROPS public-side credentials rows in compliance.projexa_org_credentials (the VERIDIAN org + key of every organisation provisioned through the edge
-- function). Roll the client back FIRST (PX_API_EDGE_ENABLED=false for /api/org/*), and confirm the legacy PROJEXA public.veridian_credentials mirror has the row
-- for every org you care about, before running this. Organisations and api_keys the function created stay.
BEGIN;
DROP FUNCTION IF EXISTS public.projexa_org_veridian_id_get(uuid);
DROP FUNCTION IF EXISTS public.projexa_org_credential_get(uuid);
DROP FUNCTION IF EXISTS public.projexa_org_credential_put(uuid, text, text);
DROP FUNCTION IF EXISTS public.projexa_provision_org(text, text, text, text, text);
DROP TABLE IF EXISTS compliance.projexa_org_credentials;
COMMIT;
