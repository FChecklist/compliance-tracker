-- Payment confirmation flow, part 2: one small service_role-only lookup
-- so the new dpdp-invoice-email Edge Function (invoked right after
-- dpdp_owner_approve_payment succeeds) can build an invoice without
-- reaching into the dpdp schema directly -- that schema is not exposed
-- to PostgREST (rpc-types.ts's own header comment), so even a
-- service-role Edge Function must go through an RPC, the same as
-- dpdp-monday-email already does for every dpdp.* read it needs.

create or replace function public.dpdp_timer_invoice_details(p_payment_id text)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'paymentId', p.id,
    'orgId', p.org_id,
    'orgName', o.name,
    'plan', p.plan,
    'interval', p."interval",
    'amountPaise', p.amount_paise,
    'periodStart', p.period_start,
    'confirmedAt', p.confirmed_at,
    'confirmedNote', p.confirmed_note,
    'ownerMembershipId', m.id,
    'ownerEmail', ie.email
  )
  from dpdp.payment p
  join dpdp.organisation o on o.id = p.org_id
  left join dpdp.membership m on m.org_id = p.org_id and m.level = 'owner'
  left join dpdp.identity_email ie on ie.identity_id = m.identity_id and ie.is_primary
  where p.id = p_payment_id
$$;

revoke all on function public.dpdp_timer_invoice_details(text) from public, anon, authenticated;
grant execute on function public.dpdp_timer_invoice_details(text) to service_role;
