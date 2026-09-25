repo: FChecklist/projexa
main_sha: e88b53e
generated_utc: 2026-09-25T06:32:57Z
route_count: 310
module_count: 109

# TABLE 1 - FChecklist/projexa src/app/api/**/route.ts (main e88b53e12bf0e2166d194b29d125680ed507b861)

Module = first path segment under src/app/api/. Route = one route.ts file. Classification is derived from the handler source (not from the module name): PROXY_TO_CT = every route forwards to compliance-tracker through src/lib/veridian-client.ts (callVeridian*/createCachedVeridianGet) and touches no projexa DB/storage; OWN_DB = reads/writes projexa own Supabase (drizzle `db` or supabase-js `.from()/.storage/.rpc`) with no compliance-tracker call; OWN_LOGIC = neither; MIXED = at least one route (or one module route set) combines them, or computes locally over compliance-tracker data.

| module | routes | classification | ct_counterpart_module |
|---|---|---|---|
| access-review | 2 | PROXY_TO_CT | access-review |
| accounts | 1 | PROXY_TO_CT | accounts |
| ai | 2 | MIXED | tasks, assistant |
| ai-link | 1 | OWN_DB | - |
| ar-aging | 1 | PROXY_TO_CT | ar-aging |
| assistant | 1 | MIXED | assistant |
| attendance | 5 | PROXY_TO_CT | attendance |
| audit-engagements | 1 | PROXY_TO_CT | audit-engagements |
| audit-findings | 2 | PROXY_TO_CT | audit-findings |
| balance-sheet | 1 | PROXY_TO_CT | balance-sheet |
| bank-reconciliation | 1 | PROXY_TO_CT | bank-reconciliation |
| billing-claims | 2 | PROXY_TO_CT | billing-claims |
| board | 1 | PROXY_TO_CT | board |
| capability-tree | 1 | PROXY_TO_CT | capability-tree |
| chain-options | 1 | MIXED | v1-root:construction/labour-roster, scope |
| change-orders | 3 | PROXY_TO_CT | change-orders |
| classify | 1 | PROXY_TO_CT | classify |
| companies | 1 | PROXY_TO_CT | companies |
| compliance-register | 1 | PROXY_TO_CT | compliance-register |
| construction-budget | 1 | PROXY_TO_CT | - ; DEAD_UPSTREAM(no route.ts in CT origin/main): v1/construction/budget/lines |
| construction-materials | 2 | PROXY_TO_CT | v1-root:construction/materials |
| contact | 1 | OWN_DB | - |
| conversations | 2 | OWN_DB | - |
| cost-centers | 1 | PROXY_TO_CT | cost-centers |
| credit-notes | 3 | PROXY_TO_CT | credit-notes |
| currencies | 1 | PROXY_TO_CT | currencies |
| customers | 3 | PROXY_TO_CT | customers |
| dashboard | 1 | PROXY_TO_CT | dashboard |
| dashboard-hierarchy | 5 | MIXED | dashboard, hr, expenses, sales-invoices, work-progress, reports |
| design-materials | 1 | PROXY_TO_CT | design-materials |
| discuss | 1 | PROXY_TO_CT | discuss |
| documents | 4 | PROXY_TO_CT | v1-root:documents, documents ; DEAD_UPSTREAM(no route.ts in CT origin/main): v1/documents/X/dispose |
| drawings | 4 | PROXY_TO_CT | drawings |
| email | 3 | MIXED | - |
| employees | 2 | PROXY_TO_CT | employees |
| exceptions | 1 | PROXY_TO_CT | exceptions |
| expenses | 1 | PROXY_TO_CT | expenses |
| ffe | 3 | PROXY_TO_CT | ffe |
| finance-dashboard | 1 | PROXY_TO_CT | finance-dashboard |
| fiscal-years | 1 | PROXY_TO_CT | fiscal-years |
| floor-plans | 7 | PROXY_TO_CT | floor-plans |
| fraud-cases | 2 | PROXY_TO_CT | fraud-cases |
| grc-dashboard | 1 | PROXY_TO_CT | grc-dashboard |
| hr | 2 | PROXY_TO_CT | hr |
| integrations | 5 | MIXED | - |
| internal | 1 | MIXED | - |
| inventory | 5 | PROXY_TO_CT | inventory |
| journal-entries | 3 | PROXY_TO_CT | journal-entries |
| knowledge-base | 3 | PROXY_TO_CT | knowledge-base |
| kpi-entries | 2 | PROXY_TO_CT | v1-root:construction/kpi-entries |
| kpis | 2 | PROXY_TO_CT | kpis |
| labour-roster | 4 | PROXY_TO_CT | v1-root:construction/labour-roster, labour-roster |
| leads | 4 | PROXY_TO_CT | leads |
| leave | 3 | PROXY_TO_CT | leave |
| manpower-cost-report | 1 | PROXY_TO_CT | reports |
| materials | 5 | PROXY_TO_CT | v1-root:construction/materials |
| meetings | 3 | PROXY_TO_CT | meetings |
| milestones | 2 | PROXY_TO_CT | milestones |
| module-chain | 1 | PROXY_TO_CT | module-chain |
| moms | 7 | PROXY_TO_CT | veri-meetings |
| mood-boards | 3 | PROXY_TO_CT | mood-boards |
| notifications | 2 | OWN_DB | - |
| opportunities | 4 | PROXY_TO_CT | opportunities |
| org | 6 | MIXED | (platform) v1/platform/provision-org |
| org-members | 2 | OWN_DB | - |
| org-users | 1 | PROXY_TO_CT | users |
| organization | 3 | MIXED | currencies |
| payroll | 14 | PROXY_TO_CT | payroll |
| permits | 2 | PROXY_TO_CT | permits |
| pill-usage | 1 | PROXY_TO_CT | pill-usage |
| policies | 2 | PROXY_TO_CT | policies |
| procurement | 14 | PROXY_TO_CT | procurement |
| products | 1 | PROXY_TO_CT | products |
| profit-and-loss | 1 | PROXY_TO_CT | profit-and-loss |
| profit-and-loss-by-project | 1 | PROXY_TO_CT | profit-and-loss-by-project |
| project-budgets | 5 | PROXY_TO_CT | project-budgets |
| projects | 4 | MIXED | projects, dashboard, reports |
| punch-list | 2 | MIXED | punch-list |
| purchase-orders | 1 | PROXY_TO_CT | purchase-orders |
| quotations | 5 | PROXY_TO_CT | quotations |
| recruitment | 10 | PROXY_TO_CT | recruitment |
| reports | 8 | PROXY_TO_CT | reports |
| rfis | 2 | MIXED | rfis |
| risks | 2 | PROXY_TO_CT | risks |
| sales-invoices | 5 | PROXY_TO_CT | sales-invoices |
| sales-order-document-flow | 1 | PROXY_TO_CT | sales-order-document-flow |
| sales-orders | 3 | PROXY_TO_CT | sales-orders |
| sales-pipeline | 1 | PROXY_TO_CT | sales-pipeline |
| schedule | 12 | PROXY_TO_CT | schedule |
| schedule-tracker | 1 | PROXY_TO_CT | - ; DEAD_UPSTREAM(no route.ts in CT origin/main): v1/construction/schedule |
| scope | 13 | PROXY_TO_CT | scope, v1-root:construction/cost-visibility |
| screen-drafts | 2 | PROXY_TO_CT | screen-drafts |
| search | 1 | MIXED | rfis, submittals, punch-list, change-orders |
| shared | 1 | PROXY_TO_CT | (public, non-projexa) api/veri-meetings/share/[token]/pdf |
| shell | 1 | MIXED | capability-tree, currencies, dashboard, pill-usage, vendors |
| site-diary | 2 | PROXY_TO_CT | site-diary |
| site-instructions | 2 | PROXY_TO_CT | v1-root:documents, site-instructions |
| submittals | 2 | MIXED | submittals |
| tasks | 2 | PROXY_TO_CT | tasks |
| tax-templates | 1 | PROXY_TO_CT | tax-templates |
| timesheets | 7 | PROXY_TO_CT | timesheets |
| todos | 2 | OWN_DB | - |
| trial-balance | 1 | PROXY_TO_CT | trial-balance |
| user-preference | 1 | OWN_DB | - |
| vendor-risk | 1 | PROXY_TO_CT | vendor-risk |
| vendors | 7 | PROXY_TO_CT | vendors |
| veridian-link | 1 | OWN_LOGIC | - |
| wiki | 2 | PROXY_TO_CT | wiki |
| work-progress | 8 | MIXED | work-progress, v1-root:construction/labour-roster, attendance, scope, reports |

Module totals: MIXED=16, OWN_DB=7, OWN_LOGIC=1, PROXY_TO_CT=85; sum=109
Route totals (route.ts files by own classification): MIXED=23, OWN_DB=22, OWN_LOGIC=1, PROXY=264; sum=310

## Table 1 notes - every non-PROXY_TO_CT module (evidence)

- **ai** (2 routes; MIXED=2)
    - ai/apply/route.ts : MIXED (CT direct; own-DB direct)
    - ai/[token]/route.ts : MIXED (CT direct; own-DB via lib/services/ai-link-service.ts)
- **ai-link** (1 routes; OWN_DB=1)
    - ai-link/route.ts : OWN_DB (own-DB via lib/services/ai-link-service.ts)
- **assistant** (1 routes; MIXED=1)
    - assistant/route.ts : MIXED (CT direct; own-DB direct)
- **chain-options** (1 routes; MIXED=1)
    - chain-options/route.ts : MIXED (CT direct; local compute)
- **contact** (1 routes; OWN_DB=1)
    - contact/route.ts : OWN_DB (own-DB via lib/services/contact-service.ts)
- **conversations** (2 routes; OWN_DB=2)
    - conversations/route.ts : OWN_DB (own-DB direct)
    - conversations/[id]/messages/route.ts : OWN_DB (own-DB direct)
- **dashboard-hierarchy** (5 routes; MIXED=5)
    - dashboard-hierarchy/companies/route.ts : MIXED (CT via lib/company-scope.ts; own-DB via lib/company-scope.ts)
    - dashboard-hierarchy/companies/[companyId]/dashboard/route.ts : MIXED (CT via lib/company-scope.ts; own-DB via lib/company-scope.ts)
    - dashboard-hierarchy/companies/[companyId]/departments/route.ts : MIXED (CT via lib/company-scope.ts; own-DB via lib/company-scope.ts)
    - dashboard-hierarchy/companies/[companyId]/projects/[projectId]/route.ts : MIXED (CT via lib/company-scope.ts; own-DB via lib/company-scope.ts)
    - dashboard-hierarchy/companies/[companyId]/projects/[projectId]/category-distribution/route.ts : MIXED (CT via lib/company-scope.ts; own-DB via lib/company-scope.ts; local compute)
- **email** (3 routes; MIXED=2, OWN_DB=1)
    - email/inbound/route.ts : MIXED (CT via lib/services/digest-item-dispatcher.ts; own-DB via lib/services/digest-item-dispatcher.ts,lib/services/digest-item-service.ts)
    - email/send-digest/route.ts : MIXED (CT via lib/email/digest.ts; own-DB via lib/email/digest.ts,lib/services/email-token-service.ts)
    - email/[token]/route.ts : OWN_DB (own-DB via lib/services/email-token-service.ts)
- **integrations** (5 routes; MIXED=2, OWN_DB=3)
    - integrations/google-sheets/disconnect/route.ts : OWN_DB (own-DB direct)
    - integrations/google-sheets/refresh/route.ts : MIXED (CT via lib/google-sheets/push.ts; own-DB via lib/google-sheets/push.ts)
    - integrations/google-sheets/setup/route.ts : OWN_DB (own-DB via lib/google-sheets/spreadsheet-builder.ts)
    - integrations/google-sheets/status/route.ts : OWN_DB (own-DB direct)
    - integrations/google-sheets/webhook/route.ts : MIXED (CT via lib/google-sheets/pull.ts,lib/google-sheets/push.ts,lib/services/boq-create-service.ts; own-DB via lib/google-sheets/pull.ts,lib/google-sheets/push.ts,lib/services/member-role-service.ts)
- **internal** (1 routes; MIXED=1)
    - internal/email-digest-cadence/run/route.ts : MIXED (CT via lib/email/digest.ts; own-DB via lib/email/digest.ts,lib/services/email-token-service.ts)
- **notifications** (2 routes; OWN_DB=2)
    - notifications/route.ts : OWN_DB (own-DB direct)
    - notifications/[id]/read/route.ts : OWN_DB (own-DB direct)
- **org** (6 routes; MIXED=2, OWN_DB=4)
    - org/invites/route.ts : OWN_DB (own-DB direct)
    - org/invites/accept/route.ts : OWN_DB (own-DB direct)
    - org/invites/preview/route.ts : OWN_DB (own-DB direct)
    - org/invites/[id]/route.ts : OWN_DB (own-DB direct)
    - org/provision/route.ts : MIXED (CT direct; own-DB direct)
    - org/repair/route.ts : MIXED (CT direct; own-DB direct)
- **org-members** (2 routes; OWN_DB=2)
    - org-members/route.ts : OWN_DB (own-DB via lib/settings-source.ts)
    - org-members/[id]/route.ts : OWN_DB (own-DB direct)
- **organization** (3 routes; OWN_DB=2, PROXY=1)
    - organization/route.ts : OWN_DB (own-DB via lib/settings-source.ts)
    - organization/currency/route.ts : PROXY (CT direct)
    - organization/email-schedule/route.ts : OWN_DB (own-DB via lib/email/schedule-service.ts)
- **projects** (4 routes; MIXED=1, PROXY=3)
    - projects/route.ts : PROXY (CT direct)
    - projects/overview/route.ts : PROXY (CT direct)
    - projects/[id]/route.ts : PROXY (CT direct)
    - projects/[id]/category-distribution/route.ts : MIXED (CT direct; local compute)
- **punch-list** (2 routes; MIXED=1, PROXY=1)
    - punch-list/route.ts : MIXED (CT direct; own-DB via lib/services/notification-service.ts)
    - punch-list/[id]/route.ts : PROXY (CT direct)
- **rfis** (2 routes; MIXED=1, PROXY=1)
    - rfis/route.ts : MIXED (CT direct; own-DB via lib/services/notification-service.ts)
    - rfis/[id]/route.ts : PROXY (CT direct)
- **search** (1 routes; MIXED=1)
    - search/route.ts : MIXED (CT via lib/project-selection.ts,lib/services/search-service.ts; own-DB via lib/services/project-preference-service.ts,lib/services/search-service.ts)
- **shell** (1 routes; MIXED=1)
    - shell/route.ts : MIXED (CT direct; own-DB direct)
- **submittals** (2 routes; MIXED=1, PROXY=1)
    - submittals/route.ts : PROXY (CT direct)
    - submittals/[id]/route.ts : MIXED (CT direct; own-DB via lib/services/notification-service.ts)
- **todos** (2 routes; OWN_DB=2)
    - todos/route.ts : OWN_DB (own-DB direct)
    - todos/[id]/route.ts : OWN_DB (own-DB direct)
- **user-preference** (1 routes; OWN_DB=1)
    - user-preference/last-project/route.ts : OWN_DB (own-DB via lib/services/project-preference-service.ts)
- **veridian-link** (1 routes; OWN_LOGIC=1)
    - veridian-link/route.ts : OWN_LOGIC (no CT call, no DB)
- **work-progress** (8 routes; MIXED=1, OWN_DB=1, PROXY=6)
    - work-progress/route.ts : PROXY (CT direct)
    - work-progress/activities/route.ts : PROXY (CT direct)
    - work-progress/photos/route.ts : OWN_DB (own-DB direct)
    - work-progress/report/route.ts : MIXED (CT direct; local compute)
    - work-progress/report/pdf/route.ts : PROXY (CT direct)
    - work-progress/report/share/route.ts : PROXY (CT direct)
    - work-progress/report/xlsx/route.ts : PROXY (CT direct)
    - work-progress/[id]/route.ts : PROXY (CT direct)

## Projexa own database (evidence)

- src/lib/db/schema.ts (437 lines) declares 22 pgTable()s: organizations, memberships, veridian_credentials, google_sheets_integration, assistant_queries, conversations, conversation_participants, messages, org_invites, profiles, notifications, todos, work_progress_photos, security_audit_log, contact_requests, org_ai_link, email_action_token, org_email_schedule, email_digest_run, email_digest_delivery, email_digest_item, daily_report_note.
- Live check (SELECT on information_schema.tables, project evpckeuxgvahguwsaeul, 2026-09-25): all 22 of those table names exist in schema public. Result rows = 22.
- src/app/api/ai/[token]/route.ts:36-38 states in a comment that compliance.pipeline_tasks lives in a different Supabase project (pcrjmlpuqsbocqfwoxod) than this repo own Postgres (evpckeuxgvahguwsaeul).
- src/lib/db/index.ts builds the pooler URL from NEXT_PUBLIC_SUPABASE_URL (the projexa project) unless DATABASE_URL is set; it is a lazy Proxy so importing it needs no DATABASE_URL.

# TABLE 2 - FChecklist/compliance-tracker origin/main src/app/api/v1/projexa/**/route.ts (287 routes / 106 modules)

Source: git ls-tree -r origin/main (compliance-tracker, ref 025eea08). This is the surface the previously circulated PROJEXA_ROUTE_SITEMAP documents; module names and all 106 per-module counts equal this table row for row (verified by script, diff = empty). "projexa_caller_modules" = projexa modules whose route.ts files (or, in brackets, projexa lib/page files) contain a callVeridian*/createCachedVeridianGet call whose path literal matches a route.ts of that CT module (static match: method not checked, template segments treated as wildcards, so it is an upper bound).

| ct_module | ct_routes | in_projexa_main_as_module_name | projexa_caller_modules | note |
|---|---|---|---|---|
| access-review | 2 | yes | access-review | 2/2 routes reached |
| accounts | 1 | yes | [lib/budget-lookups.ts], accounts | 1/1 routes reached |
| ai | 4 | yes | NONE | 0/4 routes reached |
| ar-aging | 1 | yes | ar-aging | 1/1 routes reached |
| asset-to-gl-reconciliation | 1 | NO (CT-only) | NONE | 0/1 routes reached |
| assistant | 1 | yes | ai, assistant | 1/1 routes reached |
| attendance | 4 | yes | attendance, work-progress | 4/4 routes reached |
| audit-engagements | 1 | yes | audit-engagements | 1/1 routes reached |
| audit-findings | 2 | yes | audit-findings | 2/2 routes reached |
| balance-sheet | 1 | yes | balance-sheet | 1/1 routes reached |
| bank-reconciliation | 1 | yes | bank-reconciliation | 1/1 routes reached |
| billing-claims | 2 | yes | [lib/email/digest.ts], [lib/services/digest-item-dispatcher.ts], billing-claims | 2/2 routes reached |
| board | 1 | yes | board | 1/1 routes reached |
| boq-scenarios | 6 | NO (CT-only) | NONE | 0/6 routes reached |
| capability-tree | 1 | yes | capability-tree, shell | 1/1 routes reached |
| chain-options | 1 | yes | NONE | 0/1 routes reached |
| change-orders | 3 | yes | [lib/services/search-service.ts], change-orders | 3/3 routes reached |
| classify | 1 | yes | classify | 1/1 routes reached |
| companies | 1 | yes | [lib/budget-lookups.ts], companies | 1/1 routes reached |
| compliance-register | 1 | yes | compliance-register | 1/1 routes reached |
| cost-center-hierarchy | 1 | NO (CT-only) | NONE | 0/1 routes reached |
| cost-center-line-items | 1 | NO (CT-only) | NONE | 0/1 routes reached |
| cost-centers | 1 | yes | [lib/budget-lookups.ts], cost-centers | 1/1 routes reached |
| credit-notes | 3 | yes | credit-notes | 3/3 routes reached |
| currencies | 2 | yes | [app/(app)/dashboard/page.tsx], currencies, organization, shell | 2/2 routes reached |
| customer-payment-behavior | 1 | NO (CT-only) | NONE | 0/1 routes reached |
| customers | 3 | yes | customers | 3/3 routes reached |
| dashboard | 2 | yes | [app/(app)/materials/page.tsx], [lib/dashboard-overview.ts], [lib/google-sheets/push.ts], dashboard, dashboard-hierarchy, projects, shell | 2/2 routes reached |
| design-materials | 1 | yes | design-materials | 1/1 routes reached |
| discuss | 1 | yes | discuss | 1/1 routes reached |
| documents | 3 | yes | documents | 2/3 routes reached |
| drawings | 4 | yes | drawings | 4/4 routes reached |
| dunning-list | 2 | NO (CT-only) | NONE | 0/2 routes reached |
| employees | 2 | yes | employees | 2/2 routes reached |
| exceptions | 1 | yes | exceptions | 1/1 routes reached |
| expenses | 1 | yes | dashboard-hierarchy, expenses | 1/1 routes reached |
| ffe | 3 | yes | ffe | 3/3 routes reached |
| finance-dashboard | 1 | yes | finance-dashboard | 1/1 routes reached |
| fiscal-years | 1 | yes | [lib/budget-lookups.ts], fiscal-years | 1/1 routes reached |
| floor-plans | 7 | yes | floor-plans | 7/7 routes reached |
| fraud-cases | 2 | yes | fraud-cases | 2/2 routes reached |
| grc-dashboard | 1 | yes | [lib/module-list-source.ts], grc-dashboard | 1/1 routes reached |
| hr | 2 | yes | dashboard-hierarchy, hr | 2/2 routes reached |
| inventory | 5 | yes | inventory | 5/5 routes reached |
| journal-entries | 3 | yes | journal-entries | 3/3 routes reached |
| knowledge-base | 4 | yes | [lib/module-list-source.ts], knowledge-base | 3/4 routes reached |
| kpis | 2 | yes | kpis | 2/2 routes reached |
| labour | 1 | NO (CT-only) | NONE | 0/1 routes reached |
| labour-roster | 2 | yes | labour-roster | 2/2 routes reached |
| leads | 6 | yes | leads | 4/6 routes reached |
| leave | 3 | yes | leave | 3/3 routes reached |
| materials | 1 | yes | NONE | 0/1 routes reached |
| meetings | 3 | yes | meetings | 3/3 routes reached |
| milestones | 2 | yes | milestones | 2/2 routes reached |
| module-chain | 1 | yes | module-chain | 1/1 routes reached |
| mood-boards | 3 | yes | mood-boards | 3/3 routes reached |
| opportunities | 6 | yes | opportunities | 4/6 routes reached |
| org-users | 1 | yes | NONE | 0/1 routes reached |
| payment-proposal-list | 1 | NO (CT-only) | NONE | 0/1 routes reached |
| payroll | 14 | yes | payroll | 14/14 routes reached |
| permits | 2 | yes | [app/(app)/dashboard/page.tsx], permits | 2/2 routes reached |
| phrase-map | 1 | NO (CT-only) | NONE | 0/1 routes reached |
| pill-usage | 1 | yes | pill-usage, shell | 1/1 routes reached |
| policies | 2 | yes | policies | 2/2 routes reached |
| predictions | 1 | NO (CT-only) | NONE | 0/1 routes reached |
| procurement | 14 | yes | procurement | 14/14 routes reached |
| products | 1 | yes | [app/(app)/projects/new/page.tsx], [lib/google-sheets/pull.ts], products | 1/1 routes reached |
| profit-and-loss | 1 | yes | profit-and-loss | 1/1 routes reached |
| profit-and-loss-by-project | 1 | yes | profit-and-loss-by-project | 1/1 routes reached |
| project-budgets | 5 | yes | project-budgets | 5/5 routes reached |
| projects | 2 | yes | [lib/email/digest.ts], [lib/google-sheets/pull.ts], [lib/module-list-source.ts], [lib/project-selection.ts], projects | 2/2 routes reached |
| punch-list | 2 | yes | [lib/email/digest.ts], [lib/services/digest-item-dispatcher.ts], [lib/services/search-service.ts], punch-list | 2/2 routes reached |
| purchase-orders | 1 | yes | purchase-orders | 1/1 routes reached |
| quotations | 5 | yes | quotations | 5/5 routes reached |
| recruitment | 10 | yes | recruitment | 10/10 routes reached |
| reports | 7 | yes | [lib/google-sheets/push.ts], attendance, dashboard-hierarchy, manpower-cost-report, projects, reports, work-progress | 7/7 routes reached |
| rfis | 2 | yes | [lib/email/digest.ts], [lib/services/digest-item-dispatcher.ts], [lib/services/search-service.ts], rfis | 2/2 routes reached |
| risks | 2 | yes | risks | 2/2 routes reached |
| sales-invoices | 5 | yes | dashboard-hierarchy, sales-invoices | 5/5 routes reached |
| sales-order-document-flow | 1 | yes | sales-order-document-flow | 1/1 routes reached |
| sales-orders | 3 | yes | sales-orders | 3/3 routes reached |
| sales-pipeline | 1 | yes | sales-pipeline | 1/1 routes reached |
| sales-rep-performance | 1 | NO (CT-only) | NONE | 0/1 routes reached |
| schedule | 13 | yes | [app/(app)/schedule/page.tsx], [lib/schedule-reference.ts], schedule | 12/13 routes reached |
| scope | 12 | yes | [lib/google-sheets/pull.ts], [lib/google-sheets/push.ts], [lib/services/boq-create-service.ts], chain-options, scope, work-progress | 12/12 routes reached |
| screen-definitions | 1 | NO (CT-only) | [app/(app)/change-orders/page.tsx], [app/(app)/dashboard/project/page.tsx], [lib/module-list-source.ts], [lib/screen-definitions.ts] | 1/1 routes reached |
| screen-drafts | 2 | yes | screen-drafts | 2/2 routes reached |
| site-diary | 2 | yes | site-diary | 2/2 routes reached |
| site-instructions | 2 | yes | site-instructions | 2/2 routes reached |
| statistical-key-figure-report | 1 | NO (CT-only) | NONE | 0/1 routes reached |
| storage-status | 1 | NO (CT-only) | [lib/storage-status.ts] | 1/1 routes reached |
| subcontractor-payment-application-status | 1 | NO (CT-only) | NONE | 0/1 routes reached |
| subcontractor-retention-summary | 2 | NO (CT-only) | NONE | 0/2 routes reached |
| submissions | 1 | NO (CT-only) | NONE | 0/1 routes reached |
| submittals | 2 | yes | [lib/email/digest.ts], [lib/services/digest-item-dispatcher.ts], [lib/services/search-service.ts], submittals | 2/2 routes reached |
| tasks | 2 | yes | ai, tasks | 2/2 routes reached |
| tax-templates | 1 | yes | tax-templates | 1/1 routes reached |
| timesheets | 7 | yes | timesheets | 7/7 routes reached |
| trial-balance | 1 | yes | trial-balance | 1/1 routes reached |
| users | 1 | NO (CT-only) | org-users | 1/1 routes reached |
| vendor-payment-behavior | 1 | NO (CT-only) | NONE | 0/1 routes reached |
| vendor-risk | 1 | yes | vendor-risk | 1/1 routes reached |
| vendors | 7 | yes | shell, vendors | 7/7 routes reached |
| veri-meetings | 7 | NO (CT-only) | moms | 7/7 routes reached |
| wiki | 3 | yes | wiki | 2/3 routes reached |
| work-progress | 5 | yes | [lib/google-sheets/pull.ts], dashboard-hierarchy, work-progress | 5/5 routes reached |

CT routes reached by at least one projexa call (any projexa src file, static match): 249 of 287; unreached: 38.

Non-projexa CT routes (under /api/v1/ root and outside /projexa/) that projexa calls with `root: true` and that DO exist in CT origin/main:
- src/app/api/v1/construction/cost-visibility/route.ts
- src/app/api/v1/construction/kpi-entries/[id]/approve/route.ts
- src/app/api/v1/construction/kpi-entries/route.ts
- src/app/api/v1/construction/labour-roster/[id]/route.ts
- src/app/api/v1/construction/labour-roster/route.ts
- src/app/api/v1/construction/materials/[id]/route.ts
- src/app/api/v1/construction/materials/cost-report/export/route.ts
- src/app/api/v1/construction/materials/cost-report/route.ts
- src/app/api/v1/construction/materials/issues/route.ts
- src/app/api/v1/construction/materials/receipts/[id]/route.ts
- src/app/api/v1/construction/materials/receipts/route.ts
- src/app/api/v1/construction/materials/route.ts
- src/app/api/v1/documents/route.ts

Projexa calls that target a CT path with NO route.ts in CT origin/main (would return HTTP 404 upstream; no rewrites in CT next.config.ts, no catch-all route under src/app/api):
- projexa src/app/api/construction-budget/lines/route.ts (POST) -> /api/v1/construction/budget/lines (root:true)
- projexa src/app/api/documents/[id]/dispose/route.ts (POST) -> /api/v1/documents/{id}/dispose (root:true; CT only has /api/v1/projexa/documents/[id]/dispose)
- projexa src/app/api/schedule-tracker/route.ts (GET) -> /api/v1/construction/schedule?projectId= (root:true)

# CT-ONLY MODULES (in compliance-tracker /api/v1/projexa, absent as a module name in projexa main): 20

| ct_only_module | ct_routes | logic lives | consumed by projexa main? |
|---|---|---|---|
| asset-to-gl-reconciliation | 1 | CT src/lib/services/erp-fixed-assets-service.ts (assetToGlReconciliation) | NO (zero references in projexa src) |
| boq-scenarios | 6 | CT src/lib/services/boq-scenario-service.ts + construction-boq-service.ts (6 routes) | NO (zero references in projexa src) |
| cost-center-hierarchy | 1 | CT src/lib/services/erp-accounting-service.ts (costCenterHierarchyReport) | NO (zero references in projexa src) |
| cost-center-line-items | 1 | CT src/lib/services/erp-accounting-service.ts (listJournalEntryLinesByCostCenter) | NO (zero references in projexa src) |
| customer-payment-behavior | 1 | CT src/lib/services/erp-invoicing-service.ts (customerPaymentBehaviorReport) | NO (zero references in projexa src) |
| dunning-list | 2 | CT src/lib/services/erp-invoicing-service.ts (dunningList, recordDunningAction) | NO (zero references in projexa src) |
| labour | 1 | CT route re-exports GET/POST of src/app/api/v1/construction/labour-roster/route (alias; projexa uses the /v1/construction path via root:true instead) | NO (zero references in projexa src) |
| payment-proposal-list | 1 | CT src/lib/services/erp-invoicing-service.ts (paymentProposalList) | NO (zero references in projexa src) |
| phrase-map | 1 | CT src/lib/ai/batch/analyse.ts (promotePhraseMapCandidate) | NO (zero references in projexa src) |
| predictions | 1 | CT route re-exports GET of src/app/api/v1/construction/predictions/[activityId]/route | NO (zero references in projexa src) |
| sales-rep-performance | 1 | CT src/lib/services/crm-service.ts (getSalesRepPerformanceDashboard) | NO (zero references in projexa src) |
| screen-definitions | 1 | CT src/lib/screens/resolve-definition.ts (resolveScreenDefinition); CALLED by projexa src/lib/module-list-source.ts:201 and pages (server components), not by an api route | yes (lib/pages, server-side) |
| statistical-key-figure-report | 1 | CT src/lib/services/erp-costing-service.ts (statisticalKeyFigureReport) | NO (zero references in projexa src) |
| storage-status | 1 | CT src/lib/storage-config.ts (getStorageStatus); CALLED by projexa src/lib/storage-status.ts:35,73, not by an api route | yes (lib/storage-status.ts) |
| subcontractor-payment-application-status | 1 | CT src/lib/services/erp-payment-entries-service.ts (subcontractorPaymentApplicationStatus) | NO (zero references in projexa src) |
| subcontractor-retention-summary | 2 | CT src/lib/services/erp-invoicing-service.ts (subcontractorRetentionSummary, releaseSubcontractorRetention) | NO (zero references in projexa src) |
| submissions | 1 | CT src/lib/pipeline/run-submission.ts (runSubmission; L0 pipeline entry) | NO (zero references in projexa src) |
| users | 1 | CT src/lib/services/hr-service.ts (listEmployees, filterOrgUsersByQuery); CALLED by projexa org-users route | yes (org-users route) |
| vendor-payment-behavior | 1 | CT src/lib/services/erp-invoicing-service.ts (vendorPaymentBehaviorReport) | NO (zero references in projexa src) |
| veri-meetings | 7 | CT src/lib/services/veri-meeting-service.ts; CALLED by projexa moms module (7 routes) | yes (moms module, 7 routes) |

Of the 20: 4 are consumed by projexa under a different module name (screen-definitions, storage-status, users, veri-meetings); 16 have no projexa consumer in src at e88b53e (labour has UI pages named /labour but they call the labour-roster proxy; submissions matches only a schema column word).

# PROJEXA-ONLY MODULES (in projexa main, absent as a module name in compliance-tracker /api/v1/projexa): 23

| projexa_only_module | routes | classification | logic lives |
|---|---|---|---|
| ai-link | 1 | OWN_DB | projexa own DB: src/lib/services/ai-link-service.ts (table org_ai_link); public read route ai/[token] is a separate module |
| construction-budget | 1 | PROXY_TO_CT | forwards to CT /api/v1/construction/budget/lines which has NO route.ts in CT origin/main (dead upstream) |
| construction-materials | 2 | PROXY_TO_CT | forwards to CT /api/v1/construction/materials/cost-report(+export) (v1 root, exists) |
| contact | 1 | OWN_DB | projexa own DB: src/lib/services/contact-service.ts (table contact_requests); public unauthenticated form |
| conversations | 2 | OWN_DB | projexa own DB via supabase-js: tables conversations, conversation_participants, messages |
| dashboard-hierarchy | 5 | MIXED | projexa own DB src/lib/company-scope.ts (memberships/organizations) + forwards per-company dashboard/hr/expenses/sales-invoices/reports to CT; category-distribution combined locally in src/lib/category-distribution.ts |
| email | 3 | MIXED | projexa own DB (email_action_token, email_digest_*, daily_report_note) + src/lib/email/*, digest-item-dispatcher.ts (calls CT rfis/submittals/punch-list/billing-claims to apply actions); Postmark inbound |
| integrations | 5 | MIXED | projexa own DB (google_sheets_integration) + src/lib/google-sheets/{push,pull,spreadsheet-builder}.ts (push/pull read and write CT dashboard/scope/reports/work-progress) |
| internal | 1 | MIXED | [removed from the public copy: see the private KT folder] |
| kpi-entries | 2 | PROXY_TO_CT | forwards to CT /api/v1/construction/kpi-entries (+ [id]/approve) (v1 root, exists) |
| manpower-cost-report | 1 | PROXY_TO_CT | forwards to CT /api/v1/projexa/reports/manpower-cost (CT module reports) |
| moms | 7 | PROXY_TO_CT | forwards to CT projexa/veri-meetings (7 routes) |
| notifications | 2 | OWN_DB | projexa own DB via supabase-js (table notifications, RLS) |
| org | 6 | MIXED | invites via supabase-js RPC/tables (org_invites, accept_org_invite, org_invite_preview) = own DB; provision + repair = own DB + CT POST /api/v1/platform/provision-org (VERIDIAN_PLATFORM_APPLICATION_KEY) |
| org-members | 2 | OWN_DB | projexa own DB via supabase-js (memberships, settings-source.ts) |
| organization | 3 | MIXED | own DB (organizations, org_email_schedule) for 2 routes; organization/currency forwards to CT projexa/currencies/base |
| schedule-tracker | 1 | PROXY_TO_CT | forwards to CT /api/v1/construction/schedule which has NO route.ts in CT origin/main (dead upstream) |
| search | 1 | MIXED | src/lib/services/search-service.ts: own todos table via supabase-js + CT rfis/submittals/punch-list/change-orders reads, filtered application-side |
| shared | 1 | PROXY_TO_CT | public fetch of CT /api/veri-meetings/share/{token}/pdf (non-v1, unauthenticated) |
| shell | 1 | MIXED | own DB (organizations, notifications via supabase-js) + 5 parallel CT reads (dashboard, capability-tree, currencies, vendors, pill-usage) |
| todos | 2 | OWN_DB | projexa own DB via supabase-js (table todos) |
| user-preference | 1 | OWN_DB | projexa own DB: src/lib/services/project-preference-service.ts (last selected project) |
| veridian-link | 1 | OWN_LOGIC | no logic: authenticated 307 redirect to VERIDIAN_ORIGIN (CT host) |

Of the 23: MIXED=8, OWN_DB=7, OWN_LOGIC=1, PROXY_TO_CT=7. 16 of the 23 hold logic or data on the projexa side (MIXED 8 + OWN_DB 7 + OWN_LOGIC 1); the other 7 are proxies under a different module name than the CT module they call (construction-budget, construction-materials, kpi-entries, manpower-cost-report, moms, schedule-tracker, shared); 2 of those 7 (construction-budget, schedule-tracker) call a CT path that does not exist.

# SAME-NAME MODULES WHOSE ROUTE COUNTS DIFFER (16 of 86 common modules)

| module | projexa_routes | ct_routes |
|---|---|---|
| ai | 2 | 4 |
| attendance | 5 | 4 |
| currencies | 1 | 2 |
| dashboard | 1 | 2 |
| documents | 4 | 3 |
| knowledge-base | 3 | 4 |
| labour-roster | 4 | 2 |
| leads | 4 | 6 |
| materials | 5 | 1 |
| opportunities | 4 | 6 |
| projects | 4 | 2 |
| reports | 8 | 7 |
| schedule | 12 | 13 |
| scope | 13 | 12 |
| wiki | 2 | 3 |
| work-progress | 8 | 5 |

Name collision warning: module `ai` exists in both but is NOT a counterpart pair - projexa ai = 2 AI-Link routes (ai/[token] public snapshot, ai/apply); CT ai = 4 routes (progress-summary, risk-detection etc.) that no projexa file calls.
