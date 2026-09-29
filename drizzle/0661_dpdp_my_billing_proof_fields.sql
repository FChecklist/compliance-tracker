-- Payment confirmation flow, part 5 -- dpdp_my_billing (the org owner's
-- own read of their billing state) was never widened when 0658 added the
-- proof columns, so the owner's own panel could not show back what they
-- had just submitted. Read-only change: same function, three more fields.

create or replace function public.dpdp_my_billing(p_org_id text default null)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_m dpdp.membership;
  v_sub dpdp.subscription;
  v_org dpdp.organisation;
begin
  v_m := public.dpdp__caller_membership(p_org_id);
  if v_m.id is null then
    raise exception 'Not a member of this organisation' using errcode = '42501';
  end if;
  if v_m.level <> 'owner' then
    raise exception 'Only the owner can see billing' using errcode = '42501';
  end if;

  select * into v_sub from dpdp.subscription where org_id = v_m.org_id;
  select * into v_org from dpdp.organisation where id = v_m.org_id;

  return jsonb_build_object(
    'orgId', v_m.org_id,
    'product', v_org.product,
    'state', coalesce(v_sub.state, 'trial'),
    'trialEndsAt', v_sub.trial_ends_at,
    'interval', v_sub."interval",
    'selfDeclaredAt', v_sub.self_declared_at,
    'selfDeclaredInterval', v_sub.self_declared_interval,
    'selfDeclaredAmountPaise', v_sub.self_declared_amount_paise,
    'selfDeclaredReference', v_sub.self_declared_reference,
    'selfDeclaredProofPath', v_sub.self_declared_proof_path,
    'selfDeclaredNote', v_sub.self_declared_note,
    'lastConfirmedAt', v_sub.last_confirmed_at
  );
end
$$;
