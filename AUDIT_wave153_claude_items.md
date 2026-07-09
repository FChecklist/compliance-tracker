# Audit — Wave 153 (Claude): Brain architecture groundwork

**Branch:** `wave153/brain-groundwork`
**Scope:** Phase A only of the 4-phase strangler-fig migration described in `Phase4_Implementation_Plan.md`. Two new thin-wrapper routes added to THIS repo under the `/api/v1/brain/*` namespace. The sibling repo `FChecklist/veridian-brain` is out of scope and was not read.

**Files audited (read once each):**
1. `src/app/api/v1/brain/capabilities/route.ts`
2. `src/app/api/v1/brain/entity-relationships/route.ts`

**Reference pattern (read once):**
3. `src/app/api/v1/projexa/capability-tree/route.ts`

---

## 1. Auth pattern parity with the reference route

Reference route (`projexa/capability-tree/route.ts`) applies, in order:
1. `requireAuthOrApiKey(request)` → early-return `ctx.response` if set
2. `requireRoleOrScope(ctx, "member", "read")` → return `roleErr` if set
3. `if (!ctx.orgId)` guard → 400
4. Tenant-scoped call using `ctx.orgId` + `ctx.dbUser?.id ?? ctx.apiKey!.id`

**`capabilities/route.ts`** — lines 11-15 reproduce steps 1-3 verbatim (same imports from `@/lib/supabase/auth-guard`, same `"member"`/`"read"` args, same orgId guard). ✅ No step skipped.

**`entity-relationships/route.ts`** — lines 11-15 reproduce steps 1-3 identically. ✅ No step skipped.

Neither route short-circuits the role/scope check, and neither omits the `ctx.orgId` guard. Both pass.

## 2. orgId provenance — cross-tenant data access

In both new routes, `ctx.orgId` is sourced exclusively from the authenticated session established by `requireAuthOrApiKey`. It is **never** read from a query parameter, header, or request body.

- `capabilities/route.ts` line 22: `findSimilarCapabilities(query, ctx.orgId, limit)` — `query` and `limit` are client-supplied, but the scoping key (`ctx.orgId`) is session-derived. A caller cannot influence which org's capabilities are searched.
- `entity-relationships/route.ts` line 22: `getNeighbors({ orgId: ctx.orgId, userId: ctx.dbUser?.id ?? ctx.apiKey!.id }, { entityType, entityId })` — `entityType`/`entityId` are client-supplied node identifiers, but the tenant context object is built entirely from `ctx`. The client cannot supply an `orgId`.

No IDOR / cross-org vector introduced by these routes. ✅

## 3. Input validation

**`capabilities/route.ts`:**
- `query` is validated at line 17: `if (!query?.trim()) return ... 400`. An empty/whitespace-only/missing `query` is rejected with a 400 **before** reaching `findSimilarCapabilities`. Empty string is never passed through to the search. ✅
- `limit` (line 18): `Math.min(Number(...) || 10, 25)` — coerced, defaulted to 10, hard-capped at 25. A non-numeric `limit` yields `NaN` → `|| 10` → 10. No unbounded query risk. ✅

**`entity-relationships/route.ts`:**
- `entityType` and `entityId` are validated at line 18: both must be present and truthy, else 400. ✅
- **Minor note (not a blocker):** neither value is checked against an allowlist or format. `entityType`/`entityId` are passed straight into `getNeighbors`. This is acceptable *only because* the service scopes by `ctx.orgId` (RLS), so an attacker-supplied `entityId` belonging to another org should return no rows rather than leak them. Worth a follow-up to confirm `entity-graph-service.ts` enforces the orgId filter on the lookup (not re-read here per task scope), but the route itself does its job: it never trusts the client for tenancy.

## 4. Information disclosure in error handling

**`capabilities/route.ts`** (lines 24-27): catch block logs the real error via `console.error` server-side and returns a **generic** `{ error: "Failed to search capabilities" }` with 500. No internal detail leaks to the client. ✅

**`entity-relationships/route.ts`** (lines 24-27): identical pattern — `console.error` server-side, generic `{ error: "Failed to fetch entity relationships" }`, 500. ✅

Notably, **both new routes are stricter than the reference route they claim to mirror.** The reference `projexa/capability-tree/route.ts` (lines 22-24) does `const message = error instanceof Error ? error.message : ...` and returns that `message` to the client — that is a mild information-disclosure pattern (stack/DB error text can reach the caller). The Wave 153 routes correctly avoided copying that behaviour. This is a point in Claude's favour, not a defect.

## 5. `getNeighbors()` scoping (entity-relationships)

Per the task, without re-reading `entity-graph-service.ts`: the route at line 22 constructs the context object as `{ orgId: ctx.orgId, userId: ctx.dbUser?.id ?? ctx.apiKey!.id }` and passes it as the **first** argument to `getNeighbors`, with the client's `{ entityType, entityId }` as the (second) selector argument. This matches the tenant-context shape used by the reference route (`withTenantContext({ orgId, userId }, ...)`), so the caller's own `orgId`/`userId` are forwarded correctly and the client selectors are kept separate from the tenant context. Provided `entity-graph-service.ts`'s Phase 3 RLS design keys its query on that first-arg context (the route has no way to override it), scoping is intact. ✅

The `ctx.dbUser?.id ?? ctx.apiKey!.id` fallback mirrors the reference route exactly and is safe: for session auth it uses the DB user id; for API-key auth it uses the key's id. The `!` on `ctx.apiKey!` is justified because `requireAuthOrApiKey` guarantees one of the two auth paths succeeded before this line is reachable.

---

## Summary table

| Check | capabilities | entity-relationships |
|---|---|---|
| requireAuthOrApiKey present | ✅ | ✅ |
| requireRoleOrScope("member","read") present | ✅ | ✅ |
| ctx.orgId guard before use | ✅ | ✅ |
| orgId sourced only from session | ✅ | ✅ |
| Required params validated → 400 | ✅ (query) | ✅ (entityType+entityId) |
| Error handling non-leaking | ✅ (better than reference) | ✅ (better than reference) |
| Tenant context forwarded to service | ✅ | ✅ |

## Notes / non-blocking follow-ups
- Confirm `entity-graph-service.ts` actually filters its `getNeighbors` lookup by the `orgId` in the supplied context (route is correct; this is a service-layer confirmation, out of scope for this read).
- Optional hardening: allowlist/regex `entityType` in `entity-relationships/route.ts` to fail fast on unknown types. Not required for security given RLS scoping.
- Consider backporting the new routes' generic-error pattern to the reference `projexa/capability-tree/route.ts`, which currently leaks `error.message` to the client.

---

## Overall verdict: APPROVE WITH NOTES

Both new routes faithfully reproduce the reference auth chain (requireAuthOrApiKey → requireRoleOrScope → orgId guard), source `orgId` exclusively from the authenticated session, validate required inputs with 400s, and avoid leaking internal error detail to the client (in fact improving on the reference route's error handling). No OWASP-class issue found in the two audited files. The notes above are non-blocking confirmations/hardening suggestions, none of which block merge.
