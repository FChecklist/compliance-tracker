-- Rollback of 0732. Delete the bucket's objects through the Storage API first (storage.objects rows cannot be dropped by SQL safely).
BEGIN;
DROP FUNCTION IF EXISTS public.projexa_upload_sign_reserve(text, integer);
DROP TABLE IF EXISTS public.projexa_upload_sign_log;
DELETE FROM storage.buckets WHERE id = 'projexa-files' AND NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'projexa-files');
COMMIT;
