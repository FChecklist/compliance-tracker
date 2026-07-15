# VERIDIAN AI — Microsoft Office Add-in Connector

GAP-CONNECTOR-LAYERS (Priority 14 Wave 2). Owner decision 2026-07-14: build
the Office Add-in connector first, ahead of the Browser Extension / Desktop
Companion connector layers named in the same gap
(`ai-os/MASTER-TRACKER.yaml`).

## What this is

A Word + Excel task-pane add-in that lets a user, without leaving the
document they are working in:

- **Browse** VERIDIAN compliance items (search, see status/type/due date),
  and insert a chosen item into the current Word document (as a paragraph)
  or Excel worksheet (as a new row).
- **Create** a new compliance item — optionally seeded from the current
  Word/Excel selection as the title — directly from the task pane, which
  lands in VERIDIAN the same way a normal compliance-item creation does.

## How it is wired (reusing existing infrastructure, not new auth)

- **Auth**: the add-in authenticates with a self-serve VERIDIAN API key
  (`vk_...`), the *same* mechanism that already exists at
  **Settings → API Keys** (`POST /api/settings/api-keys`) and already
  powers every `/api/v1/*` route via `requireAuthOrApiKey()`
  (`src/lib/supabase/auth-guard.ts`) / `validateApiKey()`
  (`src/lib/supabase/api-key-auth.ts`). No new issuance flow, no changes to
  `auth-guard.ts`/`schema.ts`'s auth shape.
- **Task pane**: static HTML/CSS/JS served from this Next.js app's own
  `public/office-addin/` directory — reachable at
  `https://<your-deployment-domain>/office-addin/taskpane.html` with zero
  extra hosting. Because it is served from the *same* domain as the API,
  its `fetch()` calls to `/api/v1/...` are same-origin — no CORS layer was
  needed or added.
- **Backend routes added** (all new, all thin, all reuse existing service
  functions — no schema/auth changes):
  - `GET /api/v1/connectors/office-addin/whoami` — validates the pasted
    key and returns the org name + key name, so the task pane can show
    "Connected as …".
  - `GET /api/v1/connectors/office-addin/departments` — id/name only,
    populates the "Create" form's department dropdown (no existing
    API-key-compatible departments endpoint existed before this).
  - Everything else (listing/creating compliance items) calls the
    already-existing, already-audited `GET`/`POST /api/v1/compliance`
    directly — no duplicate route was created for that, per this repo's
    "zero duplication" precedent.
- **VERI Chat was deliberately left out of this pass.** Investigated
  `chat-service.ts` first: `messages.senderId` is a hard foreign key to a
  real `compliance.users` row, and there is no existing apiKey-actor union
  for chat the way `compliance-service.ts` has for compliance items.
  Building one would be a second, separate, materially larger gap (the
  same FK-vs-actor bug class this codebase has hit before, e.g.
  `job_openings_posted_by_id_fkey`) — out of scope for this connector pass.
  Compliance items were the real, working, end-to-end feature instead.

## Local sideload testing (do this to verify it for real)

You do not need Microsoft Partner Center for any of this — sideloading is
a normal Office feature available to any Microsoft 365 user.

1. **Get a real VERIDIAN API key**: log into the VERIDIAN app → Settings →
   API Keys → Create Key → give it `read,write` scope → copy the `vk_...`
   value (shown once).
2. **Make sure the manifest points at a real, reachable HTTPS URL.**
   `office-addin/manifest.xml` defaults to the live deployment
   (`https://compliance-tracker-ai.vercel.app`). If the deployment domain
   has changed, replace every occurrence of that URL in
   `office-addin/manifest.xml` before sideloading (find/replace is safe —
   every occurrence is the same domain in `IconUrl`, `HighResIconUrl`,
   `SupportUrl`, `AppDomains`, `SourceLocation`, and the two `bt:Image`/
   `bt:Url` resources).
   - For local-only iteration against uncommitted changes instead of the
     deployed app, run `bun run dev` with HTTPS (Next.js 16 supports
     `next dev --experimental-https`, generates a local self-signed cert)
     and point the manifest at `https://localhost:3000` instead — Office
     requires HTTPS for the task pane URL even when sideloaded locally,
     plain `http://localhost` will not load.
3. **Sideload in Word or Excel (desktop)**:
   - Open Word or Excel → **Insert** tab → **Add-ins** (or **My Add-ins**)
     → **Upload My Add-in** (sometimes under a "..." / "Manage My
     Add-ins" menu depending on version) → browse to
     `office-addin/manifest.xml` in this repo → **Upload**.
   - A "VERIDIAN AI" button appears on the Home ribbon (or the add-in
     opens directly) — click it to open the task pane.
4. **Sideload in Word or Excel on the web** (no desktop install needed):
   - Open Word/Excel at office.com → **Insert** → **Add-ins** → **Upload
     My Add-in** → upload `office-addin/manifest.xml` the same way.
5. **In the task pane**: paste the `vk_...` key → **Connect**. You should
   see "Connected as `<your org name>`". Switch to the **Browse** tab to
   search/list real compliance items and insert one into the document/
   sheet; switch to **Create** to build a new one (optionally seeded from
   selected document/cell text via **Use current document selection as
   title**).

No screenshot of this exists in this PR — Word/Excel cannot be driven from
this environment. The steps above are the literal, exact click path; they
are the way to verify this for real.

## What is genuinely NOT done, and why (real external dependency)

**Microsoft AppSource / organization-wide "Deploy to Users" distribution**
is explicitly out of reach for an agent, and was not faked:

- Publishing to AppSource requires a **Microsoft Partner Center account**
  (its own paid/verified registration, tied to a real organization/
  individual identity) — the Owner's credential, not something an agent
  can create or hold.
- AppSource submissions go through **Microsoft's own manual + automated
  validation review** (content policy, security scan, functional test) —
  this is external gatekeeping, not a build step.
- Org-wide "Deploy to Users" via the Microsoft 365 admin center similarly
  needs the Owner's admin access to a real Microsoft 365 tenant.

Everything upstream of that boundary — the manifest, the task-pane app,
the backend API surface, and this local-sideload testing path — is real,
committed, and independently testable today without any of the above.

## Files

- `office-addin/manifest.xml` — the add-in manifest (XML format, for
  sideload/AppSource; not the newer unified JSON manifest).
- `public/office-addin/taskpane.html` / `taskpane.css` / `taskpane.js` —
  the task pane app (served statically by this Next.js app).
- `public/office-addin/assets/icon-{16,32,64,80,128}.png` — add-in icons
  (VERIDIAN navy/saffron mark, generated to match `CLAUDE.md`'s documented
  design tokens).
- `src/app/api/v1/connectors/office-addin/whoami/route.ts`,
  `src/app/api/v1/connectors/office-addin/departments/route.ts` — the two
  new backend routes.