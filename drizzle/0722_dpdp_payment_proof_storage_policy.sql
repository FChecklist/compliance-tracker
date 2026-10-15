-- PRE-APPROVED-LIVE-DDL: Owner DPDP compliance fix programme brief, 2026-10-05, Wave 2 (storage policy for the payment-proof bucket)
--
-- DPDP compliance programme, Wave 2. The bucket dpdp-payment-proofs (0658) let any signed-in person upload any file of any size to any path, and read
-- nothing back. Now:
--  * a person can upload only into a folder named after their own sign-in id (the first path segment is auth.uid()), so one person cannot write into
--    or over another's folder;
--  * the bucket itself refuses a file over 5 MB and any type other than PNG, JPEG, WebP or PDF;
--  * a person can read back only their own folder; a platform admin (the owner, who confirms payments) can read every one; nobody can read across;
--  * there is still no update or delete policy, so an uploaded proof cannot be changed or removed by a browser.
-- The app (dpdp-app/src/lib/client.ts) now uploads to <sign-in id>/<organisation id>-<random>.<ext>. Older proofs under <organisation id>/ stay readable by
-- the platform admin as before. Roll-back: drizzle/down/0698_dpdp_payment_proof_storage_policy.down.sql.

update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
 where id = 'dpdp-payment-proofs';

drop policy if exists "dpdp payment proof insert" on storage.objects;
create policy "dpdp payment proof insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'dpdp-payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "dpdp payment proof read (admin only)" on storage.objects;
drop policy if exists "dpdp payment proof read" on storage.objects;
create policy "dpdp payment proof read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'dpdp-payment-proofs'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.dpdp__is_platform_admin())
  );
