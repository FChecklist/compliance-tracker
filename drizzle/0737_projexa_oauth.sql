-- PRE-APPROVED-LIVE-DDL: Owner delegated full PM authority in chat on 2026-10-07 ("all recommendations accepted, ok do it. completely end to end") to build the "Sign in with PROJEXA" connector layer (OAuth for ChatGPT/Claude/Gemini). Adds two new service-role-only tables and four service-role-only SECURITY DEFINER functions; touches no existing table; rollback in drizzle/down/0737_projexa_oauth.down.sql.
-- PROJEXA OAuth (connector sign-in): public clients registered by dynamic client registration (RFC 7591) and one-time authorization codes (PKCE S256).
-- Nothing here is readable by the browser roles: RLS is on with no policy, every grant is service_role only, and the Edge Function projexa-oauth is the only caller.
CREATE TABLE IF NOT EXISTS platform.px_oauth_clients (
  client_id     text PRIMARY KEY,
  client_name   text NOT NULL,
  redirect_uris text[] NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS platform.px_oauth_codes (
  code_hash      text PRIMARY KEY,
  client_id      text NOT NULL REFERENCES platform.px_oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri   text NOT NULL,
  code_challenge text NOT NULL,
  link_token     text NOT NULL,
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE platform.px_oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.px_oauth_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON platform.px_oauth_clients, platform.px_oauth_codes FROM PUBLIC, anon, authenticated;
GRANT ALL ON platform.px_oauth_clients, platform.px_oauth_codes TO service_role;

CREATE OR REPLACE FUNCTION public.px_oauth_register(p_client_id text, p_name text, p_redirect_uris text[])
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO platform.px_oauth_clients (client_id, client_name, redirect_uris) VALUES (p_client_id, p_name, p_redirect_uris);
$$;
CREATE OR REPLACE FUNCTION public.px_oauth_get_client(p_client_id text)
RETURNS TABLE (client_name text, redirect_uris text[]) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT c.client_name, c.redirect_uris FROM platform.px_oauth_clients c WHERE c.client_id = p_client_id;
$$;
CREATE OR REPLACE FUNCTION public.px_oauth_put_code(p_code_hash text, p_client_id text, p_redirect_uri text, p_code_challenge text, p_link_token text, p_ttl_seconds int)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM platform.px_oauth_codes WHERE expires_at < now();
  INSERT INTO platform.px_oauth_codes (code_hash, client_id, redirect_uri, code_challenge, link_token, expires_at)
  VALUES (p_code_hash, p_client_id, p_redirect_uri, p_code_challenge, p_link_token, now() + make_interval(secs => p_ttl_seconds));
$$;
-- One use: the row is deleted as it is read, so a replayed code finds nothing.
CREATE OR REPLACE FUNCTION public.px_oauth_take_code(p_code_hash text)
RETURNS TABLE (client_id text, redirect_uri text, code_challenge text, link_token text) LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM platform.px_oauth_codes c WHERE c.code_hash = p_code_hash AND c.expires_at > now()
  RETURNING c.client_id, c.redirect_uri, c.code_challenge, c.link_token;
$$;
REVOKE ALL ON FUNCTION public.px_oauth_register(text, text, text[]), public.px_oauth_get_client(text),
  public.px_oauth_put_code(text, text, text, text, text, int), public.px_oauth_take_code(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.px_oauth_register(text, text, text[]), public.px_oauth_get_client(text),
  public.px_oauth_put_code(text, text, text, text, text, int), public.px_oauth_take_code(text) TO service_role;
