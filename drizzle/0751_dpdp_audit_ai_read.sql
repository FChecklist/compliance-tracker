-- DPDP audit trail: record what an AI work link READS (event type 'ai_read').
-- Why: the audit trail already records every change an AI makes (ai_action / ai_draft triggers) and every business event, but a plain read through an
-- AI work link only left a row in dpdp.ai_link_call, never in dpdp.audit_event, although the Privacy Notice says the log holds "anything an AI assistant
-- read ... through an AI work link" (DPDP data audit 2026-10-14, D21). This trigger closes that gap.
-- Only the first path segment is written (for example "snapshot.md" or "jobs"), never the full path and never the link token. audit_write() never raises
-- (it swallows its own errors into dpdp.audit_failure), and this wrapper catches too, so an audit fault can never block an AI link call.
create or replace function dpdp.audit_from_ai_link_read()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.method = 'GET' and new.org_id is not null and new.link_id is not null then
    begin
      perform dpdp.audit_write(new.org_id, 'ai_read', 'ai_link', null, 'dpdp.ai_link_call', new.id, null, new.link_id,
        jsonb_build_object('via', 'ai_work_link', 'what', split_part(ltrim(coalesce(new.path, ''), '/'), '/', 1)), null, new.id);
    exception when others then
      null;
    end;
  end if;
  return new;
end
$$;

create or replace trigger audit_from_ai_link_read after insert on dpdp.ai_link_call
  for each row execute function dpdp.audit_from_ai_link_read();
