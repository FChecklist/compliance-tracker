# ACTOR_SWEEP_INVENTORY -- U-20b (BR-215, supports BR-216/BR-217)

Item U-20b of PROJEXA-BUILD-001: an API-key write always names a person. Live finding D-09: 267 of 267 audit rows written on the org API key (PROJEXA's proxy key) had `user_id` null, and most v1 write routes stored the `api_keys` row id where a `compliance.users` id belongs.

Branch `feat/build-001-u20b-actor-required`, based on origin/main `ea24ac12` (U-20a merged: `logActivity` accepts `{ dbUser, apiKey, actingViaApiKey: true }`). Written 2026-09-25.

## 1. How this was measured

- Every `route.ts` under `src/app/api` was walked with Node `fs` (no shell globs: bracketed `[id]` segments break globbing on this repo): 1,246 route files, 339 of them call `requireAuthOrApiKey`.
- Each file was cut into top-level functions; each exported `GET/POST/PUT/PATCH/DELETE` handler (and its `*_impl` body and local helpers) was scanned with comments stripped for: `apiKey.id` / `apiKey!.id` / `apiKey?.id`; a key-only actor object (`apiKey: ctx.apiKey`, `ctx.dbUser ? { dbUser } : { apiKey }`); `ctx.dbUser?.id ?? null`; `resolveWriteActorId(`; `resolveActingUser(`; `if (!ctx.dbUser) return` (key refused).
- Every write handler flagged by the scan, and every handler the scan could not place, was then read by hand. Line numbers in the "Actor today" column are origin/main `ea24ac12`; the "After" column is this branch.
- Alias routes that only re-export another route's handler (for example `v1/projexa/scope` = `v1/construction/boq`, `v1/projexa/site-diary` = `v1/construction/site-diary`) are covered by the route they re-export and are not listed twice; section 6 names the alias URLs PROJEXA calls.

## 2. Counts

| Class (write handlers on API-key-capable routes, plus the key-id reads) | Before (origin/main) | After (this branch) |
|---|---|---|
| KEY_FALLS_BACK_TO_KEY_ID: the key's own id, or a key-only actor object / audit row, is the actor (includes 6 "`?? null`, no person" variants) | 149 | 3 (kept on a PM decision, section 5.1) |
| - converted in the route to `requireActingPerson` | | 137 |
| - converted by `resolveWriteActorId` becoming strict (route file untouched) | | 6 |
| - reclassified KEY_NO_ACTOR_NEEDED on reading the code (read-only POSTs) | | 3 |
| KEY_WITH_PERSON_ALREADY: resolves a real person and refuses when it cannot | 15 | 15 + 143 converted |
| KEY_NO_ACTOR_NEEDED: read-only, provisioning, or a reader identity that is never stored as an actor | 7 (6 GET + provisioning) | 10 |
| SESSION_ONLY: the write handler refuses an API key or uses session-only auth | 28 | 28 |
| KEY_RECORDS_NO_ACTOR: an API-key write that stores no actor and writes no audit row at all (outside D-09; listed so the count is honest) | 51 | 51 |

The PM's estimate was 40-50 KEY_FALLS_BACK_TO_KEY_ID sites; the real number is 149 write handlers (113 with `apiKey.id` as the actor, 8 through the old `resolveWriteActorId` fallback, 22 with a key-only actor object or audit row, 6 with `?? null`), plus 6 GET handlers that use the key id as a reader identity.

## 3. The central mechanism

`src/lib/supabase/auth-guard.ts`:

- `requireActingPerson(request, ctx, body?)`: session user -> that user, unchanged; API key + `X-Acting-User` / `X-Acting-User-Email` (or a body `actorEmail`) -> `resolveActingUser`, whose 400s (`USER_NOT_LINKED`, `USER_DEACTIVATED`) and messages are passed through untouched; API key + no signal -> HTTP 400 `{ code: "ACTING_USER_REQUIRED" }` with a message naming both headers; no auth -> 401. Returns `{ person, actor }`, where `actor` is shaped exactly like `logActivity`'s U-20a third variant (`{ dbUser: person, apiKey, actingViaApiKey: true }`), so one audit row names the person and the key.
- `resolveWriteActorId` keeps its name but loses its no-signal key-id fallback (a thin wrapper now).
- `resolveOptionalActingPerson` is the read-side twin: a GET is never refused for naming nobody, but a signal that is sent is resolved (same refusals), so per-user reads line up with the writes now recorded under the person.

Types and services: `ActorCtx` (`services/actor-context.ts`) and `ServiceActor` (`services/context.ts`) gain the person-plus-key variant; `audit.ts` gains `auditActorOf()`, and every service that hand-wrote `ctx.dbUser ? { dbUser } : { apiKey }` for its audit row now uses it, so the key id is kept next to the person instead of being dropped. `audit-event-triggers.ts` takes the same actor union.

Tests: `src/lib/supabase/acting-user-required.test.ts` (BR-215: the real helper, three real converted routes with only the DB and network faked, and the drift guard with its `ALLOWLIST`).

## 4. Inventory

### 4.1 Converted in the route (137 handlers)

| # | Route (under src/app/api/) | Method | Actor today (origin/main ea24ac12, file:line) | Class | After (this branch) |
|---|---|---|---|---|---|
| 1 | compliance/[id]/route.ts | DELETE | compliance/[id]/route.ts:56 `{ orgId: ctx.orgId, actor: ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }, ` | KEY_FALLS_BACK_TO_KEY_ID (key-only audit/actor object) | requireActingPerson at compliance/[id]/route.ts:56 |
| 2 | compliance/[id]/route.ts | PATCH | compliance/[id]/route.ts:34 `{ orgId: ctx.orgId, actor: ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }, ` | KEY_FALLS_BACK_TO_KEY_ID (key-only audit/actor object) | requireActingPerson at compliance/[id]/route.ts:31 |
| 3 | compliance/route.ts | POST | compliance/route.ts:39 `{ orgId: ctx.orgId, actor: ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }, ` | KEY_FALLS_BACK_TO_KEY_ID (key-only audit/actor object) | requireActingPerson at compliance/route.ts:37 |
| 4 | notices/[id]/route.ts | DELETE | notices/[id]/route.ts:57 `{ orgId: ctx.orgId, actor: ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }, ` | KEY_FALLS_BACK_TO_KEY_ID (key-only audit/actor object) | requireActingPerson at notices/[id]/route.ts:57 |
| 5 | notices/[id]/route.ts | PATCH | notices/[id]/route.ts:35 `{ orgId: ctx.orgId, actor: ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }, ` | KEY_FALLS_BACK_TO_KEY_ID (key-only audit/actor object) | requireActingPerson at notices/[id]/route.ts:32 |
| 6 | notices/route.ts | POST | notices/route.ts:37 `{ orgId: ctx.orgId, actor: ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }, ` | KEY_FALLS_BACK_TO_KEY_ID (key-only audit/actor object) | requireActingPerson at notices/route.ts:35 |
| 7 | pms/schedule/baselines/route.ts | POST | pms/schedule/baselines/route.ts:31 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at pms/schedule/baselines/route.ts:31 |
| 8 | tasks/[id]/route.ts | PATCH | tasks/[id]/route.ts:38 `{ orgId: ctx.orgId, actor: ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }, ` | KEY_FALLS_BACK_TO_KEY_ID (key-only audit/actor object) | requireActingPerson at tasks/[id]/route.ts:35 |
| 9 | v1/compliance/[id]/route.ts | DELETE | v1/compliance/[id]/route.ts:55 `{ orgId: ctx.orgId, actor: ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }, ` | KEY_FALLS_BACK_TO_KEY_ID (key-only audit/actor object) | requireActingPerson at v1/compliance/[id]/route.ts:55 |
| 10 | v1/compliance/[id]/route.ts | PATCH | v1/compliance/[id]/route.ts:34 `{ orgId: ctx.orgId, actor: ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }, ` | KEY_FALLS_BACK_TO_KEY_ID (key-only audit/actor object) | requireActingPerson at v1/compliance/[id]/route.ts:31 |
| 11 | v1/compliance/route.ts | POST | v1/compliance/route.ts:48 `{ orgId: ctx.orgId, actor: ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }, ` | KEY_FALLS_BACK_TO_KEY_ID (key-only audit/actor object) | requireActingPerson at v1/compliance/route.ts:46 |
| 12 | v1/construction/boq/[id]/approve/route.ts | POST | v1/construction/boq/[id]/approve/route.ts:26 `const { user: actingUser } = await resolveActingUser(ctx, readActingUserEmail(request), re` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/construction/boq/[id]/approve/route.ts:27 |
| 13 | v1/construction/boq/[id]/excel/apply/route.ts | POST | v1/construction/boq/[id]/excel/apply/route.ts:56 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/construction/boq/[id]/excel/apply/route.ts:57 |
| 14 | v1/construction/boq/[id]/revisions/route.ts | POST | v1/construction/boq/[id]/revisions/route.ts:20 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/construction/boq/[id]/revisions/route.ts:20 |
| 15 | v1/construction/boq/route.ts | POST | v1/construction/boq/route.ts:98 `const { user: actingUser } = await resolveActingUser(ctx, readActingUserEmail(request), re` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/construction/boq/route.ts:99 |
| 16 | v1/construction/cost-visibility/route.ts | PATCH | v1/construction/cost-visibility/route.ts:65 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/construction/cost-visibility/route.ts:65 |
| 17 | v1/construction/kpi-entries/[id]/approve/route.ts | POST | v1/construction/kpi-entries/[id]/approve/route.ts:29 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/construction/kpi-entries/[id]/approve/route.ts:29 |
| 18 | v1/construction/kpi-entries/route.ts | POST | v1/construction/kpi-entries/route.ts:32 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/construction/kpi-entries/route.ts:32 |
| 19 | v1/construction/materials/issues/route.ts | POST | v1/construction/materials/issues/route.ts:32 `const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/construction/materials/issues/route.ts:32 |
| 20 | v1/construction/materials/receipts/[id]/route.ts | PATCH | v1/construction/materials/receipts/[id]/route.ts:29 `const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/construction/materials/receipts/[id]/route.ts:29 |
| 21 | v1/construction/materials/receipts/route.ts | POST | v1/construction/materials/receipts/route.ts:29 `const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/construction/materials/receipts/route.ts:29 |
| 22 | v1/construction/site-diary/route.ts | POST | v1/construction/site-diary/route.ts:87 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/construction/site-diary/route.ts:87 |
| 23 | v1/construction/site-instructions/route.ts | POST | v1/construction/site-instructions/route.ts:32 `const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/construction/site-instructions/route.ts:32 |
| 24 | v1/documents/route.ts | POST | v1/documents/route.ts:65 `const actorId = ctx.dbUser?.id ?? null` | KEY_FALLS_BACK_TO_NULL (null person) | requireActingPerson at v1/documents/route.ts:66 |
| 25 | v1/erp/budgets/route.ts | POST | v1/erp/budgets/route.ts:29 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/erp/budgets/route.ts:29 |
| 26 | v1/notices/[id]/route.ts | DELETE | v1/notices/[id]/route.ts:55 `{ orgId: ctx.orgId, actor: ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }, ` | KEY_FALLS_BACK_TO_KEY_ID (key-only audit/actor object) | requireActingPerson at v1/notices/[id]/route.ts:55 |
| 27 | v1/notices/[id]/route.ts | PATCH | v1/notices/[id]/route.ts:34 `{ orgId: ctx.orgId, actor: ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }, ` | KEY_FALLS_BACK_TO_KEY_ID (key-only audit/actor object) | requireActingPerson at v1/notices/[id]/route.ts:31 |
| 28 | v1/notices/route.ts | POST | v1/notices/route.ts:37 `{ orgId: ctx.orgId, actor: ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }, ` | KEY_FALLS_BACK_TO_KEY_ID (key-only audit/actor object) | requireActingPerson at v1/notices/route.ts:35 |
| 29 | v1/projexa/access-review/certifications/[id]/route.ts | PATCH | v1/projexa/access-review/certifications/[id]/route.ts:25 `: { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/access-review/certifications/[id]/route.ts:18 |
| 30 | v1/projexa/access-review/route.ts | POST | v1/projexa/access-review/route.ts:43 `: { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/access-review/route.ts:40 |
| 31 | v1/projexa/audit-engagements/route.ts | POST | v1/projexa/audit-engagements/route.ts:35 `: { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/audit-engagements/route.ts:32 |
| 32 | v1/projexa/audit-findings/[id]/route.ts | PATCH | v1/projexa/audit-findings/[id]/route.ts:19 `: { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/audit-findings/[id]/route.ts:16 |
| 33 | v1/projexa/audit-findings/route.ts | POST | v1/projexa/audit-findings/route.ts:21 `: { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/audit-findings/route.ts:18 |
| 34 | v1/projexa/billing-claims/[id]/route.ts | PATCH | v1/projexa/billing-claims/[id]/route.ts:47 `const acting = await resolveWriteActorId(request, ctx)` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/billing-claims/[id]/route.ts:49 |
| 35 | v1/projexa/billing-claims/route.ts | POST | v1/projexa/billing-claims/route.ts:55 `const claim = await createProgressClaim({ orgId: ctx.orgId, userId: ctx.dbUser?.id ?? ctx.` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/billing-claims/route.ts:54 |
| 36 | v1/projexa/board/route.ts | PATCH | v1/projexa/board/route.ts:48 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/board/route.ts:48 |
| 37 | v1/projexa/boq-scenarios/[id]/adjustments/route.ts | DELETE | v1/projexa/boq-scenarios/[id]/adjustments/route.ts:53 `const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/boq-scenarios/[id]/adjustments/route.ts:54 |
| 38 | v1/projexa/boq-scenarios/[id]/adjustments/route.ts | POST | v1/projexa/boq-scenarios/[id]/adjustments/route.ts:26 `const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/boq-scenarios/[id]/adjustments/route.ts:26 |
| 39 | v1/projexa/boq-scenarios/route.ts | POST | v1/projexa/boq-scenarios/route.ts:43 `const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/boq-scenarios/route.ts:43 |
| 40 | v1/projexa/companies/route.ts | POST | v1/projexa/companies/route.ts:44 `: { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/companies/route.ts:36 |
| 41 | v1/projexa/compliance-register/route.ts | POST | v1/projexa/compliance-register/route.ts:47 `const actor = ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }` | KEY_FALLS_BACK_TO_KEY_ID (key-only audit/actor object) | requireActingPerson at v1/projexa/compliance-register/route.ts:46 |
| 42 | v1/projexa/credit-notes/[id]/submit/route.ts | POST | v1/projexa/credit-notes/[id]/submit/route.ts:22 `: { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/credit-notes/[id]/submit/route.ts:19 |
| 43 | v1/projexa/credit-notes/route.ts | POST | v1/projexa/credit-notes/route.ts:47 `: { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/credit-notes/route.ts:44 |
| 44 | v1/projexa/currencies/base/route.ts | PUT | v1/projexa/currencies/base/route.ts:71 `{ orgId: ctx.orgId, userId: ctx.dbUser?.id ?? ctx.apiKey!.id },` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/currencies/base/route.ts:60 |
| 45 | v1/projexa/discuss/route.ts | POST | v1/projexa/discuss/route.ts:21 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/discuss/route.ts:21 |
| 46 | v1/projexa/documents/[id]/dispose/route.ts | POST | v1/projexa/documents/[id]/dispose/route.ts:20 `const doc = await disposeDocument({ orgId: ctx.orgId, userId: ctx.dbUser?.id ?? ctx.apiKey` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/documents/[id]/dispose/route.ts:19 |
| 47 | v1/projexa/documents/[id]/route.ts | PATCH | v1/projexa/documents/[id]/route.ts:105 `const updated = await updateDocumentMetadata({ orgId: ctx.orgId, userId: ctx.dbUser?.id ??` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/documents/[id]/route.ts:110 |
| 48 | v1/projexa/documents/[id]/versions/route.ts | POST | v1/projexa/documents/[id]/versions/route.ts:35 `const doc = await createDocumentVersion({ orgId: ctx.orgId, userId: ctx.dbUser?.id ?? null` | KEY_FALLS_BACK_TO_NULL (null person) | requireActingPerson at v1/projexa/documents/[id]/versions/route.ts:36 |
| 49 | v1/projexa/drawings/[id]/route.ts | PATCH | v1/projexa/drawings/[id]/route.ts:156 `await updateDocumentMetadata({ orgId: ctx.orgId, userId: ctx.dbUser?.id ?? ctx.apiKey!.id ` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/drawings/[id]/route.ts:147 |
| 50 | v1/projexa/drawings/route.ts | POST | v1/projexa/drawings/route.ts:143 `const actorId = ctx.dbUser?.id ?? null` | KEY_FALLS_BACK_TO_NULL (null person) | requireActingPerson at v1/projexa/drawings/route.ts:144 |
| 51 | v1/projexa/dunning-list/[invoiceId]/record/route.ts | POST | v1/projexa/dunning-list/[invoiceId]/record/route.ts:22 `: { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/dunning-list/[invoiceId]/record/route.ts:18 |
| 52 | v1/projexa/expenses/route.ts | POST | v1/projexa/expenses/route.ts:32 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/expenses/route.ts:32 |
| 53 | v1/projexa/ffe/route.ts | POST | v1/projexa/ffe/route.ts:31 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/ffe/route.ts:31 |
| 54 | v1/projexa/floor-plans/route.ts | POST | v1/projexa/floor-plans/route.ts:29 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/floor-plans/route.ts:29 |
| 55 | v1/projexa/fraud-cases/[id]/route.ts | PATCH | v1/projexa/fraud-cases/[id]/route.ts:37 `: { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/fraud-cases/[id]/route.ts:33 |
| 56 | v1/projexa/fraud-cases/route.ts | POST | v1/projexa/fraud-cases/route.ts:40 `: { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/fraud-cases/route.ts:32 |
| 57 | v1/projexa/inventory/items/route.ts | POST | v1/projexa/inventory/items/route.ts:31 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/inventory/items/route.ts:31 |
| 58 | v1/projexa/inventory/stock-entries/route.ts | POST | v1/projexa/inventory/stock-entries/route.ts:37 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/inventory/stock-entries/route.ts:37 |
| 59 | v1/projexa/inventory/warehouses/route.ts | POST | v1/projexa/inventory/warehouses/route.ts:32 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/inventory/warehouses/route.ts:32 |
| 60 | v1/projexa/journal-entries/route.ts | POST | v1/projexa/journal-entries/route.ts:75 `: { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/journal-entries/route.ts:68 |
| 61 | v1/projexa/knowledge-base/[id]/route.ts | PATCH | v1/projexa/knowledge-base/[id]/route.ts:45 `: { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/knowledge-base/[id]/route.ts:41 |
| 62 | v1/projexa/knowledge-base/route.ts | POST | v1/projexa/knowledge-base/route.ts:33 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/knowledge-base/route.ts:33 |
| 63 | v1/projexa/leads/[id]/route.ts | PATCH | v1/projexa/leads/[id]/route.ts:41 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/leads/[id]/route.ts:41 |
| 64 | v1/projexa/leads/auto-distribute/route.ts | POST | v1/projexa/leads/auto-distribute/route.ts:23 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/leads/auto-distribute/route.ts:23 |
| 65 | v1/projexa/leads/bulk-reassign/route.ts | POST | v1/projexa/leads/bulk-reassign/route.ts:15 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/leads/bulk-reassign/route.ts:15 |
| 66 | v1/projexa/leads/route.ts | POST | v1/projexa/leads/route.ts:50 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/leads/route.ts:50 |
| 67 | v1/projexa/meetings/route.ts | POST | v1/projexa/meetings/route.ts:37 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/meetings/route.ts:37 |
| 68 | v1/projexa/milestones/[id]/route.ts | PATCH | v1/projexa/milestones/[id]/route.ts:23 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/milestones/[id]/route.ts:23 |
| 69 | v1/projexa/milestones/route.ts | POST | v1/projexa/milestones/route.ts:52 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/milestones/route.ts:52 |
| 70 | v1/projexa/mood-boards/route.ts | POST | v1/projexa/mood-boards/route.ts:29 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/mood-boards/route.ts:29 |
| 71 | v1/projexa/opportunities/[id]/route.ts | PATCH | v1/projexa/opportunities/[id]/route.ts:38 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/opportunities/[id]/route.ts:38 |
| 72 | v1/projexa/opportunities/auto-distribute/route.ts | POST | v1/projexa/opportunities/auto-distribute/route.ts:15 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/opportunities/auto-distribute/route.ts:15 |
| 73 | v1/projexa/opportunities/bulk-reassign/route.ts | POST | v1/projexa/opportunities/bulk-reassign/route.ts:14 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/opportunities/bulk-reassign/route.ts:14 |
| 74 | v1/projexa/opportunities/route.ts | POST | v1/projexa/opportunities/route.ts:52 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/opportunities/route.ts:52 |
| 75 | v1/projexa/permits/[id]/route.ts | PATCH | v1/projexa/permits/[id]/route.ts:84 `let actorId: string \| null = ctx.dbUser?.id ?? null` | KEY_FALLS_BACK_TO_NULL (null person) | requireActingPerson at v1/projexa/permits/[id]/route.ts:85 |
| 76 | v1/projexa/permits/route.ts | POST | v1/projexa/permits/route.ts:138 `const actorId = ctx.dbUser?.id ?? null` | KEY_FALLS_BACK_TO_NULL (null person) | requireActingPerson at v1/projexa/permits/route.ts:139 |
| 77 | v1/projexa/pill-usage/route.ts | POST | v1/projexa/pill-usage/route.ts:105 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/pill-usage/route.ts:111 |
| 78 | v1/projexa/policies/[id]/route.ts | PATCH | v1/projexa/policies/[id]/route.ts:43 `: { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/policies/[id]/route.ts:36 |
| 79 | v1/projexa/policies/route.ts | POST | v1/projexa/policies/route.ts:34 `: { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/policies/route.ts:31 |
| 80 | v1/projexa/procurement/goods-receipts/[id]/submit/route.ts | POST | v1/projexa/procurement/goods-receipts/[id]/submit/route.ts:18 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/procurement/goods-receipts/[id]/submit/route.ts:18 |
| 81 | v1/projexa/procurement/goods-receipts/route.ts | POST | v1/projexa/procurement/goods-receipts/route.ts:32 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/procurement/goods-receipts/route.ts:32 |
| 82 | v1/projexa/procurement/purchase-orders/[id]/route.ts | DELETE | v1/projexa/procurement/purchase-orders/[id]/route.ts:64 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/procurement/purchase-orders/[id]/route.ts:64 |
| 83 | v1/projexa/procurement/purchase-orders/[id]/route.ts | PATCH | v1/projexa/procurement/purchase-orders/[id]/route.ts:38 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/procurement/purchase-orders/[id]/route.ts:38 |
| 84 | v1/projexa/procurement/purchase-orders/[id]/submit/route.ts | POST | v1/projexa/procurement/purchase-orders/[id]/submit/route.ts:16 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/procurement/purchase-orders/[id]/submit/route.ts:16 |
| 85 | v1/projexa/procurement/purchase-orders/route.ts | POST | v1/projexa/procurement/purchase-orders/route.ts:35 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/procurement/purchase-orders/route.ts:35 |
| 86 | v1/projexa/procurement/quotations/route.ts | POST | v1/projexa/procurement/quotations/route.ts:34 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/procurement/quotations/route.ts:34 |
| 87 | v1/projexa/procurement/requisitions/route.ts | POST | v1/projexa/procurement/requisitions/route.ts:33 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/procurement/requisitions/route.ts:33 |
| 88 | v1/projexa/procurement/rfqs/[id]/send/route.ts | POST | v1/projexa/procurement/rfqs/[id]/send/route.ts:16 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/procurement/rfqs/[id]/send/route.ts:16 |
| 89 | v1/projexa/procurement/rfqs/route.ts | POST | v1/projexa/procurement/rfqs/route.ts:31 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/procurement/rfqs/route.ts:31 |
| 90 | v1/projexa/project-budgets/[id]/submit/route.ts | POST | v1/projexa/project-budgets/[id]/submit/route.ts:15 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/project-budgets/[id]/submit/route.ts:15 |
| 91 | v1/projexa/project-budgets/route.ts | POST | v1/projexa/project-budgets/route.ts:51 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/project-budgets/route.ts:51 |
| 92 | v1/projexa/projects/route.ts | POST | v1/projexa/projects/route.ts:56 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/projects/route.ts:56 |
| 93 | v1/projexa/punch-list/route.ts | POST | v1/projexa/punch-list/route.ts:30 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/punch-list/route.ts:30 |
| 94 | v1/projexa/purchase-orders/route.ts | POST | v1/projexa/purchase-orders/route.ts:53 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/purchase-orders/route.ts:53 |
| 95 | v1/projexa/quotations/[id]/convert/route.ts | POST | v1/projexa/quotations/[id]/convert/route.ts:25 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/quotations/[id]/convert/route.ts:25 |
| 96 | v1/projexa/quotations/[id]/revisions/route.ts | POST | v1/projexa/quotations/[id]/revisions/route.ts:26 `const acting = await resolveWriteActorId(request, ctx)` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/quotations/[id]/revisions/route.ts:27 |
| 97 | v1/projexa/quotations/[id]/route.ts | PATCH | v1/projexa/quotations/[id]/route.ts:95 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/quotations/[id]/route.ts:95 |
| 98 | v1/projexa/quotations/route.ts | POST | v1/projexa/quotations/route.ts:71 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/quotations/route.ts:71 |
| 99 | v1/projexa/recruitment/applications/[id]/hire/route.ts | POST | v1/projexa/recruitment/applications/[id]/hire/route.ts:18 `const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/recruitment/applications/[id]/hire/route.ts:18 |
| 100 | v1/projexa/recruitment/applications/[id]/interviews/route.ts | POST | v1/projexa/recruitment/applications/[id]/interviews/route.ts:31 `const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/recruitment/applications/[id]/interviews/route.ts:31 |
| 101 | v1/projexa/recruitment/applications/[id]/stage/route.ts | POST | v1/projexa/recruitment/applications/[id]/stage/route.ts:16 `const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/recruitment/applications/[id]/stage/route.ts:16 |
| 102 | v1/projexa/recruitment/applications/route.ts | POST | v1/projexa/recruitment/applications/route.ts:32 `const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/recruitment/applications/route.ts:32 |
| 103 | v1/projexa/recruitment/candidates/route.ts | POST | v1/projexa/recruitment/candidates/route.ts:27 `const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/recruitment/candidates/route.ts:27 |
| 104 | v1/projexa/recruitment/interviews/[id]/feedback/route.ts | POST | v1/projexa/recruitment/interviews/[id]/feedback/route.ts:15 `const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/recruitment/interviews/[id]/feedback/route.ts:15 |
| 105 | v1/projexa/recruitment/job-openings/[id]/status/route.ts | POST | v1/projexa/recruitment/job-openings/[id]/status/route.ts:15 `const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/recruitment/job-openings/[id]/status/route.ts:15 |
| 106 | v1/projexa/recruitment/job-openings/route.ts | POST | v1/projexa/recruitment/job-openings/route.ts:29 `const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/recruitment/job-openings/route.ts:29 |
| 107 | v1/projexa/reports/share/route.ts | POST | v1/projexa/reports/share/route.ts:24 `{ orgId: ctx.orgId, userId: ctx.dbUser?.id ?? null },` | KEY_FALLS_BACK_TO_NULL (null person) | requireActingPerson at v1/projexa/reports/share/route.ts:25 |
| 108 | v1/projexa/rfis/route.ts | POST | v1/projexa/rfis/route.ts:30 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/rfis/route.ts:30 |
| 109 | v1/projexa/risks/[id]/route.ts | PATCH | v1/projexa/risks/[id]/route.ts:40 `: { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/risks/[id]/route.ts:36 |
| 110 | v1/projexa/risks/route.ts | POST | v1/projexa/risks/route.ts:37 `: { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/risks/route.ts:34 |
| 111 | v1/projexa/sales-invoices/[id]/cancel/route.ts | POST | v1/projexa/sales-invoices/[id]/cancel/route.ts:18 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/sales-invoices/[id]/cancel/route.ts:18 |
| 112 | v1/projexa/sales-invoices/[id]/payments/route.ts | POST | v1/projexa/sales-invoices/[id]/payments/route.ts:21 `: { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/sales-invoices/[id]/payments/route.ts:17 |
| 113 | v1/projexa/sales-invoices/[id]/submit/route.ts | POST | v1/projexa/sales-invoices/[id]/submit/route.ts:25 `: { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/sales-invoices/[id]/submit/route.ts:21 |
| 114 | v1/projexa/sales-invoices/route.ts | POST | v1/projexa/sales-invoices/route.ts:86 `: { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/sales-invoices/route.ts:75 |
| 115 | v1/projexa/sales-orders/[id]/route.ts | PATCH | v1/projexa/sales-orders/[id]/route.ts:67 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/sales-orders/[id]/route.ts:67 |
| 116 | v1/projexa/sales-orders/bulk-status/route.ts | POST | v1/projexa/sales-orders/bulk-status/route.ts:24 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/sales-orders/bulk-status/route.ts:24 |
| 117 | v1/projexa/sales-orders/route.ts | POST | v1/projexa/sales-orders/route.ts:69 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/sales-orders/route.ts:69 |
| 118 | v1/projexa/schedule/[id]/completion/route.ts | PATCH | v1/projexa/schedule/[id]/completion/route.ts:42 `{ orgId: ctx.orgId, userId: ctx.dbUser?.id ?? ctx.apiKey!.id },` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/schedule/[id]/completion/route.ts:41 |
| 119 | v1/projexa/schedule/[id]/route.ts | PATCH | v1/projexa/schedule/[id]/route.ts:58 `const task = await updateIssue({ orgId: ctx.orgId, userId: ctx.dbUser?.id ?? ctx.apiKey!.i` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/schedule/[id]/route.ts:45 |
| 120 | v1/projexa/schedule/baselines/route.ts | POST | v1/projexa/schedule/baselines/route.ts:29 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/schedule/baselines/route.ts:29 |
| 121 | v1/projexa/schedule/import/route.ts | POST | v1/projexa/schedule/import/route.ts:60 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/schedule/import/route.ts:59 |
| 122 | v1/projexa/schedule/route.ts | POST | v1/projexa/schedule/route.ts:62 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/schedule/route.ts:62 |
| 123 | v1/projexa/subcontractor-retention-summary/[invoiceId]/release/route.ts | POST | v1/projexa/subcontractor-retention-summary/[invoiceId]/release/route.ts:24 `: { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/subcontractor-retention-summary/[invoiceId]/release/route.ts:20 |
| 124 | v1/projexa/vendor-risk/route.ts | POST | v1/projexa/vendor-risk/route.ts:33 `: { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/vendor-risk/route.ts:30 |
| 125 | v1/projexa/vendors/[id]/bank-accounts/route.ts | POST | v1/projexa/vendors/[id]/bank-accounts/route.ts:36 `const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/vendors/[id]/bank-accounts/route.ts:36 |
| 126 | v1/projexa/vendors/[id]/portal-links/route.ts | POST | v1/projexa/vendors/[id]/portal-links/route.ts:33 `const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/vendors/[id]/portal-links/route.ts:33 |
| 127 | v1/projexa/vendors/[id]/qualification/route.ts | POST | v1/projexa/vendors/[id]/qualification/route.ts:32 `const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/vendors/[id]/qualification/route.ts:32 |
| 128 | v1/projexa/vendors/[id]/sanction-checks/route.ts | POST | v1/projexa/vendors/[id]/sanction-checks/route.ts:31 `const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/vendors/[id]/sanction-checks/route.ts:31 |
| 129 | v1/projexa/veri-meetings/[id]/action-items/route.ts | POST | v1/projexa/veri-meetings/[id]/action-items/route.ts:18 `const actorId = ctx.dbUser?.id ?? null` | KEY_FALLS_BACK_TO_KEY_ID (key-only audit/actor object) (null person) | requireActingPerson at v1/projexa/veri-meetings/[id]/action-items/route.ts:20 |
| 130 | v1/projexa/veri-meetings/[id]/generate-intelligence/route.ts | POST | v1/projexa/veri-meetings/[id]/generate-intelligence/route.ts:14 `const actorId = ctx.dbUser?.id ?? null` | KEY_FALLS_BACK_TO_KEY_ID (key-only audit/actor object) (null person) | requireActingPerson at v1/projexa/veri-meetings/[id]/generate-intelligence/route.ts:15 |
| 131 | v1/projexa/veri-meetings/[id]/route.ts | DELETE | v1/projexa/veri-meetings/[id]/route.ts:85 `const actorId = ctx.dbUser?.id ?? null` | KEY_FALLS_BACK_TO_KEY_ID (key-only audit/actor object) (null person) | requireActingPerson at v1/projexa/veri-meetings/[id]/route.ts:88 |
| 132 | v1/projexa/veri-meetings/[id]/route.ts | PATCH | v1/projexa/veri-meetings/[id]/route.ts:43 `const actorId = ctx.dbUser?.id ?? null` | KEY_FALLS_BACK_TO_KEY_ID (key-only audit/actor object) (null person) | requireActingPerson at v1/projexa/veri-meetings/[id]/route.ts:44 |
| 133 | v1/projexa/veri-meetings/[id]/share-links/route.ts | POST | v1/projexa/veri-meetings/[id]/share-links/route.ts:38 `const actorId = ctx.dbUser?.id ?? null` | KEY_FALLS_BACK_TO_KEY_ID (key-only audit/actor object) (null person) | requireActingPerson at v1/projexa/veri-meetings/[id]/share-links/route.ts:39 |
| 134 | v1/projexa/veri-meetings/route.ts | POST | v1/projexa/veri-meetings/route.ts:53 `const actorId = ctx.dbUser?.id ?? null` | KEY_FALLS_BACK_TO_KEY_ID (key-only audit/actor object) (null person) | requireActingPerson at v1/projexa/veri-meetings/route.ts:54 |
| 135 | v1/projexa/veri-meetings/share-links/[linkId]/route.ts | DELETE | v1/projexa/veri-meetings/share-links/[linkId]/route.ts:21 `const actorId = ctx.dbUser?.id ?? null` | KEY_FALLS_BACK_TO_KEY_ID (key-only audit/actor object) (null person) | requireActingPerson at v1/projexa/veri-meetings/share-links/[linkId]/route.ts:21 |
| 136 | v1/projexa/wiki/route.ts | POST | v1/projexa/wiki/route.ts:35 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | requireActingPerson at v1/projexa/wiki/route.ts:35 |
| 137 | v1/tasks/[id]/route.ts | PATCH | v1/tasks/[id]/route.ts:34 `{ orgId: ctx.orgId, actor: ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }, ` | KEY_FALLS_BACK_TO_KEY_ID (key-only audit/actor object) | requireActingPerson at v1/tasks/[id]/route.ts:31 |

### 4.2 Converted by `resolveWriteActorId` becoming strict (6 handlers, route file unchanged)

| # | Route (under src/app/api/) | Method | Actor today (origin/main ea24ac12, file:line) | Class | After (this branch) |
|---|---|---|---|---|---|
| 1 | v1/projexa/change-orders/route.ts | POST | v1/projexa/change-orders/route.ts:37 `const acting = await resolveWriteActorId(request, ctx)` | KEY_FALLS_BACK_TO_KEY_ID | resolveWriteActorId (now strict, wraps requireActingPerson) at v1/projexa/change-orders/route.ts:37 |
| 2 | v1/projexa/punch-list/[id]/route.ts | PATCH | v1/projexa/punch-list/[id]/route.ts:42 `const acting = await resolveWriteActorId(request, ctx)` | KEY_FALLS_BACK_TO_KEY_ID | resolveWriteActorId (now strict, wraps requireActingPerson) at v1/projexa/punch-list/[id]/route.ts:42 |
| 3 | v1/projexa/rfis/[id]/route.ts | PATCH | v1/projexa/rfis/[id]/route.ts:40 `const acting = await resolveWriteActorId(request, ctx)` | KEY_FALLS_BACK_TO_KEY_ID | resolveWriteActorId (now strict, wraps requireActingPerson) at v1/projexa/rfis/[id]/route.ts:40 |
| 4 | v1/projexa/scope/import/route.ts | POST | v1/projexa/scope/import/route.ts:129 `const acting = await resolveWriteActorId(request, ctx)` | KEY_FALLS_BACK_TO_KEY_ID | resolveWriteActorId (now strict, wraps requireActingPerson) at v1/projexa/scope/import/route.ts:129 |
| 5 | v1/projexa/submittals/[id]/route.ts | PATCH | v1/projexa/submittals/[id]/route.ts:38 `const acting = await resolveWriteActorId(request, ctx)` | KEY_FALLS_BACK_TO_KEY_ID | resolveWriteActorId (now strict, wraps requireActingPerson) at v1/projexa/submittals/[id]/route.ts:38 |
| 6 | v1/projexa/submittals/route.ts | POST | v1/projexa/submittals/route.ts:34 `const acting = await resolveWriteActorId(request, ctx)` | KEY_FALLS_BACK_TO_KEY_ID | resolveWriteActorId (now strict, wraps requireActingPerson) at v1/projexa/submittals/route.ts:34 |

### 4.3 Kept on a PM decision (3 handlers, allowlisted, see 5.1)

| # | Route (under src/app/api/) | Method | Actor today (origin/main ea24ac12, file:line) | Class | After (this branch) |
|---|---|---|---|---|---|
| 1 | v1/projexa/assistant/route.ts | POST | v1/projexa/assistant/route.ts:53 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | UNCHANGED, allowlisted: PM decision U-01d D1 (pipeline never refuses) -- needs a PM ruling, see section 5 |
| 2 | v1/projexa/submissions/route.ts | POST | v1/projexa/submissions/route.ts:37 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | UNCHANGED, allowlisted: PM decision U-01d D1 -- needs a PM ruling, see section 5 |
| 3 | v1/projexa/tasks/route.ts | POST | v1/projexa/tasks/route.ts:98 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_FALLS_BACK_TO_KEY_ID | UNCHANGED, allowlisted: PM decision U-01d D1 -- needs a PM ruling, see section 5 |

### 4.4 KEY_WITH_PERSON_ALREADY (15 handlers, unchanged)

| # | Route (under src/app/api/) | Method | Actor today (origin/main ea24ac12, file:line) | Class | After (this branch) |
|---|---|---|---|---|---|
| 1 | v1/construction/boq/line-items/[id]/route.ts | PATCH | v1/construction/boq/line-items/[id]/route.ts:61 `const acting = await resolveActingUser(ctx, readActingUserEmail(request), readActingUserId` | KEY_WITH_PERSON_ALREADY | unchanged |
| 2 | v1/construction/progress/route.ts | POST | v1/construction/progress/route.ts:68 `const { user: actingUser, error: actingUserErr } = await resolveActingUser(` | KEY_WITH_PERSON_ALREADY | unchanged |
| 3 | v1/projexa/change-orders/[id]/route.ts | PATCH | v1/projexa/change-orders/[id]/route.ts:50 `const acting = await resolveActingUser(ctx, readActingUserEmail(request), readActingUserId` | KEY_WITH_PERSON_ALREADY | unchanged |
| 4 | v1/projexa/phrase-map/[id]/promote/route.ts | POST | v1/projexa/phrase-map/[id]/promote/route.ts:17 `const { user: actingUser, error: actingUserErr } = await resolveActingUser(ctx, body?.acto` | KEY_WITH_PERSON_ALREADY | unchanged |
| 5 | v1/projexa/screen-drafts/[id]/route.ts | DELETE | v1/projexa/screen-drafts/[id]/route.ts:39 `const { user: actingUser, error: actingUserErr } = await resolveActingUser(ctx, body?.acto` | KEY_WITH_PERSON_ALREADY | unchanged |
| 6 | v1/projexa/screen-drafts/[id]/route.ts | PATCH | v1/projexa/screen-drafts/[id]/route.ts:22 `const { user: actingUser, error: actingUserErr } = await resolveActingUser(ctx, body?.acto` | KEY_WITH_PERSON_ALREADY | unchanged |
| 7 | v1/projexa/screen-drafts/route.ts | POST | v1/projexa/screen-drafts/route.ts:42 `const { user: actingUser, error: actingUserErr } = await resolveActingUser(ctx, body?.acto` | KEY_WITH_PERSON_ALREADY | unchanged |
| 8 | v1/projexa/timesheets/[id]/approve/route.ts | POST | v1/projexa/timesheets/[id]/approve/route.ts:33 `const { user: actingUser, error: actingUserErr } = await resolveActingUser(ctx, body?.acto` | KEY_WITH_PERSON_ALREADY | unchanged |
| 9 | v1/projexa/timesheets/[id]/reject/route.ts | POST | v1/projexa/timesheets/[id]/reject/route.ts:26 `const { user: actingUser, error: actingUserErr } = await resolveActingUser(ctx, body?.acto` | KEY_WITH_PERSON_ALREADY | unchanged |
| 10 | v1/projexa/timesheets/[id]/route.ts | DELETE | v1/projexa/timesheets/[id]/route.ts:73 `const { user: actingUser, error: actingUserErr } = await resolveActingUser(ctx, body?.acto` | KEY_WITH_PERSON_ALREADY | unchanged |
| 11 | v1/projexa/timesheets/[id]/route.ts | PATCH | v1/projexa/timesheets/[id]/route.ts:51 `const { user: actingUser, error: actingUserErr } = await resolveActingUser(ctx, body?.acto` | KEY_WITH_PERSON_ALREADY | unchanged |
| 12 | v1/projexa/timesheets/[id]/submit/route.ts | POST | v1/projexa/timesheets/[id]/submit/route.ts:69 `const { user: actingUser, error: actingUserErr } = await resolveActingUser(ctx, body?.acto` | KEY_WITH_PERSON_ALREADY | unchanged |
| 13 | v1/projexa/timesheets/review-day/route.ts | POST | v1/projexa/timesheets/review-day/route.ts:26 `const { user: actingUser, error: actingUserErr } = await resolveActingUser(ctx, body?.acto` | KEY_WITH_PERSON_ALREADY | unchanged |
| 14 | v1/projexa/timesheets/route.ts | POST | v1/projexa/timesheets/route.ts:141 `const { user: actingUser, error: actingUserErr } = await resolveActingUser(` | KEY_WITH_PERSON_ALREADY | unchanged |
| 15 | v1/projexa/timesheets/submit-day/route.ts | POST | v1/projexa/timesheets/submit-day/route.ts:31 `const { user: actingUser, error: actingUserErr } = await resolveActingUser(ctx, body?.acto` | KEY_WITH_PERSON_ALREADY | unchanged |

### 4.5 KEY_NO_ACTOR_NEEDED (10 handlers; the key-id ones are in the drift guard's `ALLOWLIST` with these reasons)

| # | Route (under src/app/api/) | Method | Actor today (origin/main ea24ac12, file:line) | Class | After (this branch) |
|---|---|---|---|---|---|
| 1 | v1/brain/entity-relationships/route.ts | GET | v1/brain/entity-relationships/route.ts:22 `{ orgId: ctx.orgId, userId: ctx.dbUser?.id ?? ctx.apiKey!.id },` | KEY_NO_ACTOR_NEEDED (read-only GET) | unchanged; allowlisted (read) |
| 2 | v1/platform/provision-org/route.ts | POST | -- | KEY_NO_ACTOR_NEEDED (platform provisioning (internal secret, not an org API key write)) | unchanged |
| 3 | v1/projexa/capability-tree/route.ts | GET | v1/projexa/capability-tree/route.ts:21 `const nodes = await withTenantContext({ orgId: ctx.orgId, userId: ctx.dbUser?.id ?? ctx.ap` | KEY_NO_ACTOR_NEEDED (read-only GET) | unchanged; allowlisted (read) |
| 4 | v1/projexa/chain-options/route.ts | GET | v1/projexa/chain-options/route.ts:88 `const repo = makeChainOptionsRepo({ orgId: ctx.orgId, userId: ctx.dbUser?.id ?? ctx.apiKey` | KEY_NO_ACTOR_NEEDED (read-only GET) | unchanged; allowlisted (read) |
| 5 | v1/projexa/classify/route.ts | POST | v1/projexa/classify/route.ts:33 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_NO_ACTOR_NEEDED (read-scope classification; writes only gap_log rows, no audit row) | unchanged; allowlisted |
| 6 | v1/projexa/documents/[id]/route.ts | GET | v1/projexa/documents/[id]/route.ts:33 `const found = await withTenantContext({ orgId: ctx.orgId, userId: ctx.dbUser?.id ?? ctx.ap` | KEY_NO_ACTOR_NEEDED (GET, but writes a view audit row: see 5.4) | resolveOptionalActingPerson at v1/projexa/documents/[id]/route.ts:38; allowlisted (read) |
| 7 | v1/projexa/module-chain/route.ts | GET | v1/projexa/module-chain/route.ts:35 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_NO_ACTOR_NEEDED (read-only GET) | resolveOptionalActingPerson at v1/projexa/module-chain/route.ts:38; allowlisted (read) |
| 8 | v1/projexa/pill-usage/route.ts | GET | v1/projexa/pill-usage/route.ts:64 `const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id` | KEY_NO_ACTOR_NEEDED (read-only GET) | resolveOptionalActingPerson at v1/projexa/pill-usage/route.ts:68; allowlisted (read) |
| 9 | v1/projexa/reports/definitions/[id]/run/route.ts | POST | v1/projexa/reports/definitions/[id]/run/route.ts:36 `const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id` | KEY_NO_ACTOR_NEEDED (read-only report execution; key id only keys AI usage logging) | unchanged; allowlisted |
| 10 | v1/reports/definitions/[id]/run/route.ts | POST | v1/reports/definitions/[id]/run/route.ts:35 `const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id` | KEY_NO_ACTOR_NEEDED (external-AI reporting gateway (read / read:reports keys); read-only report execution) | unchanged; allowlisted |

### 4.6 SESSION_ONLY (28 handlers, unchanged)

| # | Route (under src/app/api/) | Method | Actor today (origin/main ea24ac12, file:line) | Class | After (this branch) |
|---|---|---|---|---|---|
| 1 | pms/invoices/generate/route.ts | POST | session-only auth in this handler | SESSION_ONLY | unchanged |
| 2 | tasks/route.ts | POST | refuses an API key (`if (!ctx.dbUser) return 400`) | SESSION_ONLY | unchanged |
| 3 | v1/erp/inventory/issues/route.ts | POST | refuses an API key (`if (!ctx.dbUser) return 400`) | SESSION_ONLY | unchanged |
| 4 | v1/erp/inventory/receipts/route.ts | POST | refuses an API key (`if (!ctx.dbUser) return 400`) | SESSION_ONLY | unchanged |
| 5 | v1/erp/procurement/requisitions/route.ts | POST | refuses an API key (`if (!ctx.dbUser) return 400`) | SESSION_ONLY | unchanged |
| 6 | v1/pms/meetings/route.ts | POST | refuses an API key (`if (!ctx.dbUser) return 400`) | SESSION_ONLY | unchanged |
| 7 | v1/pms/time-entries/route.ts | POST | refuses an API key (`if (!ctx.dbUser) return 400`) | SESSION_ONLY | unchanged |
| 8 | v1/projexa/boq-scenarios/[id]/commit/route.ts | POST | session-only auth in this handler | SESSION_ONLY | unchanged |
| 9 | v1/projexa/employees/[id]/route.ts | PATCH | refuses an API key (`if (!ctx.dbUser) return 400`) | SESSION_ONLY | unchanged |
| 10 | v1/projexa/employees/route.ts | POST | refuses an API key (`if (!ctx.dbUser) return 400`) | SESSION_ONLY | unchanged |
| 11 | v1/projexa/hr/departments/route.ts | POST | refuses an API key (`if (!ctx.dbUser) return 400`) | SESSION_ONLY | unchanged |
| 12 | v1/projexa/journal-entries/[id]/submit/route.ts | POST | refuses an API key (`if (!ctx.dbUser) return 400`) | SESSION_ONLY | unchanged |
| 13 | v1/projexa/leave/balances/route.ts | POST | refuses an API key (`if (!ctx.dbUser) return 400`) | SESSION_ONLY | unchanged |
| 14 | v1/projexa/leave/requests/[id]/decision/route.ts | POST | refuses an API key (`if (!ctx.dbUser) return 400`) | SESSION_ONLY | unchanged |
| 15 | v1/projexa/leave/requests/route.ts | POST | refuses an API key (`if (!ctx.dbUser) return 400`) | SESSION_ONLY | unchanged |
| 16 | v1/projexa/payroll/employees/[id]/income-tax-slab/route.ts | POST | refuses an API key (`if (!ctx.dbUser) return 400`) | SESSION_ONLY | unchanged |
| 17 | v1/projexa/payroll/employees/[id]/tax-exemptions/route.ts | POST | refuses an API key (`if (!ctx.dbUser) return 400`) | SESSION_ONLY | unchanged |
| 18 | v1/projexa/payroll/income-tax-slabs/route.ts | POST | refuses an API key (`if (!ctx.dbUser) return 400`) | SESSION_ONLY | unchanged |
| 19 | v1/projexa/payroll/payslips/[id]/finalize/route.ts | POST | refuses an API key (`if (!ctx.dbUser) return 400`) | SESSION_ONLY | unchanged |
| 20 | v1/projexa/payroll/payslips/[id]/tds/route.ts | POST | refuses an API key (`if (!ctx.dbUser) return 400`) | SESSION_ONLY | unchanged |
| 21 | v1/projexa/payroll/runs/[id]/process/route.ts | POST | refuses an API key (`if (!ctx.dbUser) return 400`) | SESSION_ONLY | unchanged |
| 22 | v1/projexa/payroll/runs/route.ts | POST | refuses an API key (`if (!ctx.dbUser) return 400`) | SESSION_ONLY | unchanged |
| 23 | v1/projexa/payroll/salary-components/route.ts | POST | refuses an API key (`if (!ctx.dbUser) return 400`) | SESSION_ONLY | unchanged |
| 24 | v1/projexa/payroll/salary-structures/route.ts | POST | refuses an API key (`if (!ctx.dbUser) return 400`) | SESSION_ONLY | unchanged |
| 25 | v1/projexa/payroll/statutory-rules/route.ts | POST | refuses an API key (`if (!ctx.dbUser) return 400`) | SESSION_ONLY | unchanged |
| 26 | v1/projexa/procurement/requisitions/[id]/submit/route.ts | POST | refuses an API key (`if (!ctx.dbUser) return 400`) | SESSION_ONLY | unchanged |
| 27 | v1/projexa/wiki/[id]/route.ts | PATCH | refuses an API key (`if (!ctx.dbUser) return 400`) | SESSION_ONLY | unchanged |
| 28 | v1/tasks/route.ts | POST | refuses an API key (`if (!ctx.dbUser) return 400`) | SESSION_ONLY | unchanged |

### 4.7 KEY_RECORDS_NO_ACTOR (51 handlers, unchanged; outside D-09)

These API-key writes pass only `{ orgId }` to their service: no actor column is written and no audit row is written, so they cannot produce a key-attributed row without a person. Giving them an actor is a separate change (their services have no actor parameter today).

| # | Route (under src/app/api/) | Method | Actor today (origin/main ea24ac12, file:line) | Class | After (this branch) |
|---|---|---|---|---|---|
| 1 | compliance/overdue/route.ts | POST | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 2 | pms/schedule/resource-allocations/route.ts | POST | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 3 | v1/construction/attendance/bulk/route.ts | POST | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 4 | v1/construction/attendance/route.ts | POST | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 5 | v1/construction/boq/[id]/excel/diff/route.ts | POST | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 6 | v1/construction/boq/[id]/route.ts | DELETE | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 7 | v1/construction/boq/[id]/route.ts | PATCH | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 8 | v1/construction/boq/[id]/submit/route.ts | POST | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 9 | v1/construction/boq/categories/[id]/route.ts | DELETE | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 10 | v1/construction/boq/categories/[id]/route.ts | PATCH | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 11 | v1/construction/boq/categories/route.ts | POST | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 12 | v1/construction/kpi-definitions/route.ts | POST | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 13 | v1/construction/labour-roster/[id]/route.ts | PATCH | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 14 | v1/construction/labour-roster/route.ts | POST | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 15 | v1/construction/materials/[id]/route.ts | PATCH | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 16 | v1/construction/materials/route.ts | POST | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 17 | v1/construction/progress/[id]/route.ts | DELETE | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 18 | v1/construction/progress/[id]/route.ts | PATCH | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 19 | v1/projexa/boq-scenarios/target-seek/route.ts | POST | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 20 | v1/projexa/customers/[id]/route.ts | PATCH | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 21 | v1/projexa/customers/route.ts | POST | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 22 | v1/projexa/design-materials/route.ts | POST | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 23 | v1/projexa/drawings/[id]/route.ts | DELETE | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 24 | v1/projexa/ffe/[id]/route.ts | PATCH | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 25 | v1/projexa/floor-plans/[id]/placements/[placementId]/route.ts | DELETE | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 26 | v1/projexa/floor-plans/[id]/placements/[placementId]/route.ts | PATCH | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 27 | v1/projexa/floor-plans/[id]/placements/route.ts | POST | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 28 | v1/projexa/floor-plans/[id]/rooms/[roomId]/route.ts | DELETE | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 29 | v1/projexa/floor-plans/[id]/rooms/[roomId]/route.ts | PATCH | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 30 | v1/projexa/floor-plans/[id]/rooms/route.ts | POST | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 31 | v1/projexa/floor-plans/[id]/route.ts | PATCH | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 32 | v1/projexa/labour-roster/import/route.ts | POST | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 33 | v1/projexa/meetings/[id]/outcomes/route.ts | POST | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 34 | v1/projexa/meetings/[id]/route.ts | PATCH | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 35 | v1/projexa/mood-boards/[id]/items/[itemId]/route.ts | DELETE | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 36 | v1/projexa/mood-boards/[id]/route.ts | PATCH | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 37 | v1/projexa/mood-boards/[id]/route.ts | POST | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 38 | v1/projexa/permits/[id]/route.ts | DELETE | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 39 | v1/projexa/project-budgets/[id]/cancel/route.ts | POST | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 40 | v1/projexa/project-budgets/[id]/route.ts | PATCH | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 41 | v1/projexa/projects/[id]/route.ts | PATCH | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 42 | v1/projexa/schedule/sprints/[id]/issues/route.ts | DELETE | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 43 | v1/projexa/schedule/sprints/[id]/issues/route.ts | POST | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 44 | v1/projexa/schedule/sprints/[id]/route.ts | PATCH | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 45 | v1/projexa/schedule/sprints/route.ts | POST | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 46 | v1/projexa/schedule/workload/route.ts | POST | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 47 | v1/projexa/tasks/[id]/route.ts | PATCH | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 48 | v1/projexa/vendors/[id]/portal-links/[linkId]/route.ts | DELETE | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 49 | v1/projexa/vendors/[id]/route.ts | PATCH | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 50 | v1/projexa/vendors/route.ts | POST | -- | KEY_RECORDS_NO_ACTOR | unchanged |
| 51 | v1/projexa/work-progress/activities/route.ts | POST | -- | KEY_RECORDS_NO_ACTOR | unchanged |

## 5. Decisions and open items for the PM

1. **Conflict with U-01d D1 (needs a ruling).** `v1/projexa/assistant`, `tasks` and `submissions` POST are covered by PM decision U-01d D1, pinned by 12 tests in `src/lib/pipeline/financial-redaction-followups.test.ts`: an API-key call that names nobody, or names an unlinked person, is redacted, never refused. That is the opposite of BR-215's 400, so these three routes (and `classify`, a read-scope sibling) were left exactly as on origin/main and allowlisted. They do not write key-attributed audit rows: the pipeline's `userId` reaches `logActivity` only when it matches a `users` row, and every executor that attributes a row to a person uses the separate `actorUserId` (person or null) and refuses in its own words. If the PM wants BR-215 to cover them, D1 and those tests change first.
2. **Generic external API.** `/api/compliance`, `/api/notices`, `/api/tasks/[id]`, `/api/pms/schedule/baselines` and their `/api/v1/*` twins, `/api/v1/documents`, `/api/v1/erp/budgets` are not PROJEXA-only: any org API key (a mobile app, a customer's own integration) now has to send `X-Acting-User` or `X-Acting-User-Email` on a write. That is what BR-215/BR-216 require (a key-attributed audit row without a person is exactly what BR-216 counts), but it is a contract change for those callers.
3. **The report-run POSTs stay key-readable.** `v1/reports/definitions/[id]/run` is the external-AI reporting gateway (`read` / `read:reports` keys, no person to name) and `v1/projexa/reports/definitions/[id]/run` is its twin; both are read-only report executions, so they were left on origin/main and allowlisted.
4. **One GET writes an audit row.** `GET v1/projexa/documents/[id]` records a "view". With an acting-user signal the row now names the person and the key; without one the read is still served and the row stays key-only. For BR-216 to reach 0, PROJEXA should send the headers on this GET as well (and on `GET pill-usage` / `GET module-chain`, so the strip and ranking follow the person the POSTs now record).
5. **BR-216 is only as good as PROJEXA's headers.** The code side is done: every converted API-key write refuses without a person. BR-216's live count reaches 0 only after PROJEXA sends the headers on the routes in section 6 (until then those writes fail with 400 instead of writing rows without a person), and the 3 kept pipeline routes write no audit rows.
6. **No flag.** DEV_TEST_DEPLOY_PLAN.md section 2.7 lists `BUILD001_ACTOR_ATTRIBUTION` (off = old rows). `src/lib/flags/build001.ts` does not exist yet (K-24) and this item's brief did not ask for it, so none was added; rollback is `git revert` of the merge.
7. **Guard change.** `scripts/check-route-auth-guard.mjs` now accepts `requireAuthOrApiKey(` as well as `requireAuth(` (the regex fix its own exemption comments deferred to "a future session"); without it this diff needed ~130 new exemption entries. A route with neither call still fails (checked with a probe route).
8. **Files beyond the claim.** The ACTIVE-CLAIMS entry names auth-guard.ts, the routes and the two tests. The work also touched `src/lib/audit.ts` (`auditActorOf`, `LogActivityActor`), `src/lib/audit-event-triggers.ts`, `src/lib/services/{actor-context,context}.ts` and 21 service files (audit actor derivation only), `scripts/check-route-auth-guard.mjs`, the new test seam `src/lib/supabase/__test-helpers__/acting-person-double.ts`, 19 existing route tests and `auth-guard.test.ts`. No database change.

## 6. Routes PROJEXA's proxy must send `X-Acting-User` / `X-Acting-User-Email` on

Every write below now returns 400 `ACTING_USER_REQUIRED` for an API key that names nobody. (`veridian-client.ts`'s `actingUserHeaders` already produces the headers; sending them on every call, reads included, is the simplest correct wiring.)

Alias URLs PROJEXA uses for re-exported handlers: `POST /api/v1/projexa/scope` (= `v1/construction/boq`), `POST /api/v1/projexa/scope/[id]/approve`, `POST /api/v1/projexa/scope/[id]/revisions`, `POST /api/v1/projexa/site-diary`, `POST /api/v1/projexa/site-instructions`.

Also recommended on these reads: `GET /api/v1/projexa/documents/[id]` (view audit row), `GET /api/v1/projexa/pill-usage`, `GET /api/v1/projexa/module-chain`.

- POST /api/compliance
- DELETE, PATCH /api/compliance/[id]
- POST /api/notices
- DELETE, PATCH /api/notices/[id]
- POST /api/pms/schedule/baselines
- PATCH /api/tasks/[id]
- POST /api/v1/compliance
- DELETE, PATCH /api/v1/compliance/[id]
- POST /api/v1/construction/boq
- POST /api/v1/construction/boq/[id]/approve
- POST /api/v1/construction/boq/[id]/excel/apply
- POST /api/v1/construction/boq/[id]/revisions
- PATCH /api/v1/construction/cost-visibility
- POST /api/v1/construction/kpi-entries
- POST /api/v1/construction/kpi-entries/[id]/approve
- POST /api/v1/construction/materials/issues
- POST /api/v1/construction/materials/receipts
- PATCH /api/v1/construction/materials/receipts/[id]
- POST /api/v1/construction/site-diary
- POST /api/v1/construction/site-instructions
- POST /api/v1/documents
- POST /api/v1/erp/budgets
- POST /api/v1/notices
- DELETE, PATCH /api/v1/notices/[id]
- POST /api/v1/projexa/access-review
- PATCH /api/v1/projexa/access-review/certifications/[id]
- POST /api/v1/projexa/audit-engagements
- POST /api/v1/projexa/audit-findings
- PATCH /api/v1/projexa/audit-findings/[id]
- POST /api/v1/projexa/billing-claims
- PATCH /api/v1/projexa/billing-claims/[id]
- PATCH /api/v1/projexa/board
- POST /api/v1/projexa/boq-scenarios
- DELETE, POST /api/v1/projexa/boq-scenarios/[id]/adjustments
- POST /api/v1/projexa/change-orders
- POST /api/v1/projexa/companies
- POST /api/v1/projexa/compliance-register
- POST /api/v1/projexa/credit-notes
- POST /api/v1/projexa/credit-notes/[id]/submit
- PUT /api/v1/projexa/currencies/base
- POST /api/v1/projexa/discuss
- PATCH /api/v1/projexa/documents/[id]
- POST /api/v1/projexa/documents/[id]/dispose
- POST /api/v1/projexa/documents/[id]/versions
- POST /api/v1/projexa/drawings
- PATCH /api/v1/projexa/drawings/[id]
- POST /api/v1/projexa/dunning-list/[invoiceId]/record
- POST /api/v1/projexa/expenses
- POST /api/v1/projexa/ffe
- POST /api/v1/projexa/floor-plans
- POST /api/v1/projexa/fraud-cases
- PATCH /api/v1/projexa/fraud-cases/[id]
- POST /api/v1/projexa/inventory/items
- POST /api/v1/projexa/inventory/stock-entries
- POST /api/v1/projexa/inventory/warehouses
- POST /api/v1/projexa/journal-entries
- POST /api/v1/projexa/knowledge-base
- PATCH /api/v1/projexa/knowledge-base/[id]
- POST /api/v1/projexa/leads
- PATCH /api/v1/projexa/leads/[id]
- POST /api/v1/projexa/leads/auto-distribute
- POST /api/v1/projexa/leads/bulk-reassign
- POST /api/v1/projexa/meetings
- POST /api/v1/projexa/milestones
- PATCH /api/v1/projexa/milestones/[id]
- POST /api/v1/projexa/mood-boards
- POST /api/v1/projexa/opportunities
- PATCH /api/v1/projexa/opportunities/[id]
- POST /api/v1/projexa/opportunities/auto-distribute
- POST /api/v1/projexa/opportunities/bulk-reassign
- POST /api/v1/projexa/permits
- PATCH /api/v1/projexa/permits/[id]
- POST /api/v1/projexa/pill-usage
- POST /api/v1/projexa/policies
- PATCH /api/v1/projexa/policies/[id]
- POST /api/v1/projexa/procurement/goods-receipts
- POST /api/v1/projexa/procurement/goods-receipts/[id]/submit
- POST /api/v1/projexa/procurement/purchase-orders
- DELETE, PATCH /api/v1/projexa/procurement/purchase-orders/[id]
- POST /api/v1/projexa/procurement/purchase-orders/[id]/submit
- POST /api/v1/projexa/procurement/quotations
- POST /api/v1/projexa/procurement/requisitions
- POST /api/v1/projexa/procurement/rfqs
- POST /api/v1/projexa/procurement/rfqs/[id]/send
- POST /api/v1/projexa/project-budgets
- POST /api/v1/projexa/project-budgets/[id]/submit
- POST /api/v1/projexa/projects
- POST /api/v1/projexa/punch-list
- PATCH /api/v1/projexa/punch-list/[id]
- POST /api/v1/projexa/purchase-orders
- POST /api/v1/projexa/quotations
- PATCH /api/v1/projexa/quotations/[id]
- POST /api/v1/projexa/quotations/[id]/convert
- POST /api/v1/projexa/quotations/[id]/revisions
- POST /api/v1/projexa/recruitment/applications
- POST /api/v1/projexa/recruitment/applications/[id]/hire
- POST /api/v1/projexa/recruitment/applications/[id]/interviews
- POST /api/v1/projexa/recruitment/applications/[id]/stage
- POST /api/v1/projexa/recruitment/candidates
- POST /api/v1/projexa/recruitment/interviews/[id]/feedback
- POST /api/v1/projexa/recruitment/job-openings
- POST /api/v1/projexa/recruitment/job-openings/[id]/status
- POST /api/v1/projexa/reports/share
- POST /api/v1/projexa/rfis
- PATCH /api/v1/projexa/rfis/[id]
- POST /api/v1/projexa/risks
- PATCH /api/v1/projexa/risks/[id]
- POST /api/v1/projexa/sales-invoices
- POST /api/v1/projexa/sales-invoices/[id]/cancel
- POST /api/v1/projexa/sales-invoices/[id]/payments
- POST /api/v1/projexa/sales-invoices/[id]/submit
- POST /api/v1/projexa/sales-orders
- PATCH /api/v1/projexa/sales-orders/[id]
- POST /api/v1/projexa/sales-orders/bulk-status
- POST /api/v1/projexa/schedule
- PATCH /api/v1/projexa/schedule/[id]
- PATCH /api/v1/projexa/schedule/[id]/completion
- POST /api/v1/projexa/schedule/baselines
- POST /api/v1/projexa/schedule/import
- POST /api/v1/projexa/scope/import
- POST /api/v1/projexa/subcontractor-retention-summary/[invoiceId]/release
- POST /api/v1/projexa/submittals
- PATCH /api/v1/projexa/submittals/[id]
- POST /api/v1/projexa/vendor-risk
- POST /api/v1/projexa/vendors/[id]/bank-accounts
- POST /api/v1/projexa/vendors/[id]/portal-links
- POST /api/v1/projexa/vendors/[id]/qualification
- POST /api/v1/projexa/vendors/[id]/sanction-checks
- POST /api/v1/projexa/veri-meetings
- DELETE, PATCH /api/v1/projexa/veri-meetings/[id]
- POST /api/v1/projexa/veri-meetings/[id]/action-items
- POST /api/v1/projexa/veri-meetings/[id]/generate-intelligence
- POST /api/v1/projexa/veri-meetings/[id]/share-links
- DELETE /api/v1/projexa/veri-meetings/share-links/[linkId]
- POST /api/v1/projexa/wiki
- PATCH /api/v1/tasks/[id]
