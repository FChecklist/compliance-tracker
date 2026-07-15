# Priority 21 — Layer 2 Workspace Memory (memvid capsule) — Design Doc

Status: **design + real feasibility check done, v1 implementation follows this doc**.
Written per CONTROLLER.yaml PRIORITY-21 (LiteRT/Bonsai/memvid research,
`memory/veridian_priority21_litert_bonsai_memvid.md`'s addendum) and the
Owner's direct approval to build Layer 2 of the 3-tier memory model. Matches
this repo's own design-first precedent (`ai-os/priority18b_stage0_design.md`).

## 0. The actual ask, distilled

Three memory layers, not one undifferentiated "cache":
- **Layer 1 Browser Memory** (device-only) — MERGED, PR #324:
  `src/lib/browser-intent-cache.ts` (IndexedDB) + `IntentCommandPalette.tsx`.
- **Layer 2 Workspace Memory** — THIS DOC. A portable, per-user/team memory
  capsule using `@memvid/sdk` (Apache-2.0). Real motivation: this repo's own
  `memory/veridian_cache_objectives_evaluation.md` already named cross-device
  "no software" sync as the one genuinely unsolved item in the Owner's cache
  wishlist — a browser-only cache physically cannot follow a user across
  devices without a network hop. A portable capsule file is a real mechanism
  for that gap (produce it on device A, carry/send it, consume it on device B).
- **Layer 3 Enterprise Memory** — already exists: pgvector + RLS
  (`src/lib/embeddings.ts` and friends). Stays authoritative; Layer 2
  complements it, never replaces it, and never becomes a second source of
  truth for anything RLS already governs live.

## 1. What already exists (read directly, not assumed)

- **`src/lib/db/tenant-scoped.ts`** — `withTenantContext({orgId, userId}, fn)`
  is the only sanctioned way to touch tenant data; every new table's queries
  must run inside it.
- **`src/lib/audit.ts`** — `logActivity({tx, action, entityType, entityId,
  orgId, dbUser, request, details})` is the single call site for audit rows;
  reused as-is for both export and import events (no new audit mechanism).
- **`src/lib/db/schema.ts`** — `conversations`/`messages` (line ~3219/3272,
  `isAiThread` flag, `conversationParticipants`) and `savedReports` (line
  ~4029, `ownedById`, `filters` jsonb, `sourceEntity`) are the two existing
  tables Layer 2 v1 draws its content from. No conversation-summarization
  helper exists anywhere in this codebase (grepped) — v1 does not invent one;
  see §3.1.
- **`src/app/api/documents/route.ts`** — the established file-blob pattern:
  a private Supabase Storage bucket (`compliance-documents`), a service-role
  admin client used only server-side after `requireAuth()`, an org-scoped
  object path, a `documents` row storing the path (never a public URL). This
  is the exact pattern Layer 2's capsule storage reuses (§3.2) — the bucket
  itself was provisioned once outside any SQL migration (grepped `drizzle/`
  for its creation — not found; it's a one-time Storage-console/MCP step, not
  migration-tracked), which is why §5's self-correction reuses this existing
  bucket rather than proposing a second one that would need the same
  out-of-migration provisioning step again.
- **`src/app/api/veri-meetings/[id]/export/route.ts`** — precedent for a
  user-triggered, `requireAuth()`-gated export endpoint returning a
  `Content-Disposition: attachment` response.
- **`src/components/ApiKeySection.tsx`** + **`src/app/(app)/settings/page.tsx`**
  — the exact UI shape Layer 2's entry point copies: a named section in
  Settings' left-nav, a card with a primary action button, a list of past
  items with a delete action, toasts for success/failure. Not a new UI
  paradigm.
- **`ai-os/CONSTITUTION.yaml`** — `ARCH-03` (RLS in the same migration),
  `ARCH-06` (license verdict before code), `ARCH-08` (cross-tenant posture),
  `SEC-04` (no silent overwrite/delete), `DATA-03` (org/user data export —
  **status `NOT_YET_BUILT`, explicitly logged "do NOT build without a
  separate go-ahead"**). This is directly relevant and addressed in §3.7.

## 2. Feasibility check — real, not assumed

Ran `bun add @memvid/sdk` and `bun run build` in this worktree (not a fresh
scratch repo — this repo's actual `package.json`/`bun.lock`), per the task's
explicit instruction not to assume.

### 2.1 Install: succeeds
`bun add @memvid/sdk` completed — `1683 packages installed [590.51s]`,
`@memvid/sdk@2.0.160` resolved with its platform-matched native binary.
`package.json` diff is a single clean line
(`"@memvid/sdk": "^2.0.160"`). No install failure.

### 2.2 Native binary / Vercel runtime compatibility
`optionalDependencies`: `@memvid/sdk-{darwin-arm64,darwin-x64,
linux-x64-gnu,linux-arm64-gnu,win32-x64-msvc}` — **no linux-musl variant**.
Vercel's Node.js serverless functions run on Amazon Linux (glibc), which
matches `linux-x64-gnu` — compatible. Confirms the task's framing: this
belongs in a Node.js serverless route, **never** the Edge runtime (Edge
cannot load native `.node` bindings at all). GitHub Actions' `ubuntu-latest`
CI runner is also glibc, so the same binary installs there too — no CI-vs-
Vercel mismatch.

### 2.3 Dependency weight: heavier than "lazy" suggested, but real usage is narrow
`@memvid/sdk`'s own `package.json` lists `@langchain/langgraph`,
`@langchain/openai`, `@llamaindex/core`, `@llamaindex/openai`, `langchain`,
`llamaindex`, `@gutenye/ocr-node`, `officeparser`, `unpdf`, `exceljs`,
`@google/generative-ai`, `@ai-sdk/openai` as **regular `dependencies`**, not
`peerDependencies` (the actual peer-optional set is narrower:
`@langchain/core`/`ai`/`llamaindex`/`openai`/`zod`, all marked
`peerDependenciesMeta.optional: true`). Practical effect, measured directly:
`bun add` pulled these onto disk regardless of whether the app ever calls
anything beyond core capsule read/write —

| new package tree | measured size |
|---|---|
| `onnxruntime-node` (OCR ML inference, via `@gutenye/ocr-node`) | 220 MB |
| `@napi-rs/canvas` (~10 platform binaries) | 36.8 MB |
| `@gutenye/ocr-node` (bundles its own `sharp` for ~15 platforms) | 36.5 MB |
| `@llamaindex/*` | 36.9 MB |
| `@langchain/*` + `langchain` | 28.4 MB |
| `llamaindex` | 10.6 MB |
| `@memvid/sdk` itself | 21.6 MB |
| `tesseract.js` | 1.6 MB |
| **total new node_modules weight** | **~392 MB** |

However — read `node_modules/@memvid/sdk/dist/index.js` and
`dist/adapters/*.js` directly: the top-level entry unconditionally
`require()`s every adapter file (`./adapters/langchain`,
`./adapters/llamaindex`, `./adapters/vercel_ai`, `./adapters/openai`, …) as
side-effect registrations, but each adapter's actual heavy import
(`require("@langchain/core/tools")`, `require("llamaindex")`, `require("ai")`)
sits **inside an `async` factory function**, guarded by `try/catch`, only
invoked when the caller explicitly does `use("langchain", file)` /
`.ask()`-style calls. `create(filename, kind="basic")` / `open(filename,
"basic")` — the two entry points v1 actually needs — route to a `"basic"`
adapter that is a plain no-op registration (`dist/adapters/basic.js`, zero
external requires). The core `put()`/`find()`/`timeline()`/`seal()` methods
call straight into `this.core.*`, the native N-API binding — confirmed by
reading the class methods directly, not the docs. **Conclusion: for v1's
actual call surface (`create`/`open` with `kind: "basic"`, `put`, `timeline`,
`seal`), none of the langchain/llamaindex/OCR code paths execute at
runtime.** The ~392 MB is a real, unavoidable **install-time / disk** cost of
adding this package at all (`dependencies`, not `peerDependencies` — bun/npm
installs them unconditionally), not a **runtime** cost for v1's narrow usage.

**Real open risk, not fully resolved by this check**: Next.js's production
build uses `@vercel/nft` (output file tracing) to decide what ships in each
serverless function's bundle. `nft` does static analysis of `require()`
calls reachable from a route — it does not execute code, so a `require()`
sitting inside an always-registered-but-conditionally-invoked adapter file
may still be picked up by the tracer even though it never runs for `kind:
"basic"`. This repo has **zero prior use of `serverExternalPackages` /
`outputFileTracingExcludes`** in `next.config.ts` (checked directly — file
only wires next-intl + Sentry). §3.2 makes adding
`serverExternalPackages: ["@memvid/sdk"]` part of v1's implementation
(matches Next.js's own standard guidance for native-binding packages, e.g.
`sharp`), not a "nice to have" — this is the concrete mitigation for the risk
this feasibility check surfaced, not a promise the bundle is provably small.

### 2.4 Build verification — inconclusive, matches a pre-existing sandbox limit
Ran `bun run build` for real after the install. It hangs at `Creating an
optimized production build ...` with no further output — **this exact
behavior, verbatim, was already independently documented by a prior session**
(`ai-os/boss/ACTIVE-CLAIMS.yaml`, Priority 18a entry: "`bun run build` (next
build) fails in this sandbox with no visible error beyond 'Creating an
optimized production build...' — this sandbox has no `DATABASE_URL`/Supabase
env vars configured at all"). Same symptom here, before and unrelated to
this change — this sandbox cannot complete a full `next build` regardless of
diff content. Not treated as a memvid-specific failure. `npx tsc --noEmit`
and `eslint` (this task's actual required verification, §6 below) are what
was really run and passed.

### 2.5 Telemetry — a real finding, not previously flagged anywhere
`node_modules/@memvid/sdk/dist/analytics.js`: the SDK sends anonymous
telemetry (SHA-256 hash of the resolved file path, an anon ID, command name,
success boolean — not file content) to `https://memvid.com/api/analytics/
ingest` on every `create`/`open`/`put`/etc call, **by default**, opt-out only
via `MEMVID_TELEMETRY=0`. No file content leaves the process, but "phones
home by default" for a compliance platform is not something to leave on
implicitly. §3.6 makes `MEMVID_TELEMETRY=0` a required env var for this
feature, set before any capsule code path can run — same spirit as ARCH-08's
opt-in-only posture, applied here even though this isn't literally
cross-tenant learning.

### 2.6 License verdict (ARCH-06)
`@memvid/sdk` itself: Apache-2.0 (confirmed via `npm view`, matches
`memory/veridian_priority21_litert_bonsai_memvid.md`'s prior finding). Its
native per-platform binaries (`@memvid/sdk-*`) ship from the same
`memvid_ai` publisher/monorepo, same license family. **Scoped verdict: clear
to write code against `@memvid/sdk`'s core API (`create`/`open`/`put`/
`find`/`timeline`/`seal`) for v1.** The bundled-but-unused
langchain/llamaindex/OCR dependency tree's own licenses (MIT/Apache-2.0 mix,
spot-checked, not exhaustively re-verified here) are **out of this verdict's
scope** because v1 never executes that code — re-verify properly if a later
wave ever turns on `.ask()`/RAG/adapter functionality.

**Overall feasibility verdict: GO, for the narrow v1 scope in §3, with 3
required mitigations carried into implementation: `serverExternalPackages`
(§2.3), `MEMVID_TELEMETRY=0` (§2.5/§3.6), and reusing the existing
`compliance-documents` bucket rather than provisioning a new one (§5).** Not
silently substituting a different memvid interface (CLI/Rust crate) — the
Node SDK works as intended for this scope.

## 3. Design

### 3.1 Capsule v1 scope — concrete, minimal, NOT a full data dump
A capsule contains, for exactly one exporting user, in exactly one org:
1. **Their own saved report definitions** (`savedReports` where
   `ownedById = user.id`) — the report *definition* (`name`, `description`,
   `sourceEntity`, `filters`, `groupByField`, `chartType`), never a live
   re-query of the underlying compliance/financial data. This is the
   deliberate line that keeps a capsule from becoming a side channel for
   bulk org data export (relevant to `DATA-03`'s own "not yet built,
   needs a separate go-ahead" status — see §3.7).
2. **Their own recent AI-thread conversations** — `conversations` where
   `isAiThread = true` AND the user is in `conversationParticipants`,
   capped to the most recent 20 conversations and the most recent 200
   messages per conversation (bounded — "recent," not a historical
   archive). Stores each message's `content`, `senderId` (null = VERI),
   `assistantId`, `createdAt` — raw dialogue, not an AI-generated summary:
   **no conversation-summarization helper exists anywhere in this codebase**
   (grepped before designing this), and building one is real scope growth
   beyond "produce/consume a capsule file," so v1 does not invent one. A
   future wave can add a real summarization pass and store its output
   alongside the raw messages without a capsule-format change.
3. Each item becomes one `put()` call into the capsule (`kind: "basic"`,
   no embeddings, no LLM calls) with `metadata: { type: "saved_report" |
   "conversation", sourceId, orgId, exportedAt }`.

Explicitly NOT in v1: other users' conversations, org-wide compliance/
financial records, live report data, anything from Layer 3 (pgvector stays
the query-time source of truth) — matches this doc's own brief ("not a dump
of everything").

### 3.2 Data model — RLS-safe, migration plan

New table `workspace_memory_capsule_events` (schema.ts, drizzle migration),
one row per export or import action — doubles as this feature's own
domain-specific event log (in addition to the generic `auditLogs` row every
export/import also writes via `logActivity()`):

```ts
export const workspaceMemoryCapsuleEvents = complianceSchemaDB.table('workspace_memory_capsule_events', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  userId: text('user_id').notNull(), // the exporting/importing user -- never another user's capsule
  direction: text('direction').notNull(), // 'export' | 'import'
  storageObjectPath: text('storage_object_path').notNull(), // path within the existing 'compliance-documents' bucket
  fileSizeBytes: integer('file_size_bytes').notNull(),
  itemCounts: jsonb('item_counts').notNull().default({}), // { savedReports: N, conversations: N, messages: N }
  status: text('status').notNull().default('completed'), // 'completed' | 'failed'
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})
```

Migration (new `drizzle/02XX_workspace_memory_capsule_events.sql`) ships RLS
in the **same** migration per ARCH-03, verbatim template already used by
`drizzle/0197_prompt_cache_metrics.sql`:

```sql
ALTER TABLE compliance.workspace_memory_capsule_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.workspace_memory_capsule_events FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_workspace_memory_capsule_events ON compliance.workspace_memory_capsule_events FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.workspace_memory_capsule_events TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.workspace_memory_capsule_events TO service_role;
```

Org-level RLS is necessary but not sufficient here (a capsule is
per-*user*, not just per-org) — every application-level read/write of this
table additionally filters `userId = dbUser.id` in the route/service layer,
the same "RLS is the floor, not the whole story" posture `savedReports`'
own `ownedById` column already uses. Written, **not applied live** — left
for the supervising session per this repo's own established convention
(every other schema-touching claim in `ACTIVE-CLAIMS.yaml` does the same).

Capsule binary storage: the **existing** `compliance-documents` Supabase
Storage bucket (no new bucket — see §5), object path
`{orgId}/workspace-memory/{userId}/{createId()}.mv2`, uploaded via the same
service-role admin client pattern as `src/app/api/documents/route.ts`.

### 3.3 Export flow
`POST /api/workspace-memory/export` (new route):
1. `requireAuth()` — real session required, no API-key path (this is a
   personal action, not a server-to-server integration).
2. `withTenantContext({orgId, userId})`: pull the user's own `savedReports`
   and AI-thread `conversations`/`messages` per §3.1's bounds.
3. `create(tmpPath, "basic")` (memvid, in-process, `MEMVID_TELEMETRY=0` set),
   `put()` each item, `seal()`, read the resulting bytes.
4. Upload bytes to the `compliance-documents` bucket at the path above.
5. Insert one `workspace_memory_capsule_events` row (`direction: 'export'`),
   and one `logActivity()` call (`action: 'export'`, `entityType:
   'WorkspaceMemoryCapsule'`) inside the same transaction — audit-logged,
   matching this repo's universal convention, not a new mechanism.
6. Return a short-lived signed URL (same signed-URL pattern the
   `compliance-documents` bucket already uses elsewhere) for the user to
   download the `.mv2` file. User-initiated only — nothing exports
   automatically, no schedule, no background job.

### 3.4 Import flow
`POST /api/workspace-memory/import` (new route), `multipart/form-data`
upload of a `.mv2` file:
1. `requireAuth()`.
2. Size-cap the upload (reuse `documents` route's 25 MB ceiling as the same
   sanity bound).
3. Store the uploaded bytes to a temp path, `open(path, "basic")` —
   `verifyMemvid()`/`doctorMemvid()` first to reject a corrupt/foreign file
   with a clear error before touching any database write (fail closed).
4. Read entries via `timeline()`/`find()`. Per SEC-04 ("never silently
   overwrite/corrupt... only through an approved workflow"):
   - `saved_report` entries become **new** `savedReports` rows owned by the
     importing user — never an UPDATE of an existing row. If a report with
     the same `name` already exists for this user, the imported copy is
     suffixed `" (imported <date>)"` — conflict is resolved by keeping both,
     never by silent overwrite.
   - `conversation` entries do **not** get reinjected into the live
     `conversations`/`messages` tables — that model has real
     participant/FK/RLS semantics this capsule format doesn't carry, and
     silently resurrecting old AI-thread history into a live conversation
     (possibly in a different org than where it was exported) is exactly the
     kind of silent-corruption risk SEC-04 exists to prevent. v1 parses them
     only to report an accurate count back to the user; the uploaded
     capsule itself (full conversation content included) is preserved as-is
     in the bucket, so nothing is lost — but this pass does **not** build a
     dedicated in-app viewer for that content. Saying otherwise would
     overclaim what's actually built; a real "view an imported conversation"
     screen is a legitimate small follow-up, not implied by this PR.
5. One `workspace_memory_capsule_events` row (`direction: 'import'`) + one
   `logActivity()` call, same as export.

### 3.5 UI entry point
New `WorkspaceMemorySection.tsx` component, added to
`src/app/(app)/settings/page.tsx`'s `SETTINGS_NAV` (a `Brain`-icon
"Workspace Memory" entry, next to "AI Assistants" — same nav-item shape
every other section already uses, no new UI paradigm). Body mirrors
`ApiKeySection.tsx` exactly: a "Export My Workspace Memory" button (calls
§3.3, then triggers the signed-URL download), an "Import" button (file
picker → §3.4), and a list of past `workspace_memory_capsule_events` rows
(direction, item/byte counts, timestamp) — the same
list-of-past-items-with-status shape `ApiKeySection.tsx` already uses for
keys. This list shows counts only, not conversation content — no dedicated
viewer for imported conversation dialogue is built this pass (see §3.4).

### 3.6 Required runtime configuration
- `MEMVID_TELEMETRY=0` set wherever this route executes (env var, not a
  per-call option — the SDK reads it at call time) — closes §2.5's finding.
- `next.config.ts`: `serverExternalPackages: ["@memvid/sdk"]` — closes
  §2.3's bundling risk (this repo's first use of this Next.js option;
  documented inline in the config with a comment pointing back to this doc).

### 3.7 ARCH-08 / DATA-03 relationship (read carefully, not glossed over)
This is **not** the cross-tenant learning capability ARCH-08 governs (no
data crosses an org boundary, no shared/platform-tier model is trained on
anything here) — but it shares ARCH-08's spirit and this design holds to it
anyway: a capsule is always scoped to exactly one `(orgId, userId)` pair at
creation time, both on export (§3.1's queries are `WHERE ownedById =
user.id` / participant-scoped) and on import (an imported report is always
owned by the *importing* user in the *importing* org — there is no
mechanism to import "as" a different user or to merge into another org's
data). No reversible-to-source-org transformation exists because there is no
transformation to reverse — the capsule's own content is already exactly
the exporting user's own RLS-scoped data.

This **does** overlap conceptually with `DATA-03` ("org/end-user can
download their own data on request" — currently `NOT_YET_BUILT`, logged
"do NOT build without a separate go-ahead" per Owner instruction
2026-07-14). Flagging directly rather than glossing over it: **this
feature is deliberately narrower than DATA-03** — DATA-03 as written implies
a complete personal/org data export; this ships a small, named subset
(saved report definitions + recent AI-thread dialogue) as the specific,
Owner-approved Layer 2 memory-portability feature, not a general "download
all your data" button. It does not close DATA-03's gap and should not be
recorded as having done so. If a future session is tempted to expand this
capsule's scope toward "everything," that expansion is DATA-03 territory
and needs the same separate go-ahead DATA-03 itself is already waiting on —
noted here so nobody mistakes incremental growth of this feature for
implicit permission.

### 3.8 SEC-04 (import never silently overwrites)
Covered concretely in §3.4: imports are additive-only (new rows, suffixed
names on conflict) for reports, and read-only/non-live for conversations —
there is no code path in this design where an import can update or delete
an existing row.

## 4. Open question for the Owner — cross-device SYNC TRANSPORT (not decided here)

This design produces and consumes a real `.mv2` file. It deliberately does
**not** build how that file gets from device A to device B. Three real
options, with tradeoffs:

1. **Manual download/upload** (simplest, zero new integration surface): user
   clicks "Export," downloads the file via their OS, carries it however they
   like (USB drive, personal cloud folder, email to self), clicks "Import"
   on the other device. Zero new attack surface, zero new third-party
   dependency, but it is real manual work every time — the least "no
   software" of the three, closest to what's actually being asked though.
2. **Existing cloud-storage connector** (Content Pipeline's Google Drive
   integration, per `memory/content_pipeline_credentials.md`): auto-save the
   capsule to the user's connected Drive folder on export, auto-fetch the
   latest on import. Removes the manual carry step, but requires the user to
   have that connector configured, and ties Layer 2's core value
   (portability) to a specific already-built integration's uptime/scope —
   more moving parts, more places this can silently fail.
3. **A new first-party sync endpoint** (VERIDIAN stores the capsule
   server-side and a second device pulls it directly): this is the least
   "portable file" and the most "just Enterprise Memory again" — arguably
   defeats the point of a capsule format at all, since server-side storage
   with RLS is exactly what Layer 3 already is.

**Recommendation, not a decision**: start with (1) manual download/upload
for v1 (already what §3.3/§3.4 build) since it needs no new integration and
lets the Owner validate the capsule concept itself before investing in
transport automation; treat (2) as the natural next step once (1) is proven
useful, since the connector already exists and Google Drive is a genuine
"no software the user has to think about" experience once connected. (3) is
not recommended — it would quietly reintroduce a server-side copy of
personal data that Layer 2 was supposed to let the user carry themselves,
without adding anything Layer 3 doesn't already do better. **This section is
intentionally a recommendation, not a build decision — implementation stops
at "produces/consumes a real `.mv2` file" per the task brief, and the actual
transport is not built until the Owner picks one.**

## 5. Self-correction pass (re-read against constraints + feasibility findings, revised once)

Re-reading this doc against `ARCH-03`/`ARCH-06`/`ARCH-08`/`SEC-04` and the
§2 feasibility findings surfaced 3 real problems with the first draft,
corrected before implementation started:

1. **New Storage bucket → reused existing bucket.** The first draft
   proposed a new `workspace-memory-capsules` bucket. Checking how
   `compliance-documents` itself came to exist (grepped `drizzle/` — no
   creation SQL, confirming it was a one-time Storage-console/MCP step
   outside migration tracking) means a *new* bucket would need that same
   manual, non-PR-reviewable provisioning step before this feature could
   even be tested — a real dependency this implementation shouldn't
   introduce for a capsule file that comfortably fits the existing bucket's
   25 MB limit. Corrected to reuse `compliance-documents` under a
   `workspace-memory/` path prefix — everything stays inside this PR's own
   diff, no manual infra step required to land it.
2. **Telemetry not in the original feasibility framing.** The task's brief
   asked about bundle size and lazy-loading, not telemetry — but reading
   `analytics.js` directly (not skipping past a file that "looked like"
   pure utility code) surfaced a default-on external network call on every
   SDK operation. Added §2.5/§3.6 rather than shipping it silently — this
   is exactly the class of thing ARCH-06/ARCH-08's "read what you actually
   adopt" discipline is for, even though it's not literally a license or
   cross-tenant issue.
3. **Conversation import was originally going to reinsert into live
   `conversations`/`messages`.** First draft treated import as symmetric
   with export (write the same rows back). Re-reading SEC-04 specifically
   ("never silently overwrite/corrupt... only through an approved
   workflow") against `conversations`' real shape (`conversationParticipants`
   FK, RLS keyed off participant membership, cross-org ambiguity if
   imported into a different org than the export came from) made clear that
   reinserting into the live table is a real corruption/confusion risk, not
   a hypothetical one. Corrected to the read-only, non-live conversation
   view in §3.4/§3.5 — only `savedReports` (a simpler, single-owner,
   no-participant-model table) gets a real additive write path on import.

No other section changed. The DATA-03 relationship (§3.7) was written
carefully the first time specifically because that tension was visible from
the very first constitution read, not found on this reread.

## 6. Explicitly NOT built this pass
- The cross-device sync transport itself (§4) — stops at a real `.mv2` file.
- Any use of memvid's `.ask()`/RAG/adapter functionality (kept to
  `kind: "basic"`, `put`/`find`/`timeline`/`seal` only) — no LLM calls, no
  cost, no license re-verification needed for the unused adapter tree.
- Any change to `src/lib/supabase/auth-guard.ts` or the auth/membership
  shape in `schema.ts`.
- Closing `DATA-03` (§3.7) — this is a narrower, separate feature.
