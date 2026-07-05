# VAIOS Architecture Strategy — Build vs. Integrate the Frappe Family

**Decision date:** 2026-07-05. **Status: decided and acted on.** This document
records a real architectural decision made mid-build, grounded in verified
facts (license checks + actual tool capability), not a hypothetical. It
supersedes any assumption that VAIOS will directly run frappe/erpnext,
frappe/hrms, frappe/crm, frappe/builder, or frappe/insights as live backend
services inside the commercial product.

## The request

Build VERIDIAN AI OS (VAIOS) end-to-end as a sellable product (India +
Middle East, mid-size ~₹1000cr/500-employee target), using the Frappe
family of open-source repos wherever possible instead of hand-coding
everything: `frappe/frappe`, `frappe/erpnext`, `frappe/hrms`, `frappe/crm`,
`frappe/builder`, `frappe/insights`, `frappe/payments`, `frappe/frappe_docker`.

## What was actually checked (not assumed)

Live license lookup via the GitHub API (`gh api repos/<org>/<repo> --jq
'.license.spdx_id'`) on 2026-07-05:

| Repo | License | Implication for a closed commercial SaaS |
|---|---|---|
| `frappe/frappe` | **MIT** | Fully permissive — no copyleft obligation even if modified and run as a service. |
| `frappe/erpnext` | **GPL-3.0** | Copyleft, but no network clause. Running an *unmodified or separately-maintained* instance as a backend service VAIOS talks to over API does not force VAIOS's own proprietary code to be released — this is the well-established "SaaS loophole" GPLv3 (unlike AGPL) leaves open, provided ERPNext isn't statically/dynamically linked into VAIOS's own binary. |
| `frappe/hrms` | **GPL-3.0** | Same as ERPNext. |
| `frappe/payments` | **MIT** | Fully permissive. |
| `frappe/frappe_docker` | **MIT** | Fully permissive (it's deployment tooling, not app code). |
| `frappe/crm` | **AGPL-3.0** | **Real risk.** AGPL's Section 13 extends copyleft to network use — a user interacting with an AGPL program *over a network*, even unmodified, is generally understood to trigger the obligation to offer them the corresponding source. Embedding this inside a closed commercial product is the single riskiest move on this list. |
| `frappe/builder` | **AGPL-3.0** | Same risk as CRM. |
| `frappe/insights` | **AGPL-3.0** | Same risk as CRM. |

## What was also checked: can this environment actually run any of it?

No. This session's only infrastructure-provisioning tools are the **Supabase
MCP** (Postgres/RLS/migrations) and the **Vercel MCP** (Next.js hosting).
Frappe/ERPNext/HRMS/CRM/Builder/Insights are Python applications requiring a
MariaDB database, a Redis queue, and the Frappe "bench" runtime (typically
via `frappe_docker`'s docker-compose stack) — there is no tool available
here to provision a MariaDB instance, a Redis instance, or run Docker
containers persistently in production. Even setting licensing aside
entirely, standing up a live Frappe/ERPNext instance is not something this
session's toolset can execute, verify, or keep running after the session
ends. Claiming otherwise would be fabricating a deployment that doesn't
exist — the opposite of the verification discipline this whole project has
followed since Wave 0.

## Decision

1. **Do not run any Frappe-family application as a live backend service
   inside VAIOS.** Not because of unwillingness, but because (a) two of
   the five apps are AGPL — genuine, non-hypothetical legal exposure for
   a commercial product sold to paying customers, and a decision that
   size should not be made silently by an AI agent mid-build without the
   business owner explicitly choosing to accept that exposure; and (b)
   this session has no tool capable of provisioning or persisting the
   required MariaDB/Redis/Docker infrastructure regardless of licensing.
   If the user wants to revisit this later with real cloud infrastructure
   provisioned (a VPS, or a managed Frappe Cloud instance) and an explicit,
   informed choice to accept AGPL's network-source obligation for the
   CRM/Builder/Insights slice specifically, that is a deliberate future
   decision to make with full facts in hand — not a default.
2. **Continue treating `frappe/erpnext` and `frappe/hrms` as reference
   material for doctype/data-model shape only** — exactly the discipline
   already used since Wave 49 (fetch real field definitions via the GitHub
   API for grounding, never copy code, never reuse their AI). This is safe
   under any license, since data-model shapes and business logic *ideas*
   are not copyrightable — only the literal expression is, and none of it
   is copied.
3. **Continue aggressively adopting narrow, permissively-licensed (MIT/
   Apache/BSD) open-source *npm packages*** for specific hard
   sub-problems, which is what "don't code everything, use open source"
   actually means inside a TypeScript/Next.js/Postgres stack — this is
   compatible with the existing architecture, ships today, and carries no
   copyleft risk. Already done: `xstate` (approval workflow engine
   reference), `json-rules-engine` (pricing rules candidate), `bwip-js`
   (barcode generation candidate), `Tremor`/`Recharts` (dashboard charts
   candidate). Continuing this wave: `mt940` (bank statement parsing, MIT)
   for the Bank Reconciliation build below.
4. **`frappe/payments` (MIT) is worth a closer look** as an actual
   *design* reference for India payment-gateway integration patterns
   (Razorpay/PayU/PayTM connector shapes) even though it's Python, not
   portable code — same research-not-reuse discipline, just flagged as
   higher-value reading than the AGPL apps given its permissive license
   removes any ambiguity about even studying its integration contracts
   closely.

## What this means for the VAIOS build plan

Nothing about the actual module roadmap changes — the Tier 1-4 priority
ranking in `ERP_BENCHMARK_COMPARISON.md` Section 10 stands. What changes is
*how* each item gets built: continue hand-building inside VERIDIAN's own
proven Next.js/Drizzle/Supabase architecture (as Waves 49-53 already did,
each independently verified via tsc/eslint/RLS-proof/live functional test/
deploy), reaching for a narrow MIT/Apache-licensed library instead of
hand-rolling only where a genuine one exists for that specific sub-problem.
This is slower module-by-module than "just run ERPNext," but it is the
only path that (a) this session's tools can actually execute and verify,
(b) keeps VAIOS's own code fully proprietary and sellable without copyleft
entanglement, and (c) keeps every module inside the same multi-tenant RLS/
audit/Purpose-Bound-AI governance substrate rather than bolting on a
second, differently-governed system with its own separate tenant model.
