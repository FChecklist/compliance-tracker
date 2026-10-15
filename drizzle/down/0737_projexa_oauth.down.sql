-- PRE-APPROVED-LIVE-DDL: Owner delegated full PM authority in chat on 2026-10-07 to build the "Sign in with PROJEXA" connector layer; this is the rollback of 0737_projexa_oauth.sql (drops only the objects that migration created).
DROP FUNCTION IF EXISTS public.px_oauth_take_code(text);
DROP FUNCTION IF EXISTS public.px_oauth_put_code(text, text, text, text, text, int);
DROP FUNCTION IF EXISTS public.px_oauth_get_client(text);
DROP FUNCTION IF EXISTS public.px_oauth_register(text, text, text[]);
DROP TABLE IF EXISTS platform.px_oauth_codes;
DROP TABLE IF EXISTS platform.px_oauth_clients;
