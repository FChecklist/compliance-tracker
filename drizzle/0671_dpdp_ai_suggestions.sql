-- AI work link: a shared pool of improvement ideas.
--
-- While an outside AI works for a person through their link, it may notice
-- something the product lacks (a feature, a report, a clearer wording, a
-- fix). It can now say so. Every idea lands in ONE shared pool, the same
-- pool for every AI on every link, so an AI can read what was already
-- suggested and add its voice instead of repeating it. We read the pool
-- ourselves and decide what to build.
--
-- Safety, by construction (the owner's rule: an AI link never changes the
-- product's code and never touches anyone's data):
--   * The pool is a SEPARATE table. No suggestion call reads or writes a job,
--     a person, an organisation or any customer row.
--   * The only things an AI link can do here are: add an idea, add its voice
--     to an existing idea, and read the pool. It cannot edit, delete or
--     re-status anything -- statuses and notes are set only by
--     public.dpdp_suggestion_set_status, granted to service_role alone.
--   * The pool never shows who or which organisation said it: the reader gets
--     kind, title, text, how many links agree, and our status. link_id is kept
--     only for the one-vote-per-link rule and the daily cap.
--   * Text that looks like personal or customer data is refused with a plain
--     sentence (email, phone number, PAN, Aadhaar, a link address with a
--     token, the organisation's own name).
--   * Capped: 20 new ideas per link per day, 2,000 characters of text.
--   * Same door as every other call: the link's token, rate limit and call
--     log. Tables are RLS-on with no policies and no grants, so they are
--     reachable only through these functions.

create table if not exists dpdp.ai_suggestion (
  id text primary key default replace(gen_random_uuid()::text, '-', ''),
  idea_key text not null,
  kind text not null,
  title text not null,
  body text not null,
  status text not null default 'new',
  endorse_count integer not null default 1,
  first_link_id text,
  internal_note text,
  created_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  last_endorsed_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  reviewed_at timestamp,
  constraint ai_suggestion_idea_key_unique unique (idea_key),
  constraint ai_suggestion_kind_check check (kind in ('feature', 'improvement', 'report', 'fix', 'wording', 'other')),
  constraint ai_suggestion_status_check check (status in ('new', 'under_review', 'planned', 'shipped', 'declined', 'duplicate')),
  constraint ai_suggestion_title_len check (char_length(title) between 5 and 120),
  constraint ai_suggestion_body_len check (char_length(body) between 10 and 2000)
);
create index if not exists ai_suggestion_rank_idx on dpdp.ai_suggestion (endorse_count desc, created_at desc);

create table if not exists dpdp.ai_suggestion_vote (
  suggestion_id text not null references dpdp.ai_suggestion (id),
  link_id text not null,
  voted_at timestamp not null default (clock_timestamp() at time zone 'UTC'),
  primary key (suggestion_id, link_id)
);
create index if not exists ai_suggestion_vote_link_idx on dpdp.ai_suggestion_vote (link_id, voted_at desc);

alter table dpdp.ai_suggestion enable row level security;
alter table dpdp.ai_suggestion_vote enable row level security;
revoke all on dpdp.ai_suggestion, dpdp.ai_suggestion_vote from public, anon, authenticated;

-- Votes are a record, not something to rewrite.
create or replace function dpdp.ai_suggestion_vote_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'dpdp.ai_suggestion_vote is append-only' using errcode = '42501';
end
$$;
drop trigger if exists ai_suggestion_vote_guard on dpdp.ai_suggestion_vote;
create trigger ai_suggestion_vote_guard before update or delete on dpdp.ai_suggestion_vote
  for each row execute function dpdp.ai_suggestion_vote_guard();

-- Words that make a suggestion identical to one already made: lower case,
-- letters and digits only, single spaces.
create or replace function public.dpdp__suggestion_key(p_title text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(lower(coalesce(p_title, '')), '[^a-z0-9]+', ' ', 'g'))
$$;

-- Refuses text that carries personal or customer data. Returns the reason, or null when clean.
create or replace function public.dpdp__suggestion_dirty(p_text text, p_org_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  t text := coalesce(p_text, '');
begin
  if t ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' then return 'an email address'; end if;
  if t ~ '(\+?91[\s-]?)?[6-9][0-9]{9}' then return 'a phone number'; end if;
  if t ~* '\m[A-Z]{5}[0-9]{4}[A-Z]\M' or t ~ '\m[2-9][0-9]{3}\s?[0-9]{4}\s?[0-9]{4}\M' then return 'a PAN or Aadhaar number'; end if;
  if t ~* '/ai/[a-z0-9_-]{16,}' or t ~* 'dpdp-ai-link/[a-z0-9_-]{16,}' or t ~* '#(undo|draft)=' then return 'a link address that carries a private token'; end if;
  if p_org_name is not null and char_length(btrim(p_org_name)) >= 4 and position(lower(btrim(p_org_name)) in lower(t)) > 0 then
    return 'the name of the organisation this link belongs to';
  end if;
  return null;
end
$$;

-- POST /suggestions. Either a new idea (kind, title, body) or p_endorse_id: add this link's voice to an existing idea.
create or replace function public.dpdp_ai_link_suggest(
  p_token text, p_kind text, p_title text, p_body text, p_endorse_id text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_l dpdp.ai_link;
  v_org_name text;
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_key text;
  v_dirty text;
  v_row dpdp.ai_suggestion;
  v_new_votes integer;
  v_made_today integer;
  v_duplicate boolean := false;
begin
  v_l := public.dpdp__ai_link_for_token(p_token);
  select o.name into v_org_name
    from dpdp.membership m join dpdp.organisation o on o.id = m.org_id
   where m.id = v_l.membership_id;

  if p_endorse_id is not null and btrim(p_endorse_id) <> '' then
    select s.* into v_row from dpdp.ai_suggestion s where s.id = btrim(p_endorse_id);
    if not found then raise exception 'No such suggestion. Read GET /suggestions for the ids.' using errcode = 'P0002'; end if;
    v_duplicate := true;
  else
    if p_kind is null or p_kind not in ('feature', 'improvement', 'report', 'fix', 'wording', 'other') then
      raise exception 'kind must be one of: feature, improvement, report, fix, wording, other' using errcode = '22023';
    end if;
    if char_length(v_title) < 5 or char_length(v_title) > 120 then
      raise exception 'title must be 5 to 120 characters' using errcode = '22023';
    end if;
    if char_length(v_body) < 10 or char_length(v_body) > 2000 then
      raise exception 'body must be 10 to 2000 characters: what is missing or could be better, and why it would help' using errcode = '22023';
    end if;
    v_dirty := coalesce(public.dpdp__suggestion_dirty(v_title, v_org_name), public.dpdp__suggestion_dirty(v_body, v_org_name));
    if v_dirty is not null then
      raise exception 'A suggestion is about the product, not about one customer. It contains %. Remove it and send again.', v_dirty using errcode = '22023';
    end if;
    v_key := public.dpdp__suggestion_key(v_title);
    select s.* into v_row from dpdp.ai_suggestion s where s.idea_key = v_key;
    if found then
      v_duplicate := true;
    else
      select count(*) into v_made_today from dpdp.ai_suggestion s
       where s.first_link_id = v_l.id and s.created_at > (clock_timestamp() at time zone 'UTC') - interval '1 day';
      if v_made_today >= 20 then
        raise exception 'Daily limit reached: 20 new suggestions per link per day. Endorse existing ones instead (GET /suggestions).' using errcode = '22023';
      end if;
      insert into dpdp.ai_suggestion (idea_key, kind, title, body, first_link_id)
        values (v_key, p_kind, v_title, v_body, v_l.id) returning * into v_row;
      insert into dpdp.ai_suggestion_vote (suggestion_id, link_id) values (v_row.id, v_l.id);
      return jsonb_build_object('suggestionId', v_row.id, 'status', v_row.status, 'duplicate', false, 'endorseCount', v_row.endorse_count);
    end if;
  end if;

  -- An existing idea: this link adds its voice once.
  insert into dpdp.ai_suggestion_vote (suggestion_id, link_id) values (v_row.id, v_l.id) on conflict do nothing;
  get diagnostics v_new_votes = row_count;
  if v_new_votes > 0 then
    update dpdp.ai_suggestion set endorse_count = endorse_count + 1, last_endorsed_at = (clock_timestamp() at time zone 'UTC')
     where id = v_row.id returning * into v_row;
  end if;
  return jsonb_build_object('suggestionId', v_row.id, 'status', v_row.status, 'duplicate', true, 'endorseCount', v_row.endorse_count, 'alreadyEndorsed', v_new_votes = 0);
end
$$;

-- GET /suggestions: the shared pool, most-agreed first. No link, person or organisation, and no internal note.
create or replace function public.dpdp_ai_link_suggestions(p_token text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_l dpdp.ai_link;
begin
  v_l := public.dpdp__ai_link_for_token(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'kind', s.kind, 'title', s.title, 'body', s.body, 'status', s.status,
             'endorseCount', s.endorse_count,
             'endorsedByThisLink', exists (select 1 from dpdp.ai_suggestion_vote v where v.suggestion_id = s.id and v.link_id = v_l.id),
             'createdOn', to_char(s.created_at, 'YYYY-MM-DD'))
           order by s.endorse_count desc, s.created_at desc)
      from (select * from dpdp.ai_suggestion x order by x.endorse_count desc, x.created_at desc limit 200) s
  ), '[]'::jsonb);
end
$$;

-- OUR side only (service_role): set an idea's status and an internal note. Never reachable from a link.
create or replace function public.dpdp_suggestion_set_status(p_id text, p_status text, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row dpdp.ai_suggestion;
begin
  if p_status not in ('new', 'under_review', 'planned', 'shipped', 'declined', 'duplicate') then
    raise exception 'unknown status' using errcode = '22023';
  end if;
  update dpdp.ai_suggestion set status = p_status, internal_note = coalesce(p_note, internal_note), reviewed_at = (clock_timestamp() at time zone 'UTC')
   where id = p_id returning * into v_row;
  if not found then raise exception 'no such suggestion' using errcode = 'P0002'; end if;
  return jsonb_build_object('id', v_row.id, 'status', v_row.status);
end
$$;

revoke all on function public.dpdp_ai_link_suggest(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.dpdp_ai_link_suggestions(text) from public, anon, authenticated;
revoke all on function public.dpdp_suggestion_set_status(text, text, text) from public, anon, authenticated;
revoke all on function public.dpdp__suggestion_key(text) from public, anon, authenticated;
revoke all on function public.dpdp__suggestion_dirty(text, text) from public, anon, authenticated;
grant execute on function public.dpdp_ai_link_suggest(text, text, text, text, text) to service_role, app_runtime;
grant execute on function public.dpdp_ai_link_suggestions(text) to service_role, app_runtime;
grant execute on function public.dpdp_suggestion_set_status(text, text, text) to service_role;
grant execute on function public.dpdp__suggestion_key(text), public.dpdp__suggestion_dirty(text, text) to service_role, app_runtime;
