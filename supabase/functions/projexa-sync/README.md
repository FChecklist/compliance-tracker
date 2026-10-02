# projexa-sync (read side)

Local-first sync for PROJEXA: a laptop keeps an IndexedDB replica of the projects its person may read. No Vercel in the path.

Base: `https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-sync`, every call `Authorization: Bearer <PROJEXA Supabase access token>`, `verify_jwt` false (the token is signed by the PROJEXA Auth project; `../ai-work-link/session.ts` verifies it).

- `GET /manifest` -> `{user:{id,name,role,org_id}, projects:[{id,name,status}], kinds:[{kind, project_scoped, cursor_field, deletes_supported}], server_time}`
- `POST /pull` `{project_id, kind, after, limit}` -> `{items:[{id, updated_at, data}], next_cursor, has_more, hidden_fields, redacted, server_time}`

Authority is the AI work link's own (drizzle/0677 calls `projexa_read_resolve_user`, `ai_work_link__bind`, `ai_work_link__records_core`); this folder adds only the cursor, CORS (projexa-ai.com, localhost 3100/3101), a 120/minute cap per person and a second money-nulling pass. Kinds: project, tasks, boqs, boq_lines, activities, progress, rfis, submittals, punch_list, change_orders, milestones, materials, documents. Deletes are not propagated (`deletes_supported:false`).

Cursor = opaque keyset on (cursor_field, id); `next_cursor` is set whenever a page had rows (keep it, and re-pull later to get only changes), null for an empty page (keep the old one). A row that changes appears again, once, at its new position.

Tests: `bun test --isolate src/lib/services/projexa-sync-read.pglite.test.ts`
