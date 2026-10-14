-- PRE-APPROVED-LIVE-DDL: Task instruction 2026-10-14 (owner order: the DPDP audit fixes of DPDP_DATA_AUDIT_2026-10-14.md section 7). Roll-back file for 0762_dpdp_email_send_metadata_only.sql; it is not run unless the project manager decides to undo that migration.
-- Drops the no-body check and restores the 0660 function (a dry run stores its body again). Bodies cleared by 0762 cannot be restored.
alter table dpdp.email_send drop constraint if exists email_send_no_body;

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
    insert into dpdp.email_send (
      id, org_id, membership_id, identity_id, obligation_ids, kind, period_key, to_email, subject, body_text, status, list_unsubscribe_token_hash
    ) values (
      v_id, p_org_id, p_membership_id, p_identity_id, coalesce(p_obligation_ids, '{}'::text[]), p_kind, p_period_key, p_to_email, p_subject,
      case when p_status = 'dry_run' then p_body_text end, p_status, dpdp.email_token_hash(v_raw)
    );
  exception when unique_violation then
    return jsonb_build_object('id', null, 'duplicate', true);
  end;
  return jsonb_build_object('id', v_id, 'unsubscribeToken', v_raw, 'duplicate', false);
end
$$;
