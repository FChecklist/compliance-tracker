-- PRE-APPROVED-LIVE-DDL: owner request 2026-10-10 ("fix the 6 product problems" found while writing the PROJEXA user manual), problem 3.
--
-- The drawings screen offers "DWG Drawing" and "File (DWG)", but the compliance-documents bucket's allowed_mime_types had no CAD type at all, so
-- Storage refused the upload and the app showed only its flat "Failed to upload file". Add the CAD types (DWG, DXF) to the allow-list. The list is
-- extended, never replaced, and application/octet-stream is deliberately NOT added: that would let any binary in. The app now sends a CAD type for
-- .dwg/.dxf files itself (document-service.ts), because browsers send an empty type for them.
-- Roll-back: update storage.buckets set allowed_mime_types = (select array_agg(t) from unnest(allowed_mime_types) t
--   where t not in ('image/vnd.dwg','image/x-dwg','application/acad','application/x-acad','application/dwg','application/x-dwg','image/vnd.dxf','image/x-dxf','application/dxf','application/x-dxf')) where id = 'compliance-documents';

update storage.buckets
   set allowed_mime_types = (
         select array_agg(distinct t)
           from unnest(allowed_mime_types || array['image/vnd.dwg', 'image/x-dwg', 'application/acad', 'application/x-acad', 'application/dwg', 'application/x-dwg', 'image/vnd.dxf', 'image/x-dxf', 'application/dxf', 'application/x-dxf']) as t
       )
 where id = 'compliance-documents';
