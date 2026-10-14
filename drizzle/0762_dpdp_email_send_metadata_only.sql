-- PRE-APPROVED-LIVE-DDL: Task instruction 2026-10-14 (owner order: the DPDP audit fixes of DPDP_DATA_AUDIT_2026-10-14.md section 7, fix 5: stop storing full e-mail bodies in dpdp.email_send). Applied by the project manager.
--
-- dpdp.email_send is the log of e-mails we sent: who, which kind, which subject, whether it was delivered. Until now a DRY-RUN row (a Monday e-mail built but not sent,
-- used while the mail key was not set) also kept the full text of the message, about 3.4 KB each (1,220 rows on 2026-10-14, every one from 22-29 September). The
-- Privacy Notice says the log holds "the e-mails we send you, whether they were delivered", not their content, and the body had no deletion rule of its own.
-- Now:
--   1. dpdp.record_email_send no longer stores a body, whatever the caller passes (the parameter is kept so older callers still work);
--   2. the bodies already stored are cleared;
--   3. a CHECK makes it impossible to store one again.
-- Roll-back: drizzle/down/0762_dpdp_email_send_metadata_only.down.sql (drops the check and restores the previous function; cleared bodies are not restorable).

create or replace function dpdp.record_email_send(
  p_org_id text,
  p_membership_id text,
  p_identity_id text,
  p_obligation_ids text[],
  p_kind text,
  p_period_key text,
  p_to_email text,
  p_subject text,
  p_status text default 'queued',
  p_body_text text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id text := replace(gen_random_uuid()::text, '-', '');
  v_raw text := dpdp.new_opaque_token();
begin
  if p_kind not in ('monday_digest', 'escalation', 'leak_clock', 'rights_clock', 'statutory', 'invoice') then
    raise exception 'Unknown email kind %', p_kind using errcode = '22023';
  end if;
  if p_status not in ('queued', 'dry_run') then
    raise exception 'record_email_send accepts status queued or dry_run, not %', p_status using errcode = '22023';
  end if;
  begin
    -- body_text is always null: the log keeps metadata only.
    insert into dpdp.email_send (
      id, org_id, membership_id, identity_id, obligation_ids, kind, period_key, to_email, subject, body_text, status, list_unsubscribe_token_hash
    ) values (
      v_id, p_org_id, p_membership_id, p_identity_id, coalesce(p_obligation_ids, '{}'::text[]), p_kind, p_period_key, p_to_email, p_subject,
      null, p_status, dpdp.email_token_hash(v_raw)
    );
  exception when unique_violation then
    return jsonb_build_object('id', null, 'duplicate', true);
  end;
  return jsonb_build_object('id', v_id, 'unsubscribeToken', v_raw, 'duplicate', false);
end
$$;

update dpdp.email_send set body_text = null where body_text is not null;

do $$ begin
  alter table dpdp.email_send add constraint email_send_no_body check (body_text is null);
exception when duplicate_object then null; end $$;
