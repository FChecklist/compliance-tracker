-- PRE-APPROVED-LIVE-DDL: Owner instruction in chat, 2026-09-30 -- "in email itself give the AI WORK LINK - WHY SHOULD USER OPEN PAGE AND COPY THE LINK ... my objective is that user should in most cases never open the webpage, they use AI WORK LINK, PASTE IT IN AI AND WORK IS DONE" and, on the link's authority, "ITS NOT read-only 7-day AI Work link. ITS READ / EDIT / WORK". Authorizes the GRANT/REVOKE/SECURITY DEFINER statements below; applied to the live database by the session that wrote it, under this instruction, via the Supabase Management API.
--
-- DPDP: the AI work link inside the Monday email.
--
-- WHAT. One service-role-only function, public.dpdp_timer_mint_email_ai_link,
-- that the dpdp-monday-email Edge Function calls once per recipient, right
-- before it sends that person's Monday digest, so the email itself can carry
-- the person's AI work link. The person no longer has to open their page,
-- make a link and copy it: the link is in the email, ready to paste into any
-- AI (ChatGPT, Claude, Gemini, ...).
--
-- AUTHORITY OF THE LINK (the owner's words: READ / EDIT / WORK). This maps
-- onto the three levels of WO-DPDP-013 v2 §1.2 exactly as 0610 built them:
--   READ  = level 0: every GET (jobs, law, reports, history).
--   EDIT  = level 1: NOTE, SET_DUE, ASSIGN (existing members only), MARK_NA,
--           applied directly under the person's own authority, written to
--           history as "by <person> via AI assistant", undoable for 24 hours,
--           and listed in the person's next Monday email.
--   WORK  = anything with legal weight (mark done, attest, add a person ...):
--           the AI writes a DRAFT (POST /drafts, available on every link) and
--           the person confirms it with one tap in their own browser
--           (dpdp_confirm_ai_draft). That is not a link property and 0610
--           refuses it for every link on purpose; this file does not change
--           it. Everything the owner asked for is therefore available from a
--           level 1 link; nothing here raises a link above level 1.
-- The default level of a link minted here is 1. The owner has said in chat
-- that this is what the emailed link is; the caller may pass 0 (read only)
-- through DPDP_EMAIL_AI_LINK_LEVEL.
--
-- WHY A NEW FUNCTION AND NOT dpdp_ai_link_create. That function resolves the
-- caller from the browser's JWT (dpdp__caller_membership), so it cannot be
-- called by the timer, which acts for a membership it names. This function
-- takes the membership id, checks it is an active membership, and otherwise
-- inserts exactly the row dpdp_ai_link_create inserts (same columns, same
-- hashed token, same audit event) -- so the AI link API and the app's link
-- list treat an emailed link like any other.
--
-- WHAT IT ADDS.
--   * label 'Monday email' marks these links. Minting a new one retires the
--     previous LIVE 'Monday email' link of the SAME membership (revoked_at),
--     so a person has at most one live emailed link at a time and last week's
--     email cannot be used after this week's arrives. Links the person made
--     themselves (any other label) are never touched.
--   * The token is returned once and never stored (only sha256 is), like
--     dpdp_ai_link_create.
--   * Expiry 1, 7 or 30 days (the same three values 0610 allows). The caller
--     uses 7: the next Monday's email brings a fresh link.
--
-- Additive only: one new function. No table, column or existing function is
-- changed.

create or replace function public.dpdp_timer_mint_email_ai_link(
  p_membership_id text,
  p_level integer default 1,
  p_days integer default 7
)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_email text;
  v_token text;
  v_hash text;
  v_now timestamp := (clock_timestamp() at time zone 'UTC');
  v_expires timestamp;
  v_id text;
  v_level integer := coalesce(p_level, 1);
  v_days integer := coalesce(p_days, 7);
  v_warning jsonb;
  v_retired integer;
begin
  select m.* into v_m from dpdp.membership m where m.id = p_membership_id and m.state = 'active';
  if v_m.id is null then
    raise exception 'No active membership %', p_membership_id using errcode = 'P0002';
  end if;
  if v_level not in (0, 1) then
    raise exception 'level must be 0 (read, analyse, report) or 1 (small edits, directly). Anything with legal weight is always a draft.' using errcode = '22023';
  end if;
  if v_days not in (1, 7, 30) then
    raise exception 'The link can last 1, 7 or 30 days' using errcode = '22023';
  end if;

  -- One live emailed link per person: last week's stops working now.
  update dpdp.ai_link
  set revoked_at = v_now
  where membership_id = v_m.id
    and label = 'Monday email'
    and revoked_at is null
    and expires_at > v_now;
  get diagnostics v_retired = row_count;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');
  v_expires := v_now + make_interval(days => v_days);
  v_id := replace(gen_random_uuid()::text, '-', '');

  insert into dpdp.ai_link (
    id, org_id, identity_id, membership_id, token, token_hash, created_at, expires_at, read_count,
    authority_level, hide_emails, created_by_membership_id, label, call_count
  ) values (
    v_id, v_m.org_id, v_m.identity_id, v_m.id, null, v_hash, v_now, v_expires, 0,
    v_level, false, v_m.id, 'Monday email', 0
  );

  select i.primary_email into v_email from dpdp.identity i where i.id = v_m.identity_id;
  perform public.dpdp__append_event(
    v_m.org_id, v_m.identity_id, v_email, 'ai_link_created', 'Made an AI work link',
    'Level ' || v_level || case when v_level = 1 then ' (read and small edits, directly; anything with legal weight is a draft to confirm)' else ' (read, analyse, report)' end
      || ', put in the Monday email, expires ' || to_char(v_expires, 'YYYY-MM-DD HH24:MI') || ' UTC'
      || case when v_retired > 0 then ', replaced last week''s emailed link' else '' end
  );

  v_warning := public.dpdp__ai_link_warning_for(v_m.id);
  return jsonb_build_object(
    'linkId', v_id,
    'token', v_token,
    'level', v_level,
    'expiresAt', to_char(v_expires, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'jobs', v_warning -> 'jobs',
    'people', v_warning -> 'people'
  );
end
$$;

revoke all on function public.dpdp_timer_mint_email_ai_link(text, integer, integer) from public, anon, authenticated;
grant execute on function public.dpdp_timer_mint_email_ai_link(text, integer, integer) to service_role;
