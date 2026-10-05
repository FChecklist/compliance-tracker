-- PRE-APPROVED-LIVE-DDL: Owner DPDP compliance fix programme brief, 2026-10-05, Wave 2 roll-back
-- Restores the 0658 policies (any signed-in person may upload; only a platform admin reads) and lifts the bucket limits.
update storage.buckets set file_size_limit = null, allowed_mime_types = null where id = 'dpdp-payment-proofs';
drop policy if exists "dpdp payment proof insert" on storage.objects;
create policy "dpdp payment proof insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'dpdp-payment-proofs');
drop policy if exists "dpdp payment proof read" on storage.objects;
drop policy if exists "dpdp payment proof read (admin only)" on storage.objects;
create policy "dpdp payment proof read (admin only)" on storage.objects
  for select to authenticated
  using (bucket_id = 'dpdp-payment-proofs' and public.dpdp__is_platform_admin());
