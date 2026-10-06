# PROJEXA file upload without Vercel: the CONTRACT (2026-10-06)

Laptop -> `projexa-api` `POST /uploads/sign` -> one-time signed Supabase Storage address -> laptop PUTs the bytes straight to Storage -> laptop saves the record
(`create_permit` / `create_drawing` / `create_document` via ai-work-link, which accept `externalUrl`).
Code: `supabase/functions/projexa-api/upload-sign.ts`. SQL: `drizzle/0732_projexa_files_bucket_and_sign_log.sql`. Tests: `src/lib/services/projexa-upload-sign.test.ts`.

## Request

`POST https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-api/uploads/sign`
`Authorization: Bearer <the person's PROJEXA Supabase access token>`  (same verification as every projexa-api route; the organisation is the person's own membership, oldest first)

```json
{ "kind": "drawing", "projectId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "fileName": "Plan A.pdf", "contentType": "application/pdf", "size": 1234 }
```
`kind` permit|drawing|document; `projectId` optional uuid (validated, not part of the path); `size` whole bytes 1..52428800.

## Response 200

```json
{
  "uploadUrl": "https://pcrjmlpuqsbocqfwoxod.supabase.co/storage/v1/object/upload/sign/projexa-files/<orgId>/drawing/<uuid>/Plan A.pdf?token=...",
  "method": "PUT",
  "headers": { "content-type": "application/pdf", "x-upsert": "false" },
  "externalUrl": "https://pcrjmlpuqsbocqfwoxod.supabase.co/storage/v1/object/public/projexa-files/<orgId>/drawing/<uuid>/Plan%20A.pdf",
  "expiresAt": "2026-10-06T12:00:00.000Z",
  "maxBytes": 52428800
}
```
Client: `PUT uploadUrl` with exactly `headers` and the raw file bytes as body (Storage answers 200 `{"Key": ...}`), then save the record with `externalUrl`
(permanent, public read, never expires). The signed address is valid ~2 hours and cannot overwrite (`x-upsert: false`). Send the same `content-type` you signed.

## Refusals

| Status | Body | Meaning | Client |
|---|---|---|---|
| 401 | `{"error":"Unauthorized"}` | no/bad/foreign-issuer token | sign in |
| 400 | `{"error":"No organization"}` | no membership | stop |
| 403 | `{"error":"Forbidden"}` | read-only role (client_viewer) | stop |
| 413 | `{"error":"File too large","maxBytes":52428800}` | size > 50 MB | stop, do not retry |
| 415 | `{"error":"File type not allowed"}` | content type not in the allow-list | stop |
| 422 | `{"error":"..."}` | bad body (kind, projectId, fileName, contentType, size) | fix |
| 429 | `{"error":"Too many uploads this hour"}` + `Retry-After: 300` | org signed > 200 in the last hour | back off |
| 5xx / 503 | `Retry-After: 5` | retryable | retry with backoff |
| 405 | | not POST | |

Allow-list: pdf, png, jpeg, webp, gif, heic, docx, xlsx, pptx, csv, txt, zip, dwg (`image/vnd.dwg`, `application/acad`, `application/x-dwg`), dxf (`image/vnd.dxf`, `application/dxf`).
Parameters after `;` on the type are ignored (`text/csv; charset=utf-8` is fine). The bucket enforces the same list and the 50 MB limit again.

## Storage

Public bucket `projexa-files` (owner decision: low-security product; the record link must work forever). Object path `<orgId>/<kind>/<random uuid>/<sanitised fileName>`:
unguessable; the org folder comes only from the caller's membership, never from the body. File name: separators, control and unsafe characters replaced, leading dots removed, max 120 chars with extension kept.
No policy exists on `storage.objects` for the bucket, so anon/authenticated cannot list, insert, update or delete via the API; only the function (service role) creates signed URLs.
Rate sanity: `public.projexa_upload_sign_reserve` allows 200 signs per org per hour (service role only).

## OWNER DECISION / RISK: Supabase Free Storage is 1 GB in total

The 50 MB per-file limit is Free-plan; the whole project has 1 GB of Storage. When it is exceeded Supabase restricts the project until you pay (Pro) or delete files.
At creation the project held about 4.1 MB. Monitor with this read-only SQL (Supabase SQL editor):

```sql
select bucket_id, count(*) files, pg_size_pretty(sum((metadata->>'size')::bigint)) used,
       round(100.0 * sum((metadata->>'size')::bigint) / 1073741824, 1) as pct_of_1gb
from storage.objects group by rollup (bucket_id);
```
Proposed per-org cap (NOT implemented, needs your yes): 100 MB per organisation (about 10 orgs fill 1 GB). Enforcement would be a sum over `storage.objects` with the org prefix inside `/uploads/sign` (413-style refusal `ORG_QUOTA`). Alternative: accept Pro ($25/month, 100 GB) before real customers upload.
Also note: deleting a record in PROJEXA does not delete the file (public permanent link); a cleanup job is a later decision.
